# Annotate It Backend

FastAPI backend for the Annotate It platform.

## Local development

From the repository root, start PostgreSQL and MinIO:

```bash
docker compose up -d
```

If port 5432 is occupied, use `POSTGRES_PORT=5433 docker compose up -d` and set
the matching `DATABASE_URL` when running backend commands.

From this directory:

```bash
uv sync
uv run alembic upgrade head
uv run uvicorn main:app --reload
```

Configuration is read from `DATABASE_URL`, `MINIO_URL`, `MINIO_ACCESS_KEY`,
`MINIO_SECRET_KEY`, `MINIO_BUCKET`, `CORS_ORIGINS`, and `SCORE_WINDOW_SIZE`.

Run unit tests with:

```bash
uv run python -m unittest discover -s tests -v
```

Set `RUN_INTEGRATION=1` to include the API test against local PostgreSQL and
MinIO. Derived scores can be regenerated from source annotations with:

```bash
uv run python rebuild_scores.py [experiment-id]
```
