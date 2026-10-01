import argparse
import datetime
import logging
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
import uuid
from typing import Callable, Optional

import boto3
from botocore.client import Config
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, sessionmaker

from config import (
    AWS_ACCESS_KEY_ID,
    AWS_REGION,
    AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN,
    EXPORT_MAX_ARCHIVE_BYTES,
    EXPORT_POLL_INTERVAL_SECONDS,
    EXPORT_RETENTION_SECONDS,
    LOG_FORMAT,
    LOG_LEVEL,
    S3_BUCKET,
    S3_ENDPOINT_URL,
)
from database import SessionLocal, RepeatableReadSessionLocal, engine
from logging_config import setup_logging
from models import Annotation, DataUnit, Experiment, ExportJob
from services.export_service import (
    ArchiveSizeExceeded,
    ConsensusPolicy,
    ExportCancelled,
    build_export_archive,
    compute_source_fingerprint,
    evaluate_export_snapshot,
)

setup_logging(log_level=LOG_LEVEL, log_format=LOG_FORMAT)
logger = logging.getLogger("export_worker")

EXPORT_JOB_TIMEOUT_SECONDS = int(os.getenv("EXPORT_JOB_TIMEOUT_SECONDS", "1800"))
LEASE_DURATION_SECONDS = int(os.getenv("EXPORT_LEASE_DURATION_SECONDS", "60"))
HEARTBEAT_INTERVAL_SECONDS = int(os.getenv("EXPORT_HEARTBEAT_INTERVAL_SECONDS", "15"))


# Setup S3 Client
s3_kwargs = {
    "region_name": AWS_REGION,
    "config": Config(signature_version="s3v4"),
}
if S3_ENDPOINT_URL:
    s3_kwargs["endpoint_url"] = S3_ENDPOINT_URL
if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
    s3_kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
    s3_kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
if AWS_SESSION_TOKEN:
    s3_kwargs["aws_session_token"] = AWS_SESSION_TOKEN

s3_client = boto3.client("s3", **s3_kwargs)


class JobHeartbeat(threading.Thread):
    """Background thread that periodically renews the lease on a running job (Finding 3)."""
    def __init__(
        self,
        job_id: uuid.UUID,
        worker_id: str,
        interval: int = HEARTBEAT_INTERVAL_SECONDS,
        lease_duration: int = LEASE_DURATION_SECONDS,
    ):
        super().__init__(daemon=True)
        self.job_id = job_id
        self.worker_id = worker_id
        self.interval = interval
        self.lease_duration = lease_duration
        self.stop_event = threading.Event()
        self.lost_lease = False

    def run(self):
        while not self.stop_event.wait(self.interval):
            try:
                with SessionLocal() as db:
                    now = datetime.datetime.now(datetime.timezone.utc)
                    new_expiry = now + datetime.timedelta(seconds=self.lease_duration)
                    rows_updated = (
                        db.query(ExportJob)
                        .filter(
                            ExportJob.id == self.job_id,
                            ExportJob.worker_id == self.worker_id,
                            ExportJob.status == "running",
                        )
                        .update({"lease_expires_at": new_expiry})
                    )
                    db.commit()
                    if rows_updated == 0:
                        logger.error(
                            f"Worker {self.worker_id} lost lease on job {self.job_id}; stopping heartbeat."
                        )
                        self.lost_lease = True
                        break
            except Exception as exc:
                logger.warning(f"Failed to heartbeat job {self.job_id}: {exc}")

    def stop(self):
        self.stop_event.set()


