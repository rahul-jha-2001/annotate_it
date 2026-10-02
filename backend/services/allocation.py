import logging
from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Annotation, Annotator, DataUnit, Experiment
from services.qualifications import sample_matches_qualifications

logger = logging.getLogger(__name__)


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

    logger.debug(
        "allocation.evaluating",
        extra={
            "experiment_id": str(experiment.id),
            "annotator_id": str(annotator.id),
            "completed": completed,
            "gold_seen": gold_seen,
            "gold_due": gold_due,
            "gold_ratio": experiment.gold_ratio,
            "overlap_n": experiment.overlap_n,
        },
    )

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

    teaching_ids = [
        te["data_unit_id"]
        for te in (getattr(experiment, "teaching_examples", None) or [])
        if isinstance(te, dict) and te.get("data_unit_id")
    ]
    annotation_count = func.count(Annotation.id)

    def regular_candidate():
        query = (
            db.query(DataUnit)
            .outerjoin(Annotation, Annotation.data_unit_id == DataUnit.id)
            .filter(
                DataUnit.experiment_id == experiment.id,
                DataUnit.is_gold.is_(False),
                _unseen_filter(db, annotator),
            )
        )
        if teaching_ids:
            query = query.filter(~DataUnit.id.in_(teaching_ids))
        candidates = (
            query.group_by(DataUnit.id)
            .having(annotation_count < experiment.overlap_n)
            .order_by(annotation_count.asc(), DataUnit.id.asc())
            .all()
        )
        return first_matching(candidates)

    if gold_due:
        logger.info(
            "allocation.gold_cadence_due",
            extra={
                "experiment_id": str(experiment.id),
                "annotator_id": str(annotator.id),
                "completed": completed,
                "gold_seen": gold_seen,
                "gold_ratio": experiment.gold_ratio,
            },
        )
        allocated = gold_candidate() or regular_candidate()
    else:
        allocated = regular_candidate() or gold_candidate()

    if allocated is not None:
        logger.info(
            "allocation.item_allocated",
            extra={
                "experiment_id": str(experiment.id),
                "annotator_id": str(annotator.id),
                "data_unit_id": str(allocated.id),
                "is_gold": allocated.is_gold,
                "gold_due": gold_due,
            },
        )
        return allocated

    pending_unseen = has_pending_unseen_items(db, experiment, annotator)
    logger.info(
        "allocation.queue_exhausted",
        extra={
            "experiment_id": str(experiment.id),
            "annotator_id": str(annotator.id),
            "reason": "qualification_mismatch" if pending_unseen else "all_items_completed",
        },
    )
    return None


def has_pending_unseen_items(
    db: Session, experiment: Experiment, annotator: Annotator
) -> bool:
    """Return whether work exists for the annotator before qualification routing."""
    teaching_ids = [
        te["data_unit_id"]
        for te in (getattr(experiment, "teaching_examples", None) or [])
        if isinstance(te, dict) and te.get("data_unit_id")
    ]
    unseen = _unseen_filter(db, annotator)
    if db.query(DataUnit.id).filter(
        DataUnit.experiment_id == experiment.id,
        DataUnit.is_gold.is_(True),
        unseen,
    ).first():
        return True
    annotation_count = func.count(Annotation.id)
    reg_query = db.query(DataUnit.id).outerjoin(
        Annotation, Annotation.data_unit_id == DataUnit.id
    ).filter(
        DataUnit.experiment_id == experiment.id,
        DataUnit.is_gold.is_(False),
        unseen,
    )
    if teaching_ids:
        reg_query = reg_query.filter(~DataUnit.id.in_(teaching_ids))
    return reg_query.group_by(DataUnit.id).having(
        annotation_count < experiment.overlap_n
    ).first() is not None
