from __future__ import annotations

import csv
import datetime
import hashlib
import io
import json
import logging
import os
import re
import shutil
import threading
import uuid
import zipfile
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from annotation_types import get_type
from annotation_types.base import WeightedAnswer
from config import EXPORT_MAX_ARCHIVE_BYTES, PRESIGNED_URL_EXPIRY_SECONDS, S3_BUCKET
from models import Annotation, Annotator, AnnotatorScore, DataUnit, Experiment, ExportJob, ItemAgreement

logger = logging.getLogger(__name__)


class ArchiveSizeExceeded(Exception):
    """Raised when the archive exceeds the maximum allowed size in bytes."""
    pass


class ExportCancelled(Exception):
    """Raised when an export is cancelled or interrupted."""
    pass



def format_score(score: Optional[float], decimals: int = 4) -> str:
    """Format floating point score as string, preserving 0.0 without treating it as falsy."""
    if score is None:
        return ""
    return f"{score:.{decimals}f}"


def compute_training_readiness(
    mode: str,
    counts: Dict[str, int],
    policy: ConsensusPolicy,
    warnings: List[str],
    missing_media_count: int = 0,
) -> bool:
    """Determines whether export is training-ready per Spec Section 3.3 & 4.1.

    Requires consensus mode, no warnings, no unannotated samples, no review flags,
    no excluded low-evidence samples, at least 1 consensus-accepted sample, and no missing media.
    """
    if mode != "consensus":
        return False
    if len(warnings) > 0 or missing_media_count > 0:
        return False
    if counts.get("unannotated_samples", 0) > 0:
        return False
    if counts.get("insufficient_overlap_samples", 0) > 0:
        return False
    if counts.get("low_agreement_samples", 0) > 0:
        return False
    if counts.get("tied_samples", 0) > 0:
        return False
    if counts.get("no_eligible_annotations_samples", 0) > 0:
        return False
    if not policy.include_low_evidence and counts.get("low_evidence_samples", 0) > 0:
        return False
    if counts.get("consensus_accepted_samples", 0) <= 0:
        return False
    return True


# ---------------------------------------------------------------------------
# Policy Schema
# ---------------------------------------------------------------------------

class ConsensusPolicy(BaseModel):
    min_annotations_for_consensus: int = Field(default=2, ge=1)
    low_evidence_threshold: int = Field(default=3, ge=1)
    min_gold_items: int = Field(default=5, ge=0)
    min_gold_score: float = Field(default=0.70, ge=0.0, le=1.0)
    min_agreement: float = Field(default=0.60, ge=0.0, le=1.0)
    include_low_evidence: bool = Field(default=False)
    prior_strength: float = Field(default=2.0, ge=0.0)


# ---------------------------------------------------------------------------
# Path & Filename Sanitization (Spec Section 10)
# ---------------------------------------------------------------------------

def sanitize_filename(raw_filename: str, fallback: str = "sample") -> str:
    """Sanitize a filename to avoid path traversal, absolute roots, or platform separators."""
    if not raw_filename:
        return fallback

    # Extract base name only (strip any directory parts)
    cleaned = raw_filename.replace("\\", "/").split("/")[-1].strip()

    # Remove non-whitelisted characters: allow alphanumerics, underscores, dashes, dots
    cleaned = re.sub(r"[^\w\.\-]", "_", cleaned)
    # Strip leading/trailing dots to prevent hidden files or traversal like '..'
    cleaned = cleaned.strip(".")

    if not cleaned:
        return fallback
    return cleaned


def extract_original_filename(raw_uri: str, default_name: str) -> str:
    """Extract and sanitize original filename from an S3 or HTTP URI."""
    if not raw_uri:
        return sanitize_filename(default_name)
    remainder = raw_uri.split("?")[0].rstrip("/")
    part = remainder.split("/")[-1]
    return sanitize_filename(part, fallback=default_name)


# ---------------------------------------------------------------------------
# Annotator Quality Evidence (Spec Section 6.1)
# ---------------------------------------------------------------------------

@dataclass
class AnnotatorExportEvidence:
    annotator_id: uuid.UUID
    export_id: str
    status: str
    total_annotations: int
    gold_items_seen: int
    raw_mean_gold_score: Optional[float]
    reliability_weight: float
    rolling_gold_accuracy: Optional[float]
    rolling_agreement_score: Optional[float]
    consensus_eligibility: str  # 'eligible' | 'low_gold_accuracy' | 'insufficient_gold_evidence'
    is_excluded: bool
    exclusion_reasons: List[str] = field(default_factory=list)
    qualification_answers: Optional[Dict[str, Any]] = None



