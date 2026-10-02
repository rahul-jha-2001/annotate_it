import logging
import os
import shutil
import tempfile
import uuid
import zipfile
from typing import Any, Dict, List, Optional

import boto3
from botocore.client import Config
import httpx

from config import (
    AWS_ACCESS_KEY_ID,
    AWS_REGION,
    AWS_SECRET_ACCESS_KEY,
    AWS_SESSION_TOKEN,
    BUNDLE_UPLOAD_MAX_UNCOMPRESSED_BYTES,
    INTERNAL_SERVICE_KEY,
    S3_BUCKET,
    S3_ENDPOINT_URL,
)

logger = logging.getLogger(__name__)

MODALITY_ALLOWED_EXTENSIONS: Dict[str, set[str]] = {
    "audio": {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".wma"},
    "video": {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"},
    "text": {".txt", ".json", ".csv", ".md"},
}


def get_default_s3_client():
    kwargs: Dict[str, Any] = {
        "region_name": AWS_REGION,
        "config": Config(signature_version="s3v4"),
    }
    if S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = S3_ENDPOINT_URL
    if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
        kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
        kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
    if AWS_SESSION_TOKEN:
        kwargs["aws_session_token"] = AWS_SESSION_TOKEN
    return boto3.client("s3", **kwargs)


def process_bundle_upload(
    experiment_id: str,
    job_id: str,
    s3_key: str,
    modality: Optional[str] = None,
    bucket: Optional[str] = None,
    backend_url: Optional[str] = None,
    internal_service_key: Optional[str] = None,
    api_client: Optional[Any] = None,
    s3_client: Optional[Any] = None,
    max_uncompressed_bytes: Optional[int] = None,
) -> Dict[str, Any]:
    bucket = bucket or S3_BUCKET
    internal_service_key = internal_service_key or INTERNAL_SERVICE_KEY
    max_bytes = max_uncompressed_bytes or BUNDLE_UPLOAD_MAX_UNCOMPRESSED_BYTES
    s3 = s3_client or get_default_s3_client()

    close_client = False
    client = api_client
    if client is None:
        client = httpx.Client(base_url=backend_url or "http://127.0.0.1:8000")
        close_client = True

    headers = {"X-Internal-Service-Key": internal_service_key}
    tmp_dir = tempfile.mkdtemp(prefix="bundle_upload_")
    applied: List[str] = []
    errors: List[Dict[str, str]] = []
    files_processed = 0
    files_total = 0

    def patch_job(patch_payload: Dict[str, Any]):
        patch_url = f"/experiments/{experiment_id}/bundle-upload/{job_id}"
        resp = client.patch(patch_url, json=patch_payload, headers=headers)
        if resp.status_code >= 400:
            logger.error("Failed to patch job %s: status=%d text=%s", job_id, resp.status_code, resp.text)
        return resp

    try:
        # Mark job as processing
        patch_job({"status": "processing"})

        # Download archive
        zip_path = os.path.join(tmp_dir, "archive.zip")
        s3.download_file(bucket, s3_key, zip_path)

        # Inspect central directory for security guardrails
        with zipfile.ZipFile(zip_path, "r") as zf:
            total_uncompressed = sum(info.file_size for info in zf.infolist())
            if total_uncompressed > max_bytes:
                raise ValueError(
                    f"Uncompressed archive size {total_uncompressed} bytes exceeds limit of {max_bytes} bytes"
                )

            dest_dir = os.path.abspath(os.path.join(tmp_dir, "extracted"))
            os.makedirs(dest_dir, exist_ok=True)

            # Zip-slip protection & structure validation
            has_media_root = False
            for member in zf.infolist():
                norm_name = os.path.normpath(member.filename).replace("\\", "/")
                if norm_name.startswith("media/") or norm_name == "media":
                    has_media_root = True

                target_path = os.path.abspath(os.path.join(dest_dir, member.filename))
                if not (target_path == dest_dir or target_path.startswith(dest_dir + os.sep)):
                    raise ValueError(f"Zip slip detected: path traversal attempt in {member.filename}")

            if not has_media_root:
                raise ValueError("Archive must contain a top-level 'media/' directory")

            zf.extractall(dest_dir)

        media_dir = os.path.join(dest_dir, "media")
        if not os.path.isdir(media_dir):
            raise ValueError("Archive must contain a top-level 'media/' directory")

        # Discover all candidate files inside media/
        candidate_files: List[tuple[str, str]] = []  # (abs_path, rel_path)
        for root, dirs, files in os.walk(media_dir):
            # Exclude hidden directories
            dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__MACOSX"]
            for file in sorted(files):
                if file.startswith(".") or file == "Thumbs.db":
                    continue
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, media_dir).replace("\\", "/")
                candidate_files.append((abs_path, rel_path))

        files_total = len(candidate_files)
        if files_total == 0:
            raise ValueError("No files found inside 'media/' directory")

        patch_job({"files_total": files_total, "files_processed": 0})

        allowed_exts = MODALITY_ALLOWED_EXTENSIONS.get(modality.lower()) if modality else None

        for abs_path, rel_path in candidate_files:
            file_ext = os.path.splitext(rel_path)[1].lower()
            if allowed_exts and file_ext not in allowed_exts:
                errors.append({
                    "filename": rel_path,
                    "error": f"Invalid extension '{file_ext}' for modality '{modality}'",
                })
                files_processed += 1
                continue

            target_key = f"experiments/{experiment_id}/{uuid.uuid4()}/{os.path.basename(rel_path)}"
            try:
                s3.upload_file(abs_path, bucket, target_key)
                s3_uri = f"s3://{bucket}/{target_key}"
                resp = client.post(
                    f"/experiments/{experiment_id}/data-units",
                    json={"items": [{"raw_uri": s3_uri}]},
                    headers=headers,
                )
                if resp.status_code == 200:
                    applied.append(rel_path)
                else:
                    errors.append({
                        "filename": rel_path,
                        "error": f"Registration failed ({resp.status_code}): {resp.text}",
                    })
            except Exception as file_exc:
                logger.warning("Failed processing file %s: %s", rel_path, file_exc)
                errors.append({"filename": rel_path, "error": str(file_exc)})

            files_processed += 1
            if files_processed % 5 == 0 or files_processed == files_total:
                patch_job({
                    "files_processed": files_processed,
                    "files_total": files_total,
                    "applied": applied,
                    "errors": errors,
                })

        final_status = "completed" if len(applied) > 0 else "failed"
        if len(applied) == 0 and not errors:
            errors.append({"filename": "archive", "error": "No valid data units were processed"})

        patch_job({
            "status": final_status,
            "applied": applied,
            "errors": errors,
            "files_processed": files_processed,
            "files_total": files_total,
        })

        # Delete original zip from zip-uploads/
        try:
            s3.delete_object(Bucket=bucket, Key=s3_key)
        except Exception as del_err:
            logger.warning("Could not delete archive %s: %s", s3_key, del_err)

        return {
            "status": final_status,
            "applied": applied,
            "errors": errors,
            "files_processed": files_processed,
            "files_total": files_total,
        }

    except Exception as exc:
        logger.exception("Bundle upload processing failed for job %s: %s", job_id, exc)
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
        except Exception as patch_exc:
            logger.error("Failed to patch job status to failed: %s", patch_exc)
        raise

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        if close_client and client:
            client.close()
