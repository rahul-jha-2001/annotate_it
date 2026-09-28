#!/bin/sh
set -e

# Wait for PostgreSQL database if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ]; then
    echo "Checking database connection..."
    if ! python - << 'EOF'
import os
import sys
import time
from sqlalchemy import create_engine

url = os.getenv("DATABASE_URL")
if not url:
    sys.exit(0)

if url.startswith("postgresql://"):
    url = url.replace("postgresql://", "postgresql+psycopg2://", 1)

retries = int(os.getenv("DB_WAIT_RETRIES", "30"))
last_error = None

for attempt in range(1, retries + 1):
    try:
        engine = create_engine(url)
        with engine.connect():
            print("Database connection verified and ready.")
            sys.exit(0)
    except Exception as exc:
        last_error = exc
        if attempt % 5 == 0 or attempt == 1:
            print(f"Waiting for database ({attempt}/{retries})... ({exc})")
        time.sleep(1)

print(f"\n[FATAL] Database connection failed after {retries} attempts: {last_error}", file=sys.stderr)
sys.exit(1)
EOF
    then
        echo "[ERROR] Could not connect to database. Aborting container startup." >&2
        exit 1
    fi

    if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
        echo "Running database migrations (alembic upgrade head)..."
        if alembic upgrade head; then
            echo "Database migrations applied successfully."
        else
            migration_status=$?
            echo "[ERROR] Alembic database migration failed with exit code ${migration_status}." >&2
            echo "Check the migration error output above for details." >&2
            exit "${migration_status}"
        fi
    else
        echo "SKIP_MIGRATIONS=1 detected: Skipping database migrations."
    fi
fi

# Execute the main container command
exec "$@"
