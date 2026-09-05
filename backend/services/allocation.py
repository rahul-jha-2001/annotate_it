from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Annotation, Annotator, DataUnit, Experiment
from services.qualifications import sample_matches_qualifications


def _unseen_filter(db: Session, annotator: Annotator):
    return ~DataUnit.id.in_(
        db.query(Annotation.data_unit_id)
        .filter(Annotation.annotator_id == annotator.id)
    )


def allocate_next_item(
    db: Session, experiment: Experiment, annotator: Annotator
) -> DataUnit | None:
    """Return an eligible item while honoring gold cadence and overlap limits."""
    completed = (
        db.query(func.count(Annotation.id))
        .filter(Annotation.annotator_id == annotator.id)
        .scalar()
        or 0
    )
    gold_seen = (
        db.query(func.count(Annotation.id))
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(Annotation.annotator_id == annotator.id, DataUnit.is_gold.is_(True))
        .scalar()
        or 0
    )
    gold_due = (
        experiment.gold_ratio > 0
        and int((completed + 1) * experiment.gold_ratio) > gold_seen
    )
    qualification_answers = annotator.qualification_answers or {}

    def first_matching(candidates):
        return next(
            (
                unit
                for unit in candidates
                if sample_matches_qualifications(
                    unit.metadata_json or {},
                    qualification_answers,
                    experiment.routing_rules or [],
                )
            ),
            None,
        )

    def gold_candidate():
        candidates = (
            db.query(DataUnit)
            .filter(
                DataUnit.experiment_id == experiment.id,
                DataUnit.is_gold.is_(True),
                _unseen_filter(db, annotator),
            )
            .order_by(func.random())
            .all()
        )
        return first_matching(candidates)

    annotation_count = func.count(Annotation.id)

    def regular_candidate():
        candidates = (
            db.query(DataUnit)
            .outerjoin(Annotation, Annotation.data_unit_id == DataUnit.id)
            .filter(
                DataUnit.experiment_id == experiment.id,
                DataUnit.is_gold.is_(False),
                _unseen_filter(db, annotator),
            )
            .group_by(DataUnit.id)
            .having(annotation_count < experiment.overlap_n)
            .order_by(annotation_count.asc(), DataUnit.id.asc())
            .all()
        )
        return first_matching(candidates)

    if gold_due:
        return gold_candidate() or regular_candidate()
    return regular_candidate() or gold_candidate()


def has_pending_unseen_items(
    db: Session, experiment: Experiment, annotator: Annotator
) -> bool:
    """Return whether work exists for the annotator before qualification routing."""
    unseen = _unseen_filter(db, annotator)
    if db.query(DataUnit.id).filter(
        DataUnit.experiment_id == experiment.id,
        DataUnit.is_gold.is_(True),
        unseen,
    ).first():
        return True
    annotation_count = func.count(Annotation.id)
    return db.query(DataUnit.id).outerjoin(
        Annotation, Annotation.data_unit_id == DataUnit.id
    ).filter(
        DataUnit.experiment_id == experiment.id,
        DataUnit.is_gold.is_(False),
        unseen,
    ).group_by(DataUnit.id).having(
        annotation_count < experiment.overlap_n
    ).first() is not None
