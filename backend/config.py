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
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", os.getenv("MINIO_URL"))

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
