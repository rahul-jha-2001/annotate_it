"""AWS Lambda function for extracting and registering large-file dataset bundle archives.

Triggered by S3 ObjectCreated events on `zip-uploads/` or direct test/orchestration invocations.
Performs:
1. Zip slip / Zip bomb security inspection.
2. Top-level `media/` directory structure validation.
3. Modality-based file extension filtering.
4. Per-file extraction and upload to `experiments/{id}/{uuid}/{file}`.
5. Atomic batch registration with the backend using the internal service key.
6. CloudWatch-ready structured JSON logging with context correlation.
"""

from __future__ import annotations

import contextvars
import datetime
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from typing import Any, Dict, List, Optional

import boto3
from botocore.client import Config

# Sensitive substrings to redact in structured logs
_SENSITIVE_KEY_SUBSTRINGS = ("password", "secret", "session_token", "private_key", "service_key")

_STANDARD_LOG_RECORD_ATTRS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "id",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
    }
)

# Context variables for request and execution tracing
current_aws_request_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_aws_request_id", default=None
)
current_job_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_job_id", default=None
)
current_experiment_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_experiment_id", default=None
)
current_bucket: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_bucket", default=None
)
current_s3_key: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_s3_key", default=None
)


def clear_logging_context() -> None:
    """Clear all correlation identifiers in the current async context."""
    current_aws_request_id.set(None)
    current_job_id.set(None)
    current_experiment_id.set(None)
    current_bucket.set(None)
    current_s3_key.set(None)