def reclaim_stale_running_jobs(db: Session, max_age_seconds: int = EXPORT_JOB_TIMEOUT_SECONDS) -> int:
    """Finds jobs stranded in 'running' state whose lease has expired without renewal (worker crashed or timed out)

    and marks them failed with 'worker_timeout' error code (Finding 3 & 4).
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    fallback_cutoff = now - datetime.timedelta(seconds=max_age_seconds)


    stale_jobs = (
        db.query(ExportJob)
        .filter(
            ExportJob.status == "running",
            or_(
                ExportJob.lease_expires_at <= now,
                and_(
                    ExportJob.lease_expires_at.is_(None),
                    ExportJob.started_at <= fallback_cutoff,
                ),
            ),
        )
        .with_for_update(skip_locked=True)
        .all()
    )
    for job in stale_jobs:
        job.status = "failed"
        job.error_code = "worker_timeout"
        job.error_message = (
            "Export job lease expired without heartbeat renewal (worker crashed or timed out)."
        )
        job.completed_at = now
        logger.warning(
            "export.reclaimed_stale_job",
            extra={
                "job_id": str(job.id),
                "experiment_id": str(job.experiment_id),
                "worker_id": job.worker_id,
                "lease_expires_at": job.lease_expires_at.isoformat() if job.lease_expires_at else None,
            },
        )
    if stale_jobs:
        db.commit()
    return len(stale_jobs)


def claim_next_job(
    db: Session,
    worker_id: Optional[str] = None,
    lease_duration_seconds: int = LEASE_DURATION_SECONDS,
) -> Optional[uuid.UUID]:
    """Atomically claims the next queued export job using FOR UPDATE SKIP LOCKED.

    Sets worker_id and initial lease_expires_at. Also reclaims any stale running jobs first.
    """
    reclaim_stale_running_jobs(db)
    job = (
        db.query(ExportJob)
        .filter(ExportJob.status == "queued")
        .order_by(ExportJob.created_at.asc())
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        return None

    now = datetime.datetime.now(datetime.timezone.utc)
    job.status = "running"
    job.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
    job.started_at = now
    job.lease_expires_at = now + datetime.timedelta(seconds=lease_duration_seconds)
    db.commit()
    logger.info(
        "export.started",
        extra={
            "job_id": str(job.id),
            "experiment_id": str(job.experiment_id),
            "mode": job.mode,
            "worker_id": job.worker_id,
        },
    )
    return job.id


def _delete_export_object(s3, bucket: str, key: str) -> None:
    try:
        s3.delete_object(Bucket=bucket, Key=key)
    except Exception as exc:
        logger.warning(
            "export.artifact_cleanup_failed",
            extra={"bucket": bucket, "key": key, "error": str(exc)},
        )


class _CancellationAwareReader:
    def __init__(self, stream, cancel_event, lease_was_lost: Callable[[], bool]):
        self._stream = stream
        self._cancel_event = cancel_event
        self._lease_was_lost = lease_was_lost

    def read(self, size: int = -1):
        if (self._cancel_event and self._cancel_event.is_set()) or self._lease_was_lost():
            raise ExportCancelled("Worker stopped or lost its lease while uploading the archive")
        return self._stream.read(size)

    def __getattr__(self, name):
        return getattr(self._stream, name)


def upload_archive_with_cancellation(
    *,
    s3,
    archive_path: str,
    bucket: str,
    key: str,
    cancel_event: Optional[threading.Event],
    lease_was_lost: Callable[[], bool],
) -> None:
    """Upload an archive and remove it if cancellation or lease loss occurred mid-upload."""
    with open(archive_path, "rb") as archive:
        reader = _CancellationAwareReader(archive, cancel_event, lease_was_lost)
        try:
            s3.upload_fileobj(
                reader,
                bucket,
                key,
                ExtraArgs={"ContentType": "application/zip"},
            )
        except ExportCancelled:
            _delete_export_object(s3, bucket, key)
            raise

    if (cancel_event and cancel_event.is_set()) or lease_was_lost():
        _delete_export_object(s3, bucket, key)
        raise ExportCancelled("Worker stopped or lost its lease while uploading the archive")


def finalize_ready_job(
    *,
    db: Session,
    job_id: uuid.UUID,
    worker_id: str,
    object_uri: str,
    size_bytes: int,
    sha256_hash: str,
    now: datetime.datetime,
) -> bool:
    """Publish a completed job only while this worker still owns a live lease."""
    rows = (
        db.query(ExportJob)
        .filter(
            ExportJob.id == job_id,
            ExportJob.worker_id == worker_id,
            ExportJob.status == "running",
            ExportJob.lease_expires_at > now,
        )
        .update({
            "status": "ready",
            "object_uri": object_uri,
            "size_bytes": size_bytes,
            "sha256": sha256_hash,
            "completed_at": now,
            "expires_at": now + datetime.timedelta(seconds=EXPORT_RETENTION_SECONDS),
        })
    )
    db.commit()
    return rows == 1


def process_export_job(
    job_id: uuid.UUID,
    worker_id: Optional[str] = None,
    cancel_event: Optional[threading.Event] = None,
) -> bool:
    """Executes a single export job inside a dedicated REPEATABLE READ snapshot

    with renewable lease heartbeat, streaming bounds, and graceful interruption (Findings 2, 3, 4).
    """
    start_time = time.perf_counter()

    with SessionLocal() as db:
        job = db.query(ExportJob).filter_by(id=job_id).first()
        if not job or job.status != "running":
            return False
        if worker_id and job.worker_id and job.worker_id != worker_id:
            logger.warning(f"Job {job_id} is owned by worker {job.worker_id}, not {worker_id}")
            return False
        actual_worker_id = job.worker_id or worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        if job.worker_id != actual_worker_id or job.lease_expires_at is None:
            job.worker_id = actual_worker_id
            if job.lease_expires_at is None:
                job.lease_expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=LEASE_DURATION_SECONDS)
            db.commit()
        job_experiment_id = job.experiment_id
        job_mode = job.mode
        job_policy = job.policy
        job_source_cutoff_at = job.source_cutoff_at
        job_source_fingerprint = job.source_fingerprint


    heartbeat = JobHeartbeat(job_id=job_id, worker_id=actual_worker_id)
    heartbeat.start()

    temp_dir = tempfile.mkdtemp(prefix=f"taskglass_export_{job_id}_")
    zip_path = os.path.join(temp_dir, f"export_{job_id}.zip")
    s3_key = f"exports/{job_experiment_id}/{job_id}.zip"

    try:
        if cancel_event and cancel_event.is_set():
            raise ExportCancelled("Worker received cancellation/shutdown signal")

        with RepeatableReadSessionLocal() as rr_db:
            experiment = rr_db.query(Experiment).filter_by(id=job_experiment_id).first()
            if not experiment or experiment.status == "deleted":
                with SessionLocal() as db:
                    db.query(ExportJob).filter(
                        ExportJob.id == job_id,
                        ExportJob.worker_id == actual_worker_id,
                        ExportJob.status == "running",
                    ).update({
                        "status": "failed",
                        "error_code": "experiment_unavailable",
                        "error_message": "Experiment has been deleted or is unavailable.",
                        "completed_at": datetime.datetime.now(datetime.timezone.utc),
                    })
                    db.commit()
                return False

            policy = ConsensusPolicy.model_validate(job_policy)
            items, counts, annotator_summary, warnings, annotator_evidence, current_fp = evaluate_export_snapshot(
                db=rr_db,
                experiment=experiment,
                cutoff_at=job_source_cutoff_at,
                policy=policy,
                mode=job_mode,
            )

            if current_fp != job_source_fingerprint:
                with SessionLocal() as db:
                    db.query(ExportJob).filter(
                        ExportJob.id == job_id,
                        ExportJob.worker_id == actual_worker_id,
                        ExportJob.status == "running",
                    ).update({
                        "status": "failed",
                        "error_code": "source_changed",
                        "error_message": "Dataset was modified after export preflight was computed. Please regenerate.",
                        "completed_at": datetime.datetime.now(datetime.timezone.utc),
                    })
                    db.commit()
                return False

            # Build export archive with bounded streaming and cancel checking
            size_bytes, sha256_hash = build_export_archive(
                db=rr_db,
                experiment=experiment,
                job=job,
                s3_client=s3_client,
                bucket_name=S3_BUCKET,
                output_zip_path=zip_path,
                snapshot_evaluation=(items, counts, annotator_summary, warnings, annotator_evidence),
                max_archive_bytes=EXPORT_MAX_ARCHIVE_BYTES,
                cancel_event=cancel_event,
            )

        if heartbeat.lost_lease:
            raise ExportCancelled(f"Worker {actual_worker_id} lost lease on job {job_id}")

        if cancel_event and cancel_event.is_set():
            raise ExportCancelled("Worker received cancellation/shutdown signal")

        # Upload completed ZIP to S3
        upload_archive_with_cancellation(
            s3=s3_client,
            archive_path=zip_path,
            bucket=S3_BUCKET,
            key=s3_key,
            cancel_event=cancel_event,
            lease_was_lost=lambda: heartbeat.lost_lease,
        )

        if heartbeat.lost_lease or (cancel_event and cancel_event.is_set()):
            _delete_export_object(s3_client, S3_BUCKET, s3_key)
            raise ExportCancelled("Worker stopped or lost its lease before finalization")

        now = datetime.datetime.now(datetime.timezone.utc)
        with SessionLocal() as db:
            finalized = finalize_ready_job(
                db=db,
                job_id=job_id,
                worker_id=actual_worker_id,
                object_uri=f"s3://{S3_BUCKET}/{s3_key}",
                size_bytes=size_bytes,
                sha256_hash=sha256_hash,
                now=now,
            )
            if not finalized:
                _delete_export_object(s3_client, S3_BUCKET, s3_key)
                logger.error(
                    f"Worker {actual_worker_id} could not finalize job {job_id}: "
                    "lease expired, ownership was lost, or status changed"
                )
                return False

        duration_s = time.perf_counter() - start_time
        logger.info(
            "export.completed",
            extra={
                "job_id": str(job_id),
                "experiment_id": str(job_experiment_id),
                "mode": job_mode,
                "size_bytes": size_bytes,
                "sha256": sha256_hash,
                "duration_s": round(duration_s, 2),
            },
        )
        return True

    except ArchiveSizeExceeded as exc:
        logger.error(f"Export job {job_id} exceeded size limit: {exc}")
        now = datetime.datetime.now(datetime.timezone.utc)
        with SessionLocal() as db:
            db.query(ExportJob).filter(
                ExportJob.id == job_id,
                ExportJob.worker_id == actual_worker_id,
                ExportJob.status == "running",
            ).update({
                "status": "failed",
                "error_code": "archive_too_large",
                "error_message": str(exc),
                "completed_at": now,
            })
            db.commit()
        return False

    except ExportCancelled as exc:
        logger.warning(f"Export job {job_id} cancelled or interrupted: {exc}")
        now = datetime.datetime.now(datetime.timezone.utc)
        with SessionLocal() as db:
            db.query(ExportJob).filter(
                ExportJob.id == job_id,
                ExportJob.worker_id == actual_worker_id,
                ExportJob.status == "running",
            ).update({
                "status": "failed",
                "error_code": "worker_shutdown",
                "error_message": f"Export job was cancelled or interrupted: {str(exc)}",
                "completed_at": now,
            })
            db.commit()
        return False

    except Exception as exc:
        logger.exception(f"Export job {job_id} failed: {exc}")
        try:
            s3_client.delete_object(Bucket=S3_BUCKET, Key=s3_key)
        except Exception:
            pass

        now = datetime.datetime.now(datetime.timezone.utc)
        with SessionLocal() as db:
            db.query(ExportJob).filter(
                ExportJob.id == job_id,
                ExportJob.worker_id == actual_worker_id,
                ExportJob.status == "running",
            ).update({
                "status": "failed",
                "error_code": "generation_failed",
                "error_message": f"Archive generation failed: {str(exc)}",
                "completed_at": now,
            })
            db.commit()
        return False

    finally:
        heartbeat.stop()
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


def cleanup_expired_exports() -> int:
    """Deletes expired export artifacts from S3 and transitions job status to 'expired'."""
    now = datetime.datetime.now(datetime.timezone.utc)
    expired_count = 0

    with SessionLocal() as db:
        expired_jobs = (
            db.query(ExportJob)
            .filter(
                ExportJob.status == "ready",
                ExportJob.expires_at <= now,
            )
            .all()
        )

        for job in expired_jobs:
            if job.object_uri and job.object_uri.startswith("s3://"):
                remainder = job.object_uri[5:]
                b_name, key = remainder.split("/", 1) if "/" in remainder else (S3_BUCKET, remainder)
                try:
                    s3_client.delete_object(Bucket=b_name, Key=key)
                except Exception as exc:
                    logger.warning(f"Failed to delete S3 artifact for job {job.id}: {exc}")

            job.status = "expired"
            expired_count += 1
            logger.info(
                "export.expired",
                extra={
                    "job_id": str(job.id),
                    "experiment_id": str(job.experiment_id),
                },
            )

        if expired_count > 0:
            db.commit()

    return expired_count


class WorkerRunner:
    def __init__(self, worker_id: Optional[str] = None):
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        self.running = True
        self.current_job_id: Optional[uuid.UUID] = None
        self.cancel_event = threading.Event()
        signal.signal(signal.SIGINT, self._handle_exit)
        signal.signal(signal.SIGTERM, self._handle_exit)

    def _handle_exit(self, signum, frame):
        logger.info(f"Signal {signum} received, gracefully interrupting worker...")
        self.running = False
        self.cancel_event.set()

    def run(self, run_once: bool = False):
        logger.info(f"TaskGlass export worker initialized (worker_id={self.worker_id}).")
        while self.running:
            try:
                cleanup_expired_exports()
                with SessionLocal() as db:
                    reclaim_stale_running_jobs(db)

                job_id = None
                with SessionLocal() as db:
                    job_id = claim_next_job(db, worker_id=self.worker_id)

                if job_id:
                    self.current_job_id = job_id
                    try:
                        process_export_job(
                            job_id=job_id,
                            worker_id=self.worker_id,
                            cancel_event=self.cancel_event,
                        )
                    finally:
                        self.current_job_id = None
                    if run_once or not self.running:
                        break
                else:
                    if run_once or not self.running:
                        break
                    time.sleep(EXPORT_POLL_INTERVAL_SECONDS)
            except Exception as exc:
                logger.exception(f"Unexpected error in export worker loop: {exc}")
                if run_once or not self.running:
                    break
                time.sleep(EXPORT_POLL_INTERVAL_SECONDS)


def main():
    parser = argparse.ArgumentParser(description="TaskGlass Asynchronous Export Worker")
    parser.add_argument(
        "--run-once",
        action="store_true",
        help="Process current queued jobs once and exit",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Run expired artifact cleanup and exit",
    )
    args = parser.parse_args()

    if args.cleanup:
        count = cleanup_expired_exports()
        with SessionLocal() as db:
            reclaimed = reclaim_stale_running_jobs(db)
        logger.info(f"Cleaned up {count} expired export jobs and reclaimed {reclaimed} stale jobs.")
        sys.exit(0)

    runner = WorkerRunner()
    runner.run(run_once=args.run_once)


if __name__ == "__main__":
    main()


