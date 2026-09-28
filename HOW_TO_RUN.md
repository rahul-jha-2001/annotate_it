# How to Run

Open three terminals in the repository root.

## 1. Start PostgreSQL and MinIO (Local Development)

```bash
POSTGRES_PORT=5433 docker compose -f docker-compose.dev.yml up -d
```

## 2. Configure Clerk

Create a Clerk application, then add `frontend/.env.local`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
```

Configure Google, Microsoft, email/password, or other sign-in methods in the
Clerk Dashboard. The application code does not need separate credentials for
each provider.

Export the matching backend secret before starting FastAPI:

```bash
export CLERK_SECRET_KEY="sk_test_your_key"
export CLERK_AUTHORIZED_PARTIES="http://localhost:5173"
```

After creating a user in Clerk, you can explicitly make it a platform
administrator with its Clerk user ID:

```bash
export PLATFORM_ADMIN_CLERK_USER_IDS="user_your_clerk_id"
```

If no explicit administrator is configured, the first user inserted into an
empty local database becomes the bootstrap administrator.

## 3. Start the backend

```bash
cd backend

DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db \
uv run alembic upgrade head

DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db \
uv run uvicorn main:app --reload --port 8000
```

API: <http://localhost:8000>
API documentation: <http://localhost:8000/docs>

See
[`AUTHENTICATION.md`](AUTHENTICATION.md) for production configuration and the
authorization model.

## 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: <http://localhost:5173>

## Stop the services

From the repository root:

```bash
POSTGRES_PORT=5433 docker compose -f docker-compose.dev.yml down
```