def sanitize_value(key: str, value: Any) -> Any:
    """Mask sensitive string values whose keys resemble passwords, secrets, or service keys."""
    key_lower = key.lower()
    if any(sub in key_lower for sub in _SENSITIVE_KEY_SUBSTRINGS):
        return "***REDACTED***" if value is not None else None
    if isinstance(value, dict):
        return {k: sanitize_value(str(k), v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_value(key, v) for v in value]
    return value


class LambdaJsonLogFormatter(logging.Formatter):
    """Formats log records as structured, single-line JSON objects for CloudWatch / Datadog."""

    def format(self, record: logging.LogRecord) -> str:
        created_dt = datetime.datetime.fromtimestamp(
            record.created, tz=datetime.timezone.utc
        )
        timestamp_str = created_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        message = record.getMessage()

        payload: Dict[str, Any] = {
            "timestamp": timestamp_str,
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }

        # Context correlation fields (record attributes take precedence over ContextVars)
        aws_req = getattr(record, "aws_request_id", None) or current_aws_request_id.get()
        if aws_req:
            payload["aws_request_id"] = str(aws_req)

        job = getattr(record, "job_id", None) or current_job_id.get()
        if job:
            payload["job_id"] = str(job)

        exp = getattr(record, "experiment_id", None) or current_experiment_id.get()
        if exp:
            payload["experiment_id"] = str(exp)

        bkt = getattr(record, "bucket", None) or current_bucket.get()
        if bkt:
            payload["bucket"] = str(bkt)

        key = getattr(record, "s3_key", None) or current_s3_key.get()
        if key:
            payload["s3_key"] = str(key)

        # Extra attributes
        for attr_key, attr_val in record.__dict__.items():
            if (
                attr_key not in _STANDARD_LOG_RECORD_ATTRS
                and attr_key not in payload
                and not attr_key.startswith("_")
            ):
                payload[attr_key] = sanitize_value(attr_key, attr_val)

        # Exception information
        if record.exc_info:
            exc_type, exc_val, exc_tb = record.exc_info
            payload["exception"] = {
                "type": getattr(exc_type, "__name__", str(exc_type)),
                "message": str(exc_val),
                "stacktrace": traceback.format_exception(exc_type, exc_val, exc_tb),
            }

        return json.dumps(payload, default=str)


def setup_logger() -> logging.Logger:
    """Initialize and configure the bundle extractor logger."""
    log = logging.getLogger("bundle_extractor")
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    log.setLevel(getattr(logging, log_level, logging.INFO))

    # Remove pre-existing handlers on this logger to prevent duplicates
    log.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    if os.environ.get("LOG_FORMAT", "json").lower() == "text":
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
    else:
        handler.setFormatter(LambdaJsonLogFormatter())

    log.addHandler(handler)
    log.propagate = False
    return log


logger = setup_logger()

MODALITY_ALLOWED_EXTENSIONS: Dict[str, set[str]] = {
    "audio": {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".wma"},
    "video": {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"},
    "text": {".txt", ".json", ".csv", ".md"},
}

BACKEND_API_URL = os.environ.get("BACKEND_API_URL", "http://127.0.0.1:8000")
INTERNAL_SERVICE_KEY = os.environ.get("INTERNAL_SERVICE_KEY", "taskglass-dev-internal-service-key")
MAX_UNCOMPRESSED_BYTES = int(
    os.environ.get("BUNDLE_UPLOAD_MAX_UNCOMPRESSED_BYTES", str(10 * 1024 * 1024 * 1024))
)


def make_backend_request(path: str, method: str, payload: Dict[str, Any]) -> tuple[int, Dict[str, Any]]:
    """Send an authenticated HTTP request to the internal backend API."""
    url = urllib.parse.urljoin(BACKEND_API_URL.rstrip("/") + "/", path.lstrip("/"))
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
        },
        method=method,
    )

    start_time = time.monotonic()
    logger.debug(
        "backend.request_started",
        extra={"method": method, "endpoint": path, "payload_size_bytes": len(data)},
    )

    try:
        with urllib.request.urlopen(req) as resp:
            elapsed_ms = round((time.monotonic() - start_time) * 1000, 2)
            body = resp.read().decode("utf-8")
            parsed_data = json.loads(body) if body else {}
            logger.debug(
                "backend.request_completed",
                extra={"method": method, "endpoint": path, "status_code": resp.status, "duration_ms": elapsed_ms},
            )
            return resp.status, parsed_data
    except urllib.error.HTTPError as err:
        elapsed_ms = round((time.monotonic() - start_time) * 1000, 2)
        err_body = err.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"detail": err_body}

        logger.warning(
            "backend.request_failed",
            extra={
                "method": method,
                "endpoint": path,
                "status_code": err.code,
                "error_detail": parsed.get("detail", str(parsed)),
                "duration_ms": elapsed_ms,
            },
        )
        return err.code, parsed
    except Exception as exc:
        elapsed_ms = round((time.monotonic() - start_time) * 1000, 2)
        logger.error(
            "backend.request_network_error",
            extra={
                "method": method,
                "endpoint": path,
                "error": str(exc),
                "duration_ms": elapsed_ms,
            },
            exc_info=True,
        )
        return 500, {"detail": f"Network error: {str(exc)}"}


