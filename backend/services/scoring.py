from sqlalchemy.orm import Session

from annotation_types import get_type
from config import SCORE_WINDOW_SIZE
from models import Annotation, Annotator, AnnotatorScore, DataUnit, Experiment, ItemAgreement


def _score_row(db: Session, annotator_id):
    row = db.query(AnnotatorScore).filter_by(annotator_id=annotator_id).first()
    if row is None:
        row = AnnotatorScore(annotator_id=annotator_id)
        db.add(row)
    return row


def recompute_annotator_score(db: Session, annotator: Annotator) -> None:
    experiment = db.query(Experiment).filter_by(id=annotator.experiment_id).one()
    spec = get_type(experiment.label_schema["annotation_type"])
    row = _score_row(db, annotator.id)

    row.items_completed = db.query(Annotation).filter_by(annotator_id=annotator.id).count()

    gold_annotations = (
        db.query(Annotation, DataUnit)
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(Annotation.annotator_id == annotator.id, DataUnit.is_gold.is_(True))
        .order_by(Annotation.submitted_at.desc())
        .limit(SCORE_WINDOW_SIZE)
        .all()
    )
    row.gold_items_seen = (
        db.query(Annotation)
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(Annotation.annotator_id == annotator.id, DataUnit.is_gold.is_(True))
        .count()
    )
    gold_scores = [
        spec.gold_match(annotation.answer, unit.gold_answer, experiment.label_schema)
        for annotation, unit in gold_annotations
        if unit.gold_answer is not None
    ]
    row.rolling_gold_accuracy = (
        sum(gold_scores) / len(gold_scores) if gold_scores else None
    )

    agreement_scores = [
        value
        for (value,) in (
            db.query(ItemAgreement.agreement_score)
            .join(DataUnit, DataUnit.id == ItemAgreement.data_unit_id)
            .join(Annotation, Annotation.data_unit_id == DataUnit.id)
            .filter(
                Annotation.annotator_id == annotator.id,
                DataUnit.is_gold.is_(False),
                ItemAgreement.agreement_score.isnot(None),
            )
            .order_by(ItemAgreement.computed_at.desc())
            .limit(SCORE_WINDOW_SIZE)
            .all()
        )
    ]
    row.rolling_agreement_score = (
        sum(agreement_scores) / len(agreement_scores) if agreement_scores else None
    )


def recompute_after_annotation(
    db: Session, experiment: Experiment, data_unit: DataUnit
) -> None:
    annotations = (
        db.query(Annotation).filter(Annotation.data_unit_id == data_unit.id).all()
    )

    if not data_unit.is_gold and len(annotations) >= experiment.overlap_n:
        item_score = db.query(ItemAgreement).filter_by(data_unit_id=data_unit.id).first()
        if item_score is None:
            item_score = ItemAgreement(data_unit_id=data_unit.id, n_annotations=0)
            db.add(item_score)
        item_score.n_annotations = len(annotations)
        item_score.agreement_score = get_type(
            experiment.label_schema["annotation_type"]
        ).agreement([annotation.answer for annotation in annotations], experiment.label_schema)

    involved_ids = {annotation.annotator_id for annotation in annotations}
    for annotator in db.query(Annotator).filter(Annotator.id.in_(involved_ids)).all():
        recompute_annotator_score(db, annotator)


def rebuild_experiment_scores(db: Session, experiment: Experiment) -> None:
    """Rebuild all derived agreement and annotator score rows from source data."""
    unit_ids = [
        unit_id
        for (unit_id,) in db.query(DataUnit.id).filter_by(experiment_id=experiment.id).all()
    ]
    if unit_ids:
        db.query(ItemAgreement).filter(ItemAgreement.data_unit_id.in_(unit_ids)).delete(
            synchronize_session=False
        )
    db.flush()

    regular_units = db.query(DataUnit).filter_by(
        experiment_id=experiment.id, is_gold=False
    ).all()
    spec = get_type(experiment.label_schema["annotation_type"])
    for unit in regular_units:
        annotations = db.query(Annotation).filter_by(data_unit_id=unit.id).all()
        if len(annotations) >= experiment.overlap_n:
            db.add(ItemAgreement(
                data_unit_id=unit.id,
                n_annotations=len(annotations),
                agreement_score=spec.agreement(
                    [annotation.answer for annotation in annotations],
                    experiment.label_schema,
                ),
            ))
    db.flush()

    for annotator in db.query(Annotator).filter_by(experiment_id=experiment.id).all():
        recompute_annotator_score(db, annotator)
