# Authentication and Authorization

Clerk is the source of truth for identity, credentials, account verification,
connected sign-in methods, sessions, and account-security UI. PostgreSQL remains
the source of truth for product authorization: local user status, platform-admin
access, experiment ownership, and optional annotator-to-user linkage.

## Request flow

1. `ClerkProvider` initializes the frontend from `VITE_CLERK_PUBLISHABLE_KEY`.
2. Clerk's `SignIn`, `SignUp`, and `UserProfile` components handle account flows.
3. `frontend/src/api.ts` obtains the current short-lived Clerk session token and
   sends it to FastAPI as `Authorization: Bearer <token>`.
4. `backend/auth.py` verifies the token with Clerk's Python SDK. Verification
   checks the signature, expiry, accepted token type, and authorized party.
5. The verified Clerk `sub` claim resolves `app_user.clerk_user_id`. On the first
   request for an identity, the backend fetches its Clerk profile and creates or
   links the local user synchronously.
6. Normal local ownership and platform-admin checks decide whether the request
   may access an experiment.

Authentication succeeding never grants access to every experiment. Clerk proves
who the caller is; the application database decides what that caller may do.

## Clerk setup

Create an application in the Clerk Dashboard and enable the desired sign-in
methods. Google and Microsoft are the initial recommendation, but Clerk can also
provide email/password, email code/link, passkeys, and other configured methods
without adding provider-specific backend routes here.

Add the publishable key to `frontend/.env.local`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
```

Set the backend environment:

```bash
export CLERK_SECRET_KEY="sk_test_your_key"
export CLERK_AUTHORIZED_PARTIES="http://localhost:5173"
```

`CLERK_SECRET_KEY` is used for verification-key discovery and the one-time Clerk
profile lookup when creating a local user. It must never use the `VITE_` prefix
or be exposed to browser code.

Optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLERK_JWT_KEY` | unset | PEM public key for networkless token verification |
| `CLERK_AUTHORIZED_PARTIES` | `CORS_ORIGINS` | Comma-separated allowed frontend origins for `azp` validation |
| `PLATFORM_ADMIN_CLERK_USER_IDS` | unset | Comma-separated Clerk IDs that must receive platform-admin access |

The first local user becomes the bootstrap administrator when the user table is
empty. For production, set `PLATFORM_ADMIN_CLERK_USER_IDS` explicitly. Adding an
ID grants admin on its next authenticated request; removing it does not
automatically demote an administrator, which prevents accidental lockout.

## Local user lifecycle

`app_user` stores the stable internal UUID used by foreign keys plus a unique
`clerk_user_id`. It also caches email, display name, and avatar for product views.
An existing pre-Clerk local user with the same email is linked on first sign-in
only when it has no Clerk ID. An email already linked to a different Clerk ID is
rejected.

The login path creates the local row synchronously instead of depending on a
webhook, so experiment creation cannot race with eventually delivered user
events. A future verified Clerk webhook can refresh cached profile fields or
handle deletion, but must not become the only creation path.

## Authorization rules

| Capability | Anonymous visitor | Designer | Platform admin |
| --- | ---: | ---: | ---: |
| Browse public modality/task catalogs | Yes | Yes | Yes |
| Annotate through an active share link | Yes | Yes | Yes |
| Create an experiment | No | Yes | Yes |
| View/change own experiments | No | Yes | Yes |
| View/change another user's experiment | No | No | Yes |
| Access a legacy experiment with no owner | No | No | Yes |
| Manage own identity and sessions | No | Yes, through Clerk | Yes, through Clerk |

New experiments always receive the authenticated local user's `owner_id`.
Inaccessible experiment IDs return `404` to avoid revealing that a resource
exists.

## Experiment annotator access

Each experiment selects `sign_in_required`, `guest_name`, or `anonymous` access.
Sign-in-required sessions must resolve a Clerk identity and store its local
`user_id`. Guest-name sessions store an explicitly unverified display name on the
experiment-scoped `Annotator`. Anonymous sessions deliberately avoid account
linkage even if the browser currently has a Clerk session. Every mode still
retains questionnaire answers, annotations, progress, and quality scores under a
stable session identifier. The access mode can change only before the first
annotation is submitted.

## Production checklist

- Use Clerk production keys and configure production domains in Clerk.
- Set exact HTTPS origins in `CLERK_AUTHORIZED_PARTIES` and `CORS_ORIGINS`.
- Keep `CLERK_SECRET_KEY` in a deployment secret manager.
- Prefer `CLERK_JWT_KEY` for networkless verification and planned key rotation.
- Explicitly configure at least one platform-admin Clerk user ID.
- Run `uv run alembic upgrade head` during deployment.
- Configure and verify webhook signatures before adding profile-sync or deletion
  handlers; webhook delivery must not be assumed synchronous.

## Main code locations

- `backend/auth.py`: Clerk verification and local-user resolution.
- `backend/models.py`: local user and ownership relationships.
- `backend/main.py`: route authentication and owner checks.
- `frontend/src/main.tsx`: `ClerkProvider` setup.
- `frontend/src/api.ts`: authenticated API requests.
- `frontend/src/components/Login.tsx`: Clerk sign-in/sign-up UI.
- `frontend/src/components/Profile.tsx`: Clerk user-management UI.

Clerk Organizations are intentionally deferred until team workspaces and
invitations are introduced. Experiment authorization remains local in the
meantime.