def evaluate_annotator_evidence(
    db: Session,
    experiment: Experiment,
    cutoff_at: datetime.datetime,
    policy: ConsensusPolicy,
) -> Dict[uuid.UUID, AnnotatorExportEvidence]:
    """Recomputes full-history gold evidence at snapshot cutoff per Spec Section 6.1."""
    spec = get_type(experiment.label_schema["annotation_type"])

    annotators = (
        db.query(Annotator)
        .filter(Annotator.experiment_id == experiment.id)
        .order_by(Annotator.created_at, Annotator.id)
        .all()
    )

    result: Dict[uuid.UUID, AnnotatorExportEvidence] = {}

    for idx, ann in enumerate(annotators, start=1):
        export_id = f"annotator-{idx:04d}"

        # Count total annotations up to cutoff
        total_annotations = (
            db.query(Annotation)
            .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
            .filter(
                Annotation.annotator_id == ann.id,
                Annotation.submitted_at <= cutoff_at,
            )
            .count()
        )

        # Full-history gold annotations up to cutoff
        gold_pairs = (
            db.query(Annotation, DataUnit)
            .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
            .filter(
                Annotation.annotator_id == ann.id,
                DataUnit.is_gold.is_(True),
                Annotation.submitted_at <= cutoff_at,
            )
            .all()
        )

        gold_scores = []
        for a, u in gold_pairs:
            if u.gold_answer is not None:
                try:
                    s = spec.gold_match(a.answer, u.gold_answer, experiment.label_schema)
                    gold_scores.append(s)
                except Exception as exc:
                    logger.warning(
                        "export.gold_match_failed",
                        extra={"annotator_id": str(ann.id), "error": str(exc)},
                    )

        gold_items_seen = len(gold_scores)
        raw_mean = sum(gold_scores) / gold_items_seen if gold_items_seen > 0 else None

        # Existing rolling scores for operational context
        score_row = db.query(AnnotatorScore).filter_by(annotator_id=ann.id).first()
        rolling_gold = score_row.rolling_gold_accuracy if score_row else None
        rolling_agreement = score_row.rolling_agreement_score if score_row else None

        prior_strength = policy.prior_strength
        if gold_items_seen < policy.min_gold_items:
            # Insufficient gold evidence: neutral weight, not automatically excluded
            reliability_weight = 1.0
            consensus_eligibility = "insufficient_gold_evidence"
            is_excluded = False
            exclusion_reasons = []
        else:
            # Full-history reliability weight shrunk toward neutral (0.5)
            reliability_weight = (sum(gold_scores) + prior_strength * 0.5) / (
                gold_items_seen + prior_strength
            )
            if raw_mean is not None and raw_mean < policy.min_gold_score:
                consensus_eligibility = "low_gold_accuracy"
                is_excluded = True
                exclusion_reasons = ["gold_accuracy_below_threshold"]
            else:
                consensus_eligibility = "eligible"
                is_excluded = False
                exclusion_reasons = []

        result[ann.id] = AnnotatorExportEvidence(
            annotator_id=ann.id,
            export_id=export_id,
            status=ann.status,
            total_annotations=total_annotations,
            gold_items_seen=gold_items_seen,
            raw_mean_gold_score=round(raw_mean, 4) if raw_mean is not None else None,
            reliability_weight=round(reliability_weight, 4),
            rolling_gold_accuracy=round(rolling_gold, 4) if rolling_gold is not None else None,
            rolling_agreement_score=round(rolling_agreement, 4) if rolling_agreement is not None else None,
            consensus_eligibility=consensus_eligibility,
            is_excluded=is_excluded,
            exclusion_reasons=exclusion_reasons,
            qualification_answers=ann.qualification_answers,
        )

    return result



# ---------------------------------------------------------------------------
# Fingerprint Calculation (Spec Section 9)
# ---------------------------------------------------------------------------

def compute_source_fingerprint(
    units: List[DataUnit],
    annotations_by_unit: Dict[uuid.UUID, List[Annotation]],
    cutoff_at: datetime.datetime,
    experiment: Optional[Experiment] = None,
    annotator_evidence: Optional[Dict[uuid.UUID, AnnotatorExportEvidence]] = None,
) -> str:
    """Computes SHA-256 fingerprint over ordered units, metadata, gold answers, eligible annotations,
    experiment configuration, and annotator evidence (qualification answers, statuses, scores).
    """
    hasher = hashlib.sha256()

    if experiment is not None:
        hasher.update(str(experiment.id).encode("utf-8"))
        hasher.update((experiment.name or "").encode("utf-8"))
        hasher.update((experiment.instructions or "").encode("utf-8"))
        hasher.update(json.dumps(experiment.label_schema or {}, sort_keys=True).encode("utf-8"))
        hasher.update(json.dumps(experiment.metadata_schema or [], sort_keys=True).encode("utf-8"))
        hasher.update(json.dumps(experiment.qualification_form or [], sort_keys=True).encode("utf-8"))
        hasher.update(json.dumps(experiment.routing_rules or [], sort_keys=True).encode("utf-8"))
        hasher.update((experiment.access_mode or "").encode("utf-8"))
        hasher.update(str(experiment.overlap_n).encode("utf-8"))
        hasher.update(str(experiment.gold_ratio).encode("utf-8"))

    if annotator_evidence:
        for ann_id in sorted(annotator_evidence.keys(), key=lambda x: str(x)):
            ev = annotator_evidence[ann_id]
            hasher.update(str(ann_id).encode("utf-8"))
            hasher.update(str(ev.export_id).encode("utf-8"))
            hasher.update(str(ev.status).encode("utf-8"))
            hasher.update(json.dumps(ev.qualification_answers or {}, sort_keys=True).encode("utf-8"))
            hasher.update(str(ev.raw_mean_gold_score if ev.raw_mean_gold_score is not None else "").encode("utf-8"))
            hasher.update(str(ev.rolling_gold_accuracy if ev.rolling_gold_accuracy is not None else "").encode("utf-8"))
            hasher.update(str(ev.rolling_agreement_score if ev.rolling_agreement_score is not None else "").encode("utf-8"))
            hasher.update(str(ev.consensus_eligibility).encode("utf-8"))
            hasher.update(str(ev.is_excluded).encode("utf-8"))
            hasher.update(json.dumps(sorted(ev.exclusion_reasons), sort_keys=True).encode("utf-8"))

    for unit in sorted(units, key=lambda u: str(u.id)):
        hasher.update(str(unit.id).encode("utf-8"))
        hasher.update(str(unit.raw_uri or "").encode("utf-8"))
        hasher.update(str(unit.is_gold).encode("utf-8"))
        hasher.update(json.dumps(unit.metadata_json or {}, sort_keys=True).encode("utf-8"))
        hasher.update(json.dumps(unit.gold_answer or {}, sort_keys=True).encode("utf-8"))

        unit_anns = [
            a for a in annotations_by_unit.get(unit.id, [])
            if a.submitted_at <= cutoff_at
        ]
        for a in sorted(unit_anns, key=lambda x: str(x.id)):
            hasher.update(str(a.id).encode("utf-8"))
            hasher.update(str(a.annotator_id).encode("utf-8"))
            hasher.update(a.submitted_at.isoformat().encode("utf-8"))
            hasher.update(json.dumps(a.answer, sort_keys=True).encode("utf-8"))

    return hasher.hexdigest()


