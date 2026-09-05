# How to Run

Open three terminals in the repository root.

## 1. Start PostgreSQL and MinIO

```bash
POSTGRES_PORT=5433 docker compose up -d
```

## 2. Start the backend

```bash
cd backend

DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db \
uv run alembic upgrade head

DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db \
uv run uvicorn main:app --reload --port 8000
```

API: <http://localhost:8000>
API documentation: <http://localhost:8000/docs>

## 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: <http://localhost:5173>

## Stop the services

From the repository root:

```bash
POSTGRES_PORT=5433 docker compose down
```
