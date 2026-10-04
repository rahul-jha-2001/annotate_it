# Project TODOs

## Lambda Bundle Extractor

- [ ] **Early-Exit Guard for Orphaned / Deleted Experiments**
  - **Target File**: `lambda/bundle_extractor/lambda_function.py`
  - **Context**: When the Lambda function is triggered, it issues an initial status update:
    ```python
    patch_job({"status": "processing"})
    ```
    If the parent experiment was soft-deleted or locked (`status="active"`) right before Lambda invoked, the backend returns `404 Not Found` or `409 Conflict`.
  - **Current Behavior**: The return status code of `patch_job` is currently uninspected. Lambda proceeds to download the multi-gigabyte zip archive from S3, extract it, and repeatedly attempt file registrations (`POST /data-units`) for an experiment that no longer exists.
  - **Required Implementation**:
    1. Inspect the HTTP status code returned by `patch_job({"status": "processing"})`.
    2. If `status_code in (404, 409)`:
       - Log a structured warning (e.g. `bundle_extractor.experiment_unavailable_aborted`).
       - Skip archive download, extraction, and file uploads.
       - Clean up temporary files and return early with an acknowledgment status (e.g. `statusCode: 200` to prevent unnecessary AWS Lambda / SQS event retries).

## User Roles & Permissions (Annotator vs Creator Distinction)

- [ ] **Database Role Distinction (`app_user.role`) & Dedicated Annotator Portal**
  - **Context**: Currently, any user who creates an account or signs in is treated as a full creator in `app_user` with access to the dashboard and experiment creation.
  - **Target Areas**:
    - Backend: `backend/models.py`, `backend/auth.py`, `backend/main.py`
    - Frontend: `frontend/src/App.tsx`, `frontend/src/components/Annotator.tsx`, `frontend/src/components/Dashboard.tsx`
  - **Required Implementation**:
    1. **Data Model**: Add `role` column to `app_user` (`Column(String, nullable=False, default='creator')`, values: `'creator'` | `'annotator'` | `'admin'`).
    2. **Onboarding / Assignment**: Users signing up from `/annotate/:shareToken` are created with `role='annotator'`. Users signing up from the marketing homepage or `/signup` are created with `role='creator'`.
    3. **Backend Enforcement**: Protect `POST /experiments` so accounts with `role='annotator'` are rejected with `403 Forbidden: Annotator accounts cannot create experiments`.
    4. **Dedicated Annotator Dashboard**: Replace the creator experiment table with a worker portal for annotators ("My Assigned Experiments" / "Contribution History" / "Qualification Status") when an annotator logs in directly.
