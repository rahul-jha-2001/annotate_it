import argparse
import uuid

from database import SessionLocal
from models import Experiment
from services.scoring import rebuild_experiment_scores


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
        print(f"Rebuilt scores for {len(experiments)} experiment(s)")


if __name__ == "__main__":
    main()
