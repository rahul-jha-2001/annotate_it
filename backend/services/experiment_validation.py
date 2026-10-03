from dataclasses import dataclass, asdict
from typing import Optional, List
from sqlalchemy.orm import Session
from models import Experiment, DataUnit

@dataclass
class PreDeployValidationResult:
    can_deploy: bool
    status: str
    orphaned_gold_entries: List[str]
    missing_from_extraction: List[str]
    missing_from_metadata: List[str]
    blocker_reason: Optional[str] = None
    registered_count: int = 0
    metadata_count: int = 0
    gold_count: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def validate_experiment_for_deploy(experiment: Experiment, db: Session) -> PreDeployValidationResult:
    if experiment.status == "draft_media_processing":
        return PreDeployValidationResult(
            can_deploy=False,
            status=experiment.status,
            orphaned_gold_entries=[],
            missing_from_extraction=[],
            missing_from_metadata=[],
            blocker_reason="Cannot deploy while media archive is processing in the background",
            registered_count=0,
            metadata_count=len(experiment.pending_metadata or []),
            gold_count=len(experiment.pending_gold_manifest or []),
        )
    if experiment.status == "draft_media_failed":
        return PreDeployValidationResult(
            can_deploy=False,
            status=experiment.status,
            orphaned_gold_entries=[],
            missing_from_extraction=[],
            missing_from_metadata=[],
            blocker_reason="Cannot deploy when media archive processing failed",
            registered_count=0,
            metadata_count=len(experiment.pending_metadata or []),
            gold_count=len(experiment.pending_gold_manifest or []),
        )

    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    if not units:
        return PreDeployValidationResult(
            can_deploy=False,
            status=experiment.status,
            orphaned_gold_entries=[],
            missing_from_extraction=[],
            missing_from_metadata=[],
            blocker_reason="Upload at least one sample before deployment",
            registered_count=0,
            metadata_count=len(experiment.pending_metadata or []),
            gold_count=len(experiment.pending_gold_manifest or []),
        )

    registered_files = {u.raw_uri.rsplit('/', 1)[-1] for u in units}

    metadata_files = {
        row["filename"]
        for row in (experiment.pending_metadata or [])
        if isinstance(row, dict) and "filename" in row
    }

    gold_files = {
        entry["filename"]
        for entry in (experiment.pending_gold_manifest or [])
        if isinstance(entry, dict) and "filename" in entry
    }
    for u in units:
        if u.is_gold:
            gold_files.add(u.raw_uri.rsplit('/', 1)[-1])

    orphaned_gold = sorted(list(gold_files - registered_files))
    missing_from_ext = sorted(list(metadata_files - registered_files)) if metadata_files else []
    missing_from_meta = sorted(list(registered_files - metadata_files)) if metadata_files else []

    can_deploy = True
    blocker_reason = None

    if orphaned_gold:
        can_deploy = False
        blocker_reason = f"{len(orphaned_gold)} gold entries reference files that were never found in the uploaded archive."
    elif experiment.gold_ratio > 0 and len(gold_files) == 0:
        can_deploy = False
        blocker_reason = 'Add at least one gold answer or set quality-check frequency to "None"'

    return PreDeployValidationResult(
        can_deploy=can_deploy,
        status=experiment.status,
        orphaned_gold_entries=orphaned_gold,
        missing_from_extraction=missing_from_ext,
        missing_from_metadata=missing_from_meta,
        blocker_reason=blocker_reason,
        registered_count=len(registered_files),
        metadata_count=len(metadata_files),
        gold_count=len(gold_files),
    )


def reconcile_pending_experiment_data(experiment: Experiment, db: Session) -> dict:
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    by_filename = {u.raw_uri.rsplit('/', 1)[-1]: u for u in units}

    applied_metadata = 0
    if experiment.pending_metadata:
        current_schema = list(experiment.metadata_schema or [])
        existing_schema_keys = {field.get("key") for field in current_schema if isinstance(field, dict)}
        schema_updated = False
        for row in experiment.pending_metadata:
            if isinstance(row, dict) and "filename" in row:
                fn = row["filename"]
                attrs = row.get("attributes")
                if attrs is None:
                    attrs = {k: v for k, v in row.items() if k != "filename"}
                for k in attrs.keys():
                    if k not in existing_schema_keys:
                        current_schema.append({
                            "key": k,
                            "label": k.replace("_", " ").replace("-", " ").title(),
                            "type": "text",
                            "options": [],
                        })
                        existing_schema_keys.add(k)
                        schema_updated = True
                if fn in by_filename:
                    existing_meta = dict(by_filename[fn].metadata_json or {})
                    existing_meta.update(attrs)
                    by_filename[fn].metadata_json = existing_meta
                    applied_metadata += 1
        if schema_updated:
            experiment.metadata_schema = current_schema

    applied_gold = 0
    if experiment.pending_gold_manifest:
        for entry in experiment.pending_gold_manifest:
            if isinstance(entry, dict) and "filename" in entry and "answer" in entry:
                fn = entry["filename"]
                if fn in by_filename:
                    by_filename[fn].is_gold = True
                    by_filename[fn].gold_answer = entry["answer"]
                    applied_gold += 1

    # Keep teaching examples consistent if they exist
    if experiment.teaching_examples and applied_gold > 0:
        applied_units = {u.id for fn, u in by_filename.items() if u.is_gold}
        updated_te = []
        changed = False
        for te in experiment.teaching_examples:
            if isinstance(te, dict):
                import uuid
                uid_str = te.get("data_unit_id")
                try:
                    uid = uuid.UUID(uid_str) if uid_str else None
                except ValueError:
                    uid = None
                if uid in applied_units and not te.get("keep_as_gold"):
                    te = {**te, "keep_as_gold": True}
                    changed = True
            updated_te.append(te)
        if changed:
            experiment.teaching_examples = updated_te

    db.commit()
    return {"applied_metadata": applied_metadata, "applied_gold": applied_gold}
