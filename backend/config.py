import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://annotate_user:annotate_password@localhost:5432/annotate_db",
)
MINIO_URL = os.getenv("MINIO_URL", "http://localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "annotate-it-data")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
SCORE_WINDOW_SIZE = int(os.getenv("SCORE_WINDOW_SIZE", "20"))
