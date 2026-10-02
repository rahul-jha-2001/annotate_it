import os
from pathlib import Path

from dotenv import load_dotenv


# Load local development settings before any module-level os.getenv calls.
# Existing shell/deployment variables keep precedence over this file.
load_dotenv(Path(__file__).with_name(".env.local"), override=False)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://annotate_user:annotate_password@localhost:5432/annotate_db",
)
# AWS S3 Object Storage Configuration (with local MinIO endpoint support)
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", os.getenv("MINIO_ACCESS_KEY"))
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", os.getenv("MINIO_SECRET_KEY"))
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN")
S3_BUCKET = os.getenv("S3_BUCKET", os.getenv("MINIO_BUCKET", "annotate-it-data"))
# Optional custom S3 endpoint URL (e.g., local MinIO, LocalStack, or custom VPC endpoint)
_raw_endpoint_url = os.getenv("S3_ENDPOINT_URL", os.getenv("MINIO_URL"))
S3_ENDPOINT_URL = _raw_endpoint_url.strip() if _raw_endpoint_url and _raw_endpoint_url.strip() else None

PRESIGNED_URL_EXPIRY_SECONDS = int(os.getenv("PRESIGNED_URL_EXPIRY_SECONDS", "3600"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
SCORE_WINDOW_SIZE = int(os.getenv("SCORE_WINDOW_SIZE", "20"))
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")
CLERK_JWT_KEY = os.getenv("CLERK_JWT_KEY")
CLERK_AUTHORIZED_PARTIES = [
    origin.strip()
    for origin in os.getenv("CLERK_AUTHORIZED_PARTIES", ",".join(CORS_ORIGINS)).split(",")
    if origin.strip()
]
PLATFORM_ADMIN_CLERK_USER_IDS = {
    user_id.strip()
    for user_id in os.getenv("PLATFORM_ADMIN_CLERK_USER_IDS", "").split(",")
    if user_id.strip()
}

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT = os.getenv("LOG_FORMAT", "json").lower()

EXPORT_RETENTION_SECONDS = int(os.getenv("EXPORT_RETENTION_SECONDS", str(7 * 24 * 3600)))
EXPORT_MAX_ARCHIVE_BYTES = int(os.getenv("EXPORT_MAX_ARCHIVE_BYTES", str(10 * 1024 * 1024 * 1024)))
EXPORT_MAX_UNCOMPRESSED_BYTES = int(os.getenv("EXPORT_MAX_UNCOMPRESSED_BYTES", str(20 * 1024 * 1024 * 1024)))
EXPORT_POLL_INTERVAL_SECONDS = float(os.getenv("EXPORT_POLL_INTERVAL_SECONDS", "2.0"))

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
RATE_LIMIT_SECRET = (
    os.getenv("RATE_LIMIT_SECRET")
    or CLERK_SECRET_KEY
    or "taskglass-development-rate-limit-secret"
)
RATE_LIMIT_TRUSTED_PROXY_CIDRS = [
    cidr.strip()
    for cidr in os.getenv(
        "RATE_LIMIT_TRUSTED_PROXY_CIDRS",
        "127.0.0.1/32,::1/128,172.16.0.0/12",
    ).split(",")
    if cidr.strip()
]
RATE_LIMIT_GLOBAL_PER_MINUTE = int(os.getenv("RATE_LIMIT_GLOBAL_PER_MINUTE", "120"))
RATE_LIMIT_SESSION_PER_MINUTE = int(os.getenv("RATE_LIMIT_SESSION_PER_MINUTE", "10"))
RATE_LIMIT_UPLOAD_PER_MINUTE = int(os.getenv("RATE_LIMIT_UPLOAD_PER_MINUTE", "30"))
RATE_LIMIT_EXPORT_PER_MINUTE = int(os.getenv("RATE_LIMIT_EXPORT_PER_MINUTE", "20"))

INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "taskglass-dev-internal-service-key")
BUNDLE_UPLOAD_MAX_UNCOMPRESSED_BYTES = int(
    os.getenv("BUNDLE_UPLOAD_MAX_UNCOMPRESSED_BYTES", str(10 * 1024 * 1024 * 1024))
)
BUNDLE_UPLOAD_TIMEOUT_MINUTES = int(os.getenv("BUNDLE_UPLOAD_TIMEOUT_MINUTES", "20"))

