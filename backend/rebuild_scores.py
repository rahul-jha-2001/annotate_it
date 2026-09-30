import argparse
import logging
import uuid

from config import LOG_FORMAT, LOG_LEVEL
from database import SessionLocal
from logging_config import setup_logging
from models import Experiment
from services.scoring import rebuild_experiment_scores

setup_logging(log_level=LOG_LEVEL, log_format=LOG_FORMAT)
logger = logging.getLogger("rebuild_scores")


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild derived annotation quality scores")
    parser.add_argument("experiment_id", nargs="?", help="UUID; omit to rebuild every experiment")
    args = parser.parse_args()

    with SessionLocal() as db:
        query = db.query(Experiment)
        if args.experiment_id:
            query = query.filter(Experiment.id == uuid.UUID(args.experiment_id))
        experiments = query.all()
        if args.experiment_id and not experiments:
            parser.error("experiment not found")
        for experiment in experiments:
            rebuild_experiment_scores(db, experiment)
        db.commit()
        logger.info(
            "scores.rebuild_summary",
            extra={"rebuilt_count": len(experiments), "filter_experiment_id": args.experiment_id},
        )


if __name__ == "__main__":
    main()