# ---------------------------------------------------------------------------
# Preflight and Item Classification (Spec Section 3.3, 6.3)
# ---------------------------------------------------------------------------

@dataclass
class ItemConsensusEvaluation:
    data_unit_id: uuid.UUID
    filename: str
    archive_media_path: str
    raw_uri: str
    is_gold: bool
    metadata: Dict[str, Any]
    status: str  # Section 6.3 item status
    final_answer: Optional[Dict[str, Any]]
    confidence: float
    agreement: float
    votes_total: int
    votes_used: int
    source_annotation_ids: List[str]
    excluded_annotation_ids: List[str]
    item_warnings: List[str]
    raw_annotations: List[Dict[str, Any]]


def _evaluate_dataset_export_core(
    db: Session,
    experiment: Experiment,
    cutoff_at: datetime.datetime,
    policy: ConsensusPolicy,
    annotator_evidence: Dict[uuid.UUID, AnnotatorExportEvidence],
) -> Tuple[List[ItemConsensusEvaluation], Dict[str, Any], Dict[str, Any], List[str], str]:
    """Evaluates all units and annotations up to cutoff_at. Returns items, counts, annotator summary, warnings, and source fingerprint."""
    spec = get_type(experiment.label_schema["annotation_type"])

    units = (
        db.query(DataUnit)
        .filter(DataUnit.experiment_id == experiment.id)
        .order_by(DataUnit.id)
        .all()
    )

    all_anns = (
        db.query(Annotation)
        .join(DataUnit, DataUnit.id == Annotation.data_unit_id)
        .filter(
            DataUnit.experiment_id == experiment.id,
            Annotation.submitted_at <= cutoff_at,
        )
        .order_by(Annotation.submitted_at, Annotation.id)
        .all()
    )

    annotations_by_unit: Dict[uuid.UUID, List[Annotation]] = {}
    for a in all_anns:
        annotations_by_unit.setdefault(a.data_unit_id, []).append(a)

    source_fingerprint = compute_source_fingerprint(
        units=units,
        annotations_by_unit=annotations_by_unit,
        cutoff_at=cutoff_at,
        experiment=experiment,
        annotator_evidence=annotator_evidence,
    )


    items: List[ItemConsensusEvaluation] = []
    status_counts: Dict[str, int] = {
        "gold_reference": 0,
        "accepted": 0,
        "low_evidence": 0,
        "needs_review_low_agreement": 0,
        "needs_review_tie": 0,
        "needs_review_insufficient_overlap": 0,
        "needs_review_no_eligible_annotations": 0,
        "unannotated": 0,
    }

    warnings: List[str] = []

    for unit in units:
        orig_filename = extract_original_filename(unit.raw_uri, default_name=f"sample_{unit.id}")
        archive_path = f"media/{unit.id}/{orig_filename}"
        unit_anns = annotations_by_unit.get(unit.id, [])

        # Process raw annotation export records
        raw_export_records = []
        eligible_weighted_answers: List[WeightedAnswer] = []
        excluded_annotation_ids: List[str] = []

        for a in unit_anns:
            evidence = annotator_evidence.get(a.annotator_id)
            export_ann_id = evidence.export_id if evidence else "unknown"
            is_excluded = evidence.is_excluded if evidence else False
            reasons = list(evidence.exclusion_reasons) if evidence else []

            # Check gold score on this item if gold
            item_gold_score = None
            if unit.is_gold and unit.gold_answer is not None:
                try:
                    item_gold_score = spec.gold_match(a.answer, unit.gold_answer, experiment.label_schema)
                except Exception:
                    pass

            raw_record = {
                "annotation_id": str(a.id),
                "data_unit_id": str(unit.id),
                "filename": orig_filename,
                "annotator_export_id": export_ann_id,
                "answer": a.answer,
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
                "is_gold_item": unit.is_gold,
                "gold_score": round(item_gold_score, 4) if item_gold_score is not None else None,
                "included_in_consensus": not is_excluded,
                "exclusion_reasons": reasons,
            }
            raw_export_records.append(raw_record)

            if is_excluded:
                excluded_annotation_ids.append(str(a.id))
            else:
                weight = evidence.reliability_weight if evidence else 1.0
                eligible_weighted_answers.append(
                    WeightedAnswer(
                        annotation_id=str(a.id),
                        annotator_id=str(a.annotator_id),
                        answer=a.answer,
                        weight=weight,
                        submitted_at=a.submitted_at,
                    )
                )

        # Classification logic per Spec Section 6.3
        item_warnings: List[str] = []
        if unit.is_gold:
            status = "gold_reference"
            final_answer = unit.gold_answer
            confidence = 1.0
            agreement = 1.0
            votes_total = len(unit_anns)
            votes_used = 0
            source_ids = []
        elif len(unit_anns) == 0:
            status = "unannotated"
            final_answer = None
            confidence = 0.0
            agreement = 0.0
            votes_total = 0
            votes_used = 0
            source_ids = []
        elif len(eligible_weighted_answers) == 0:
            status = "needs_review_no_eligible_annotations"
            final_answer = None
            confidence = 0.0
            agreement = 0.0
            votes_total = len(unit_anns)
            votes_used = 0
            source_ids = []
            item_warnings.append("All submitted annotations were excluded due to quality guardrails")
        elif len(eligible_weighted_answers) < policy.min_annotations_for_consensus:
            status = "needs_review_insufficient_overlap"
            final_answer = None
            confidence = 0.0
            agreement = 0.0
            votes_total = len(unit_anns)
            votes_used = len(eligible_weighted_answers)
            source_ids = [a.annotation_id for a in eligible_weighted_answers]
            item_warnings.append(
                f"Fewer than minimum required annotations ({len(eligible_weighted_answers)} < {policy.min_annotations_for_consensus})"
            )
        else:
            # Run module consensus
            try:
                consensus_result = spec.consensus(
                    eligible_weighted_answers, experiment.label_schema
                )
                votes_total = len(unit_anns)
                votes_used = len(eligible_weighted_answers)
                confidence = consensus_result.consensus.confidence
                agreement = consensus_result.consensus.agreement
                source_ids = consensus_result.consensus.source_annotation_ids

                if consensus_result.consensus.status == "needs_review_tie":
                    status = "needs_review_tie"
                    final_answer = None
                    item_warnings.extend(consensus_result.consensus.warnings or ["Unresolved tie between candidates"])
                elif agreement < policy.min_agreement:
                    status = "needs_review_low_agreement"
                    final_answer = consensus_result.answer
                    item_warnings.append(
                        f"Item agreement ({agreement:.2f}) is below threshold ({policy.min_agreement:.2f})"
                    )
                elif len(eligible_weighted_answers) < policy.low_evidence_threshold:
                    status = "low_evidence"
                    final_answer = consensus_result.answer
                    item_warnings.append(
                        f"Fewer than {policy.low_evidence_threshold} annotations available (low evidence)"
                    )
                else:
                    status = "accepted"
                    final_answer = consensus_result.answer
            except Exception as exc:
                logger.exception(
                    "export.consensus_failed",
                    extra={"data_unit_id": str(unit.id), "error": str(exc)},
                )
                status = "needs_review_tie"
                final_answer = None
                confidence = 0.0
                agreement = 0.0
                votes_total = len(unit_anns)
                votes_used = len(eligible_weighted_answers)
                source_ids = []
                item_warnings.append(f"Consensus error: {str(exc)}")

        status_counts[status] = status_counts.get(status, 0) + 1

        items.append(
            ItemConsensusEvaluation(
                data_unit_id=unit.id,
                filename=orig_filename,
                archive_media_path=archive_path,
                raw_uri=unit.raw_uri,
                is_gold=unit.is_gold,
                metadata=unit.metadata_json or {},
                status=status,
                final_answer=final_answer,
                confidence=round(confidence, 4),
                agreement=round(agreement, 4),
                votes_total=votes_total,
                votes_used=votes_used,
                source_annotation_ids=source_ids,
                excluded_annotation_ids=excluded_annotation_ids,
                item_warnings=item_warnings,
                raw_annotations=raw_export_records,
            )
        )

    # Compile global warnings
    if status_counts["unannotated"] > 0:
        warnings.append(
            f"{status_counts['unannotated']} sample(s) have no submitted annotations."
        )
    if status_counts["needs_review_insufficient_overlap"] > 0:
        warnings.append(
            f"{status_counts['needs_review_insufficient_overlap']} sample(s) have insufficient annotator overlap."
        )
    if status_counts["needs_review_low_agreement"] > 0:
        warnings.append(
            f"{status_counts['needs_review_low_agreement']} sample(s) fell below the agreement threshold ({policy.min_agreement:.2f})."
        )
    if status_counts["needs_review_tie"] > 0:
        warnings.append(
            f"{status_counts['needs_review_tie']} sample(s) have unresolved candidate ties."
        )
    if status_counts["needs_review_no_eligible_annotations"] > 0:
        warnings.append(
            f"{status_counts['needs_review_no_eligible_annotations']} sample(s) have no eligible annotations after exclusions."
        )
    if status_counts["low_evidence"] > 0 and not policy.include_low_evidence:
        warnings.append(
            f"{status_counts['low_evidence']} sample(s) have low evidence (< {policy.low_evidence_threshold} annotations) and are routed to review."
        )

    excluded_ann_count = sum(1 for e in annotator_evidence.values() if e.is_excluded)
    if excluded_ann_count > 0:
        warnings.append(
            f"{excluded_ann_count} annotator(s) excluded from consensus due to low full-history gold score."
        )

    # Counts summary
    total_samples = len(units)
    annotated_samples = sum(1 for item in items if item.status != "unannotated" and not item.is_gold)
    unannotated_samples = status_counts["unannotated"]
    gold_samples = status_counts["gold_reference"]

    # Training ready items count
    consensus_accepted = (
        status_counts["accepted"]
        + status_counts["gold_reference"]
        + (status_counts["low_evidence"] if policy.include_low_evidence else 0)
    )

    counts = {
        "total_samples": total_samples,
        "annotated_samples": annotated_samples,
        "unannotated_samples": unannotated_samples,
        "gold_samples": gold_samples,
        "consensus_accepted_samples": consensus_accepted,
        "accepted_samples": status_counts["accepted"],
        "low_evidence_samples": status_counts["low_evidence"],
        "insufficient_overlap_samples": status_counts["needs_review_insufficient_overlap"],
        "low_agreement_samples": status_counts["needs_review_low_agreement"],
        "tied_samples": status_counts["needs_review_tie"],
        "no_eligible_annotations_samples": status_counts["needs_review_no_eligible_annotations"],
    }

    annotator_summary = {
        "total_annotators": len(annotator_evidence),
        "eligible_annotators": sum(1 for e in annotator_evidence.values() if not e.is_excluded),
        "excluded_annotators": sum(1 for e in annotator_evidence.values() if e.is_excluded),
        "insufficient_gold_annotators": sum(
            1 for e in annotator_evidence.values() if e.consensus_eligibility == "insufficient_gold_evidence"
        ),
    }

    return items, counts, annotator_summary, warnings, source_fingerprint


