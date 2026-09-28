# Annotate It Backend

FastAPI backend for the Annotate It platform.

## Local development

From the repository root, start PostgreSQL and MinIO:

```bash
docker compose -f docker-compose.dev.yml up -d
```

If port 5432 is occupied, use `POSTGRES_PORT=5433 docker compose -f docker-compose.dev.yml up -d` and set
the matching `DATABASE_URL` when running backend commands.

From this directory:

```bash
uv sync
uv run alembic upgrade head
uv run uvicorn main:app --reload
```

Configuration is read from `DATABASE_URL`, `S3_BUCKET` (or `MINIO_BUCKET`), `AWS_REGION`,
`AWS_ACCESS_KEY_ID` (or `MINIO_ACCESS_KEY`), `AWS_SECRET_ACCESS_KEY` (or `MINIO_SECRET_KEY`),
`S3_ENDPOINT_URL` (or `MINIO_URL` for local MinIO), `CORS_ORIGINS`, and `SCORE_WINDOW_SIZE`.

Run unit tests with:

```bash
uv run python -m unittest discover -s tests -v
```

Set `RUN_INTEGRATION=1` to include the API test against local PostgreSQL and
S3/MinIO. Derived scores can be regenerated from source annotations with:

```bash
uv run python rebuild_scores.py [experiment-id]
```
