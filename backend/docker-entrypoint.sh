#!/bin/sh
set -e

# Wait for PostgreSQL database if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ]; then
    echo "Checking database connection..."
    python - << 'EOF'
import os
import sys
import time
from sqlalchemy import create_engine

url = os.getenv("DATABASE_URL")
if not url:
    sys.exit(0)

retries = 30
for attempt in range(1, retries + 1):
    try:
        engine = create_engine(url)
        with engine.connect():
            print("Database is ready.")
            sys.exit(0)
    except Exception as exc:
        print(f"Waiting for database ({attempt}/{retries}): {exc}")
        time.sleep(1)

print("Warning: Database connection timed out. Proceeding anyway.")
EOF

    echo "Running database migrations..."
    alembic upgrade head || echo "Migration failed or already up to date."
fi

exec "$@"