def evaluate_dataset_export(
    db: Session,
    experiment: Experiment,
    cutoff_at: datetime.datetime,
    policy: ConsensusPolicy,
    mode: str,
) -> Tuple[List[ItemConsensusEvaluation], Dict[str, Any], Dict[str, Any], List[str]]:
    """Evaluates all units and annotations up to cutoff_at. Returns items, counts, annotator summary, and warnings."""
    annotator_evidence = evaluate_annotator_evidence(db, experiment, cutoff_at, policy)
    items, counts, annotator_summary, warnings, _ = _evaluate_dataset_export_core(
        db, experiment, cutoff_at, policy, annotator_evidence
    )
    return items, counts, annotator_summary, warnings


def evaluate_export_snapshot(
    db: Session,
    experiment: Experiment,
    cutoff_at: datetime.datetime,
    policy: ConsensusPolicy,
    mode: str,
) -> Tuple[
    List[ItemConsensusEvaluation],
    Dict[str, Any],
    Dict[str, Any],
    List[str],
    Dict[uuid.UUID, AnnotatorExportEvidence],
    str,
]:
    """Evaluates all units and annotations up to cutoff_at in a single pass, returning evaluation and source fingerprint."""
    annotator_evidence = evaluate_annotator_evidence(db, experiment, cutoff_at, policy)
    items, counts, annotator_summary, warnings, source_fingerprint = _evaluate_dataset_export_core(
        db, experiment, cutoff_at, policy, annotator_evidence
    )
    return items, counts, annotator_summary, warnings, annotator_evidence, source_fingerprint



