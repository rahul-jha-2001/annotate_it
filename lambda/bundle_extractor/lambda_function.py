import json
import logging
import os
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from typing import Any, Dict, List, Optional

import boto3
from botocore.client import Config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

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
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"detail": err_body}
        return err.code, parsed


def lambda_handler(event: Dict[str, Any], context: Any = None) -> Dict[str, Any]:
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
    else:
        bucket = event.get("bucket", os.environ.get("S3_BUCKET", "taskglass-media"))
        s3_key = event.get("s3_key") or event.get("key", "")
        job_id = event.get("job_id", "")
        experiment_id = event.get("experiment_id", "")
        modality = event.get("modality")

    # If experiment_id is not provided, parse from key: zip-uploads/{experiment_id}/{uuid}/{filename}
    if not experiment_id and s3_key.startswith("zip-uploads/"):
        parts = s3_key.split("/")
        if len(parts) >= 2:
            experiment_id = parts[1]

    # If job_id or modality not provided, fetch from object tags
    if (not job_id or not modality) and bucket and s3_key:
        try:
            tag_res = s3.get_object_tagging(Bucket=bucket, Key=s3_key)
            tag_map = {t["Key"]: t["Value"] for t in tag_res.get("TagSet", [])}
            if not job_id:
                job_id = tag_map.get("job_id", "")
            if not modality:
                modality = tag_map.get("modality")
        except Exception as tag_err:
            logger.warning("Could not read tags for object %s: %s", s3_key, tag_err)

    if not job_id or not experiment_id:
        logger.error("Missing job_id (%s) or experiment_id (%s) for s3_key: %s", job_id, experiment_id, s3_key)
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

        # Download archive
        zip_path = os.path.join(tmp_dir, "archive.zip")
        s3.download_file(bucket, s3_key, zip_path)

        # Inspect central directory
        with zipfile.ZipFile(zip_path, "r") as zf:
            total_uncompressed = sum(info.file_size for info in zf.infolist())
            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
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
                    raise ValueError(f"Zip slip detected: path traversal attempt in {member.filename}")

            if not has_media_root:
                raise ValueError("Archive must contain a top-level 'media/' directory")

            zf.extractall(dest_dir)

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
        if files_total == 0:
            raise ValueError("No files found inside 'media/' directory")

        patch_job({"files_total": files_total, "files_processed": 0})

        allowed_exts = MODALITY_ALLOWED_EXTENSIONS.get(modality.lower()) if modality else None

        for abs_p, rel_p in candidate_files:
            file_ext = os.path.splitext(rel_p)[1].lower()
            if allowed_exts and file_ext not in allowed_exts:
                errors.append({
                    "filename": rel_p,
                    "error": f"Invalid extension '{file_ext}' for modality '{modality}'",
                })
                files_processed += 1
                continue

            target_key = f"experiments/{experiment_id}/{uuid.uuid4()}/{os.path.basename(rel_p)}"
            try:
                s3.upload_file(abs_p, bucket, target_key)
                s3_uri = f"s3://{bucket}/{target_key}"
                status_code, resp_data = make_backend_request(
                    f"/experiments/{experiment_id}/data-units",
                    "POST",
                    {"items": [{"raw_uri": s3_uri}]},
                )
                if status_code == 200:
                    applied.append(rel_p)
                else:
                    errors.append({
                        "filename": rel_p,
                        "error": f"Registration failed ({status_code}): {resp_data.get('detail', resp_data)}",
                    })
            except Exception as file_exc:
                logger.warning("Failed processing file %s: %s", rel_p, file_exc)
                errors.append({"filename": rel_p, "error": str(file_exc)})

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

        try:
            s3.delete_object(Bucket=bucket, Key=s3_key)
        except Exception as del_err:
            logger.warning("Could not delete archive %s: %s", s3_key, del_err)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "status": final_status,
                "applied_count": len(applied),
                "errors_count": len(errors),
            }),
        }

    except Exception as exc:
        logger.exception("Global handler exception for job %s: %s", job_id, exc)
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
            logger.error("Failed to notify backend of failure: %s", patch_exc)

        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc)}),
        }

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