def lambda_handler(event: Dict[str, Any], context: Any = None) -> Dict[str, Any]:
    """Lambda entry point for dataset zip bundle extraction."""
    start_total_time = time.monotonic()

    # Bind AWS Request ID from context if present
    aws_request_id = getattr(context, "aws_request_id", None)
    if aws_request_id:
        current_aws_request_id.set(str(aws_request_id))

    logger.info(
        "bundle_extractor.invocation_started",
        extra={
            "function_name": getattr(context, "function_name", "bundle_extractor"),
            "memory_limit_mb": getattr(context, "memory_limit_in_mb", None),
            "event_keys": list(event.keys()) if isinstance(event, dict) else [],
        },
    )

    s3_kwargs = {
        "config": Config(signature_version="s3v4"),
    }
    if os.environ.get("S3_ENDPOINT_URL"):
        s3_kwargs["endpoint_url"] = os.environ.get("S3_ENDPOINT_URL")
    if os.environ.get("AWS_REGION"):
        s3_kwargs["region_name"] = os.environ.get("AWS_REGION")

    s3 = boto3.client("s3", **s3_kwargs)

    bucket: str = ""
    s3_key: str = ""
    job_id: str = ""
    experiment_id: str = ""
    modality: Optional[str] = None

    if "Records" in event and len(event["Records"]) > 0:
        record = event["Records"][0]
        bucket = record["s3"]["bucket"]["name"]
        s3_key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        event_source = "s3_notification"
    else:
        bucket = event.get("bucket", os.environ.get("S3_BUCKET", "taskglass-media"))
        s3_key = event.get("s3_key") or event.get("key", "")
        job_id = event.get("job_id", "")
        experiment_id = event.get("experiment_id", "")
        modality = event.get("modality")
        event_source = "direct_invocation"

    # If experiment_id is not provided, parse from key: zip-uploads/{experiment_id}/{uuid}/{filename}
    if not experiment_id and s3_key.startswith("zip-uploads/"):
        parts = s3_key.split("/")
        if len(parts) >= 2:
            experiment_id = parts[1]

    # If job_id or modality not provided, fetch from object tags
    if (not job_id or not modality) and bucket and s3_key:
        try:
            logger.debug("bundle_extractor.fetching_tags", extra={"bucket": bucket, "s3_key": s3_key})
            tag_res = s3.get_object_tagging(Bucket=bucket, Key=s3_key)
            tag_map = {t["Key"]: t["Value"] for t in tag_res.get("TagSet", [])}
            if not job_id:
                job_id = tag_map.get("job_id", "")
            if not modality:
                modality = tag_map.get("modality")
            logger.info(
                "bundle_extractor.tags_retrieved",
                extra={"job_id": job_id, "modality": modality, "tag_count": len(tag_map)},
            )
        except Exception as tag_err:
            logger.warning(
                "bundle_extractor.tags_read_failed",
                extra={"bucket": bucket, "s3_key": s3_key, "error": str(tag_err)},
            )

    # Bind contextual identifiers for all subsequent log lines
    if job_id:
        current_job_id.set(job_id)
    if experiment_id:
        current_experiment_id.set(experiment_id)
    if bucket:
        current_bucket.set(bucket)
    if s3_key:
        current_s3_key.set(s3_key)

    logger.info(
        "bundle_extractor.event_parsed",
        extra={
            "event_source": event_source,
            "bucket": bucket,
            "s3_key": s3_key,
            "job_id": job_id,
            "experiment_id": experiment_id,
            "modality": modality,
        },
    )

    if not job_id or not experiment_id:
        logger.error(
            "bundle_extractor.missing_identifiers",
            extra={"job_id": job_id, "experiment_id": experiment_id, "s3_key": s3_key},
        )
        return {"statusCode": 400, "body": "Missing job_id or experiment_id"}

    tmp_dir = tempfile.mkdtemp(prefix="lambda_bundle_")
    applied: List[str] = []
    errors: List[Dict[str, str]] = []
    files_processed = 0
    files_total = 0

    def patch_job(payload: Dict[str, Any]):
        return make_backend_request(
            f"/experiments/{experiment_id}/bundle-upload/{job_id}",
            "PATCH",
            payload,
        )

    try:
        # Mark as processing
        patch_job({"status": "processing"})
        logger.info("bundle_extractor.marked_processing", extra={"job_id": job_id})

        # Download archive
        zip_path = os.path.join(tmp_dir, "archive.zip")
        dl_start = time.monotonic()
        logger.info(
            "bundle_extractor.download_started",
            extra={"bucket": bucket, "s3_key": s3_key, "destination": zip_path},
        )
        s3.download_file(bucket, s3_key, zip_path)
        dl_duration_ms = round((time.monotonic() - dl_start) * 1000, 2)
        archive_size_bytes = os.path.getsize(zip_path)
        logger.info(
            "bundle_extractor.download_completed",
            extra={
                "archive_size_bytes": archive_size_bytes,
                "archive_size_mb": round(archive_size_bytes / (1024 * 1024), 2),
                "duration_ms": dl_duration_ms,
            },
        )

        # Inspect central directory
        inspect_start = time.monotonic()
        with zipfile.ZipFile(zip_path, "r") as zf:
            total_uncompressed = sum(info.file_size for info in zf.infolist())
            total_entries = len(zf.infolist())
            logger.info(
                "bundle_extractor.archive_inspection_started",
                extra={
                    "total_entries": total_entries,
                    "total_uncompressed_bytes": total_uncompressed,
                    "max_allowed_uncompressed_bytes": MAX_UNCOMPRESSED_BYTES,
                },
            )

            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                logger.error(
                    "bundle_extractor.security_violation.zip_bomb",
                    extra={
                        "total_uncompressed_bytes": total_uncompressed,
                        "limit_bytes": MAX_UNCOMPRESSED_BYTES,
                    },
                )
                raise ValueError(
                    f"Uncompressed archive size {total_uncompressed} bytes exceeds limit of {MAX_UNCOMPRESSED_BYTES} bytes"
                )

            dest_dir = os.path.abspath(os.path.join(tmp_dir, "extracted"))
            os.makedirs(dest_dir, exist_ok=True)

            has_media_root = False
            for member in zf.infolist():
                norm_name = os.path.normpath(member.filename).replace("\\", "/")
                if norm_name.startswith("media/") or norm_name == "media":
                    has_media_root = True

                target_path = os.path.abspath(os.path.join(dest_dir, member.filename))
                if not (target_path == dest_dir or target_path.startswith(dest_dir + os.sep)):
                    logger.error(
                        "bundle_extractor.security_violation.zip_slip",
                        extra={"member_filename": member.filename, "target_path": target_path},
                    )
                    raise ValueError(f"Zip slip detected: path traversal attempt in {member.filename}")

            if not has_media_root:
                logger.error("bundle_extractor.validation_failed.missing_media_root")
                raise ValueError("Archive must contain a top-level 'media/' directory")

            zf.extractall(dest_dir)

        inspect_duration_ms = round((time.monotonic() - inspect_start) * 1000, 2)
        logger.info(
            "bundle_extractor.archive_extracted",
            extra={
                "extracted_dir": dest_dir,
                "duration_ms": inspect_duration_ms,
            },
        )

        media_dir = os.path.join(dest_dir, "media")
        if not os.path.isdir(media_dir):
            raise ValueError("Archive must contain a top-level 'media/' directory")

        candidate_files: List[tuple[str, str]] = []
        for root, dirs, files in os.walk(media_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__MACOSX"]
            for file in sorted(files):
                if file.startswith(".") or file == "Thumbs.db":
                    continue
                abs_p = os.path.join(root, file)
                rel_p = os.path.relpath(abs_p, media_dir).replace("\\", "/")
                candidate_files.append((abs_p, rel_p))

        files_total = len(candidate_files)
        logger.info(
            "bundle_extractor.candidate_files_discovered",
            extra={"files_total": files_total, "modality": modality},
        )

        if files_total == 0:
            raise ValueError("No files found inside 'media/' directory")

        patch_job({"files_total": files_total, "files_processed": 0})

        allowed_exts = MODALITY_ALLOWED_EXTENSIONS.get(modality.lower()) if modality else None
        processing_start = time.monotonic()

        for abs_p, rel_p in candidate_files:
            file_ext = os.path.splitext(rel_p)[1].lower()
            if allowed_exts and file_ext not in allowed_exts:
                err_msg = f"Invalid extension '{file_ext}' for modality '{modality}'"
                logger.warning(
                    "bundle_extractor.file_skipped_extension",
                    extra={"filename": rel_p, "extension": file_ext, "modality": modality},
                )
                errors.append({"filename": rel_p, "error": err_msg})
                files_processed += 1
                continue

            target_key = f"experiments/{experiment_id}/{uuid.uuid4()}/{os.path.basename(rel_p)}"
            try:
                file_upload_start = time.monotonic()
                s3.upload_file(abs_p, bucket, target_key)
                file_upload_ms = round((time.monotonic() - file_upload_start) * 1000, 2)
                s3_uri = f"s3://{bucket}/{target_key}"

                status_code, resp_data = make_backend_request(
                    f"/experiments/{experiment_id}/data-units",
                    "POST",
                    {"items": [{"raw_uri": s3_uri}]},
                )
                if status_code == 200:
                    applied.append(rel_p)
                    logger.debug(
                        "bundle_extractor.file_registered",
                        extra={"filename": rel_p, "s3_uri": s3_uri, "upload_ms": file_upload_ms},
                    )
                else:
                    err_msg = f"Registration failed ({status_code}): {resp_data.get('detail', resp_data)}"
                    logger.warning(
                        "bundle_extractor.file_registration_failed",
                        extra={"filename": rel_p, "status_code": status_code, "error": err_msg},
                    )
                    errors.append({"filename": rel_p, "error": err_msg})
            except Exception as file_exc:
                logger.warning(
                    "bundle_extractor.file_processing_exception",
                    extra={"filename": rel_p, "error": str(file_exc)},
                    exc_info=True,
                )
                errors.append({"filename": rel_p, "error": str(file_exc)})

            files_processed += 1
            if files_processed % 5 == 0 or files_processed == files_total:
                logger.info(
                    "bundle_extractor.batch_progress",
                    extra={
                        "files_processed": files_processed,
                        "files_total": files_total,
                        "applied_count": len(applied),
                        "errors_count": len(errors),
                        "percent": round((files_processed / files_total) * 100, 1),
                    },
                )
                patch_job({
                    "files_processed": files_processed,
                    "files_total": files_total,
                    "applied": applied,
                    "errors": errors,
                })

        processing_duration_ms = round((time.monotonic() - processing_start) * 1000, 2)
        final_status = "completed" if len(applied) > 0 else "failed"
        if len(applied) == 0 and not errors:
            errors.append({"filename": "archive", "error": "No valid data units were processed"})

        logger.info(
            "bundle_extractor.processing_finished",
            extra={
                "status": final_status,
                "applied_count": len(applied),
                "errors_count": len(errors),
                "files_total": files_total,
                "duration_ms": processing_duration_ms,
            },
        )

        patch_job({
            "status": final_status,
            "applied": applied,
            "errors": errors,
            "files_processed": files_processed,
            "files_total": files_total,
        })

        try:
            s3.delete_object(Bucket=bucket, Key=s3_key)
            logger.info("bundle_extractor.archive_cleanup_completed", extra={"bucket": bucket, "s3_key": s3_key})
        except Exception as del_err:
            logger.warning(
                "bundle_extractor.archive_cleanup_warning",
                extra={"bucket": bucket, "s3_key": s3_key, "error": str(del_err)},
            )

        total_duration_ms = round((time.monotonic() - start_total_time) * 1000, 2)
        logger.info(
            "bundle_extractor.invocation_completed",
            extra={
                "status": final_status,
                "applied_count": len(applied),
                "errors_count": len(errors),
                "total_duration_ms": total_duration_ms,
            },
        )

        return {
            "statusCode": 200,
            "body": json.dumps({
                "status": final_status,
                "applied_count": len(applied),
                "errors_count": len(errors),
                "duration_ms": total_duration_ms,
            }),
        }

    except Exception as exc:
        total_duration_ms = round((time.monotonic() - start_total_time) * 1000, 2)
        logger.exception(
            "bundle_extractor.invocation_failed",
            extra={
                "job_id": job_id,
                "experiment_id": experiment_id,
                "error_type": type(exc).__name__,
                "error_message": str(exc),
                "total_duration_ms": total_duration_ms,
            },
        )
        current_errors = list(errors)
        current_errors.append({"filename": "archive", "error": str(exc)})
        try:
            patch_job({
                "status": "failed",
                "applied": applied,
                "errors": current_errors,
                "files_processed": files_processed,
                "files_total": files_total,
            })
            logger.info("bundle_extractor.backend_notified_of_failure", extra={"job_id": job_id})
        except Exception as patch_exc:
            logger.error(
                "bundle_extractor.backend_failure_notification_failed",
                extra={"job_id": job_id, "error": str(patch_exc)},
                exc_info=True,
            )

        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc)}),
        }

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        clear_logging_context()