# ---------------------------------------------------------------------------
# ZIP Archive Assembly (Spec Section 4)
# ---------------------------------------------------------------------------

def render_jsonl(records: List[Dict[str, Any]]) -> str:
    """Renders records as UTF-8 single-line JSONL."""
    lines = [json.dumps(rec, ensure_ascii=False) for rec in records]
    return "\n".join(lines) + ("\n" if lines else "")


def render_csv(rows: List[Dict[str, Any]], fieldnames: List[str]) -> str:
    """Renders tabular data as CSV string."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue()


def _copy_stream_bounded(
    source_stream: Any,
    dest_stream: Any,
    output_zip_path: str,
    max_archive_bytes: int,
    cancel_event: Optional[threading.Event] = None,
    chunk_size: int = 64 * 1024,
) -> int:
    """Copies bytes from source_stream to dest_stream in chunks of 64 KiB,

    verifying size bounds and cancellation after every chunk.
    """
    total_copied = 0
    while True:
        if cancel_event and cancel_event.is_set():
            raise ExportCancelled("Export was cancelled or interrupted by worker shutdown")
        chunk = source_stream.read(chunk_size)
        if not chunk:
            break
        dest_stream.write(chunk)
        dest_stream.flush()
        total_copied += len(chunk)
        current_size = os.path.getsize(output_zip_path)
        if current_size > max_archive_bytes:
            raise ArchiveSizeExceeded(
                f"Generated archive size {current_size} exceeds limit of {max_archive_bytes} bytes"
            )
    return total_copied


def build_export_archive(
    db: Session,
    experiment: Experiment,
    job: ExportJob,
    s3_client: Any,
    bucket_name: str,
    output_zip_path: str,
    snapshot_evaluation: Optional[
        Tuple[
            List[ItemConsensusEvaluation],
            Dict[str, Any],
            Dict[str, Any],
            List[str],
            Dict[uuid.UUID, AnnotatorExportEvidence],
        ]
    ] = None,
    max_archive_bytes: int = EXPORT_MAX_ARCHIVE_BYTES,
    cancel_event: Optional[threading.Event] = None,
) -> Tuple[int, str]:
    """Generates the full ZIP archive on disk. Returns (size_bytes, sha256_checksum)."""
    policy = ConsensusPolicy.model_validate(job.policy)
    cutoff_at = job.source_cutoff_at

    if snapshot_evaluation is not None:
        items, counts, annotator_summary, base_warnings, annotator_evidence = snapshot_evaluation
        warnings = list(base_warnings)
    else:
        items, counts, annotator_summary, warnings = evaluate_dataset_export(
            db, experiment, cutoff_at, policy, job.mode
        )
        annotator_evidence = evaluate_annotator_evidence(db, experiment, cutoff_at, policy)

    algorithm_info = {
        "name": "quality_weighted_medoid",
        "version": 1,
        "description": "Quality-weighted medoid selection with full-history Bayesian shrinkage",
    }

    missing_media_items: List[Dict[str, Any]] = []

    with zipfile.ZipFile(output_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. Media streaming into media/{data_unit_id}/{filename}
        for item in items:
            if cancel_event and cancel_event.is_set():
                raise ExportCancelled("Export was cancelled or interrupted by worker shutdown")
            raw_uri = item.raw_uri
            if not raw_uri:
                continue

            try:
                # Handle s3:// URIs and relative keys (restricted strictly to configured bucket)
                if raw_uri.startswith("s3://"):
                    remainder = raw_uri[5:]
                    if "/" not in remainder:
                        raise ValueError(f"Invalid S3 URI: {raw_uri}")
                    b_name, key = remainder.split("/", 1)
                    if b_name != bucket_name:
                        raise ValueError(
                            f"S3 bucket '{b_name}' is forbidden; must match configured bucket '{bucket_name}'"
                        )
                elif raw_uri.startswith(("http://", "https://")):
                    raise ValueError(f"HTTP/HTTPS URIs are not supported for archive media packaging: {raw_uri}")
                else:
                    b_name = bucket_name
                    key = raw_uri.lstrip("/")

                # Strict check against directory traversal or local filesystem access
                if ".." in key or key.startswith("/") or "\x00" in key:
                    raise ValueError(f"Invalid or unsafe object key in raw_uri: {raw_uri}")

                # Stream object from S3 directly into ZIP with per-chunk bounding
                obj_resp = s3_client.get_object(Bucket=b_name, Key=key)
                with zf.open(item.archive_media_path, "w") as dest:
                    _copy_stream_bounded(
                        source_stream=obj_resp["Body"],
                        dest_stream=dest,
                        output_zip_path=output_zip_path,
                        max_archive_bytes=max_archive_bytes,
                        cancel_event=cancel_event,
                        chunk_size=64 * 1024,
                    )

            except (ArchiveSizeExceeded, ExportCancelled):
                # Critical errors must not be masked as missing media
                raise
            except Exception as exc:
                logger.warning(
                    "export.media_fetch_failed",
                    extra={
                        "data_unit_id": str(item.data_unit_id),
                        "raw_uri": raw_uri,
                        "error": str(exc),
                    },
                )
                missing_media_items.append({
                    "data_unit_id": str(item.data_unit_id),
                    "raw_uri": raw_uri,
                    "archive_media_path": item.archive_media_path,
                    "error": str(exc),
                })
                # Create a placeholder note in the archive so evidence is not lost
                zf.writestr(
                    f"{item.archive_media_path}.missing.txt",
                    f"Original media URI: {raw_uri}\nError fetching: {str(exc)}\n",
                )


        # 2. Check for missing media and compute final training readiness
        if missing_media_items:
            warnings.append(
                f"{len(missing_media_items)} media object(s) could not be retrieved from storage and are missing from the archive."
            )

        training_ready = compute_training_readiness(
            mode=job.mode,
            counts=counts,
            policy=policy,
            warnings=warnings,
            missing_media_count=len(missing_media_items),
        )

        manifest = {
            "manifest_version": 1,
            "experiment_id": str(experiment.id),
            "experiment_name": experiment.name,
            "modality": experiment.modality,
            "annotation_type": experiment.label_schema.get("annotation_type"),
            "schema_version": experiment.label_schema.get("schema_version", 1),
            "instructions": experiment.instructions or "",
            "overlap_n": experiment.overlap_n,
            "gold_ratio": experiment.gold_ratio,
            "access_mode": experiment.access_mode,
            "metadata_schema": experiment.metadata_schema or [],
            "qualification_form": experiment.qualification_form or [],
            "routing_rules": experiment.routing_rules or [],
            "sensitive_data_notice": "Annotator qualification answers and responses may contain sensitive or personal declarations. They are included for experiment reproducibility and provenance purposes. Access tokens, user accounts, and direct contact details have been scrubbed.",
            "export_mode": job.mode,
            "source_cutoff_at": cutoff_at.isoformat(),
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "source_fingerprint": job.source_fingerprint,
            "policy": policy.model_dump(),
            "algorithm": algorithm_info,
            "counts": counts,
            "annotator_summary": annotator_summary,
            "training_ready": training_ready,
            "warnings": warnings,
            "missing_media": missing_media_items,
        }

        methodology = {
            "export_mode": job.mode,
            "algorithm": algorithm_info,
            "policy": policy.model_dump(),
            "formulas": {
                "reliability_weight": "(sum(gold_scores) + prior_strength * 0.5) / (gold_items_seen + prior_strength)",
                "medoid_score": "sum_{j!=i}(w_j * sim(a_i, a_j)) / sum_{j!=i}(w_j)",
                "pairwise_agreement": "average similarity across all unordered pairs of annotations",
            },
            "item_statuses": {
                "gold_reference": "Original gold reference answer configured by experiment designer",
                "accepted": "Consensus passed agreement and overlap thresholds",
                "low_evidence": "Accepted result with 2 annotations, below standard 3",
                "needs_review_low_agreement": "Item agreement below configured threshold",
                "needs_review_tie": "Top candidate answers tied with equal weighted score",
                "needs_review_insufficient_overlap": "Fewer than minimum required annotations",
                "needs_review_no_eligible_annotations": "All submitted annotations excluded due to low annotator quality",
                "unannotated": "No annotations were submitted before the cutoff",
            },
        }

        warnings_payload = {
            "generated_at": manifest["generated_at"],
            "training_ready": training_ready,
            "warnings": warnings,
        }

        readme_content = f"""# TaskGlass Export: {experiment.name}

- **Mode:** {job.mode}
- **Modality:** {experiment.modality}
- **Annotation Type:** {experiment.label_schema.get("annotation_type")}
- **Cutoff Time:** {cutoff_at.isoformat()}
- **Training Ready:** {"Yes" if training_ready else "No (see warnings)"}

## Archive Contents
{"- `dataset/samples.jsonl`: Sample catalog mapping media files to original URIs and metadata." if job.mode == "complete" else "- `dataset/final_annotations.jsonl`: Curated training-ready consensus records."}
- `dataset/metadata.csv`: Tabular metadata per sample.
- `media/`: Source media files partitioned by data unit ID.
- `quality/`: Quality audit files including annotator reliability and item agreement metrics.
{"- `annotations/`: Raw and gold submission streams." if job.mode == "complete" else "- `review/`: Flagged samples requiring adjudication or excluded from training."}
- `manifest.json`: Snapshot contract, counts, and checksum metadata.
- `quality/methodology.json`: Complete mathematical formulas and policy thresholds used.

## Provenance and Integrity
Raw submissions are immutable source evidence. Consensus is an auditable derived view.
For questions and inspection, consult `manifest.json` and `quality/methodology.json`.
"""

        # Write root documentation and manifest
        zf.writestr("README.md", readme_content)
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

        # Write quality files common to both modes
        zf.writestr("quality/methodology.json", json.dumps(methodology, indent=2, ensure_ascii=False))
        zf.writestr("quality/warnings.json", json.dumps(warnings_payload, indent=2, ensure_ascii=False))

        # Annotators CSV with format_score and qualification_answers
        annotator_rows = [
            {
                "annotator_export_id": ev.export_id,
                "status": ev.status,
                "total_annotations": ev.total_annotations,
                "gold_items_seen": ev.gold_items_seen,
                "raw_mean_gold_score": format_score(ev.raw_mean_gold_score),
                "reliability_weight": format_score(ev.reliability_weight),
                "rolling_gold_accuracy": format_score(ev.rolling_gold_accuracy),
                "rolling_agreement_score": format_score(ev.rolling_agreement_score),
                "consensus_eligibility": ev.consensus_eligibility,
                "exclusion_reasons": ";".join(ev.exclusion_reasons),
                "qualification_answers": json.dumps(ev.qualification_answers or {}, ensure_ascii=False) if ev.qualification_answers else "",
            }
            for ev in annotator_evidence.values()
        ]
        annotator_fields = [
            "annotator_export_id",
            "status",
            "total_annotations",
            "gold_items_seen",
            "raw_mean_gold_score",
            "reliability_weight",
            "rolling_gold_accuracy",
            "rolling_agreement_score",
            "consensus_eligibility",
            "exclusion_reasons",
            "qualification_answers",
        ]
        zf.writestr("quality/annotators.csv", render_csv(annotator_rows, annotator_fields))

        # Items CSV with format_score
        items_rows = [
            {
                "data_unit_id": str(item.data_unit_id),
                "filename": item.filename,
                "is_gold": item.is_gold,
                "status": item.status,
                "total_annotations": item.votes_total,
                "eligible_annotations": item.votes_used,
                "excluded_annotations": len(item.excluded_annotation_ids),
                "agreement_score": format_score(item.agreement),
                "confidence": format_score(item.confidence),
                "consensus_method": "gold_reference" if item.is_gold else "quality_weighted_medoid",
            }
            for item in items
        ]
        item_fields = [
            "data_unit_id",
            "filename",
            "is_gold",
            "status",
            "total_annotations",
            "eligible_annotations",
            "excluded_annotations",
            "agreement_score",
            "confidence",
            "consensus_method",
        ]
        zf.writestr("quality/items.csv", render_csv(items_rows, item_fields))

        # Metadata CSV
        meta_keys: Set[str] = set()
        for item in items:
            meta_keys.update(item.metadata.keys())
        sorted_meta_keys = sorted(list(meta_keys))

        metadata_rows = []
        for item in items:
            row = {"data_unit_id": str(item.data_unit_id), "filename": item.filename}
            for k in sorted_meta_keys:
                row[k] = item.metadata.get(k, "")
            metadata_rows.append(row)

        zf.writestr("dataset/metadata.csv", render_csv(metadata_rows, ["data_unit_id", "filename"] + sorted_meta_keys))

        # Raw annotations (used in both Complete and Consensus)
        all_raw_annotations = []
        for item in items:
            all_raw_annotations.extend(item.raw_annotations)

        if job.mode == "complete":
            # Complete Archive mode:
            # dataset/samples.jsonl
            samples_records = [
                {
                    "data_unit_id": str(item.data_unit_id),
                    "original_filename": item.filename,
                    "archive_media_path": item.archive_media_path,
                    "raw_uri": item.raw_uri,
                    "is_gold": item.is_gold,
                    "metadata": item.metadata,
                }
                for item in items
            ]
            zf.writestr("dataset/samples.jsonl", render_jsonl(samples_records))

            # annotations/all_annotations.jsonl
            zf.writestr("annotations/all_annotations.jsonl", render_jsonl(all_raw_annotations))

            # annotations/gold_answers.jsonl
            gold_records = [
                {
                    "data_unit_id": str(item.data_unit_id),
                    "filename": item.filename,
                    "gold_answer": item.final_answer,
                    "metadata": item.metadata,
                }
                for item in items
                if item.is_gold
            ]
            zf.writestr("annotations/gold_answers.jsonl", render_jsonl(gold_records))

        else:
            # Consensus Dataset mode:
            # quality/raw_annotations.jsonl
            zf.writestr("quality/raw_annotations.jsonl", render_jsonl(all_raw_annotations))

            # dataset/final_annotations.jsonl (only accepted, gold_reference, and optional low_evidence)
            final_records = []
            needs_review_records = []

            for item in items:
                consensus_meta = {
                    "method": "gold_reference" if item.is_gold else "quality_weighted_medoid",
                    "algorithm_version": 1,
                    "confidence": item.confidence,
                    "agreement": item.agreement,
                    "votes_total": item.votes_total,
                    "votes_used": item.votes_used,
                    "source_annotation_ids": item.source_annotation_ids,
                    "excluded_annotation_ids": item.excluded_annotation_ids,
                    "status": item.status,
                    "warnings": item.item_warnings,
                }

                rec = {
                    "data_unit_id": str(item.data_unit_id),
                    "filename": item.filename,
                    "metadata": item.metadata,
                    "answer": item.final_answer,
                    "consensus": consensus_meta,
                }

                if item.status in ("accepted", "gold_reference") or (
                    item.status == "low_evidence" and policy.include_low_evidence
                ):
                    final_records.append(rec)
                else:
                    needs_review_records.append(rec)

            zf.writestr("dataset/final_annotations.jsonl", render_jsonl(final_records))
            zf.writestr("review/needs_review.jsonl", render_jsonl(needs_review_records))

            # review/excluded_annotations.jsonl
            excluded_records = [a for a in all_raw_annotations if not a["included_in_consensus"]]
            zf.writestr("review/excluded_annotations.jsonl", render_jsonl(excluded_records))

    # Compute size and checksum of completed ZIP
    size_bytes = os.path.getsize(output_zip_path)
    if size_bytes > max_archive_bytes:
        raise ArchiveSizeExceeded(
            f"Generated archive size {size_bytes} exceeds limit of {max_archive_bytes} bytes"
        )
    sha256 = hashlib.sha256()

    with open(output_zip_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    checksum = sha256.hexdigest()

    return size_bytes, checksum

