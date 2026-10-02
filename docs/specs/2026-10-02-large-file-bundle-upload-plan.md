# Technical Specification & Implementation Plan: Large-File Dataset Bundle Upload

## 1. Overview & Architecture

This implementation adds resilient, multi-gigabyte dataset upload capability to TaskGlass. Designers can upload a single zip containing a `media/` directory directly to S3 via chunked, parallel, resumable multipart upload. An S3 `ObjectCreated` event triggers a serverless Lambda function to safely extract files, upload them to their permanent S3 locations, and register them via the existing `DataUnit` API.

Meanwhile, the designer can continue configuring qualifications, routing rules, teaching examples, and label schemas while media processes in the background without blocking.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Browser (TaskGlass UI)                                                 │
│                                                                        │
│ 1. POST /uploads/presign-multipart                                     │
│ 2. Slice file (50-100MB chunks), upload concurrently to S3 with retry  │
│ 3. POST /uploads/complete-multipart                                    │
│ 4. POST /experiments/{id}/bundle-upload → sets draft_media_processing  │
│ 5. Continue editing qualifications / schema (non-blocking)             │
│ 6. Polls GET /experiments/{id}/bundle-upload/{job_id} (owner-only)     │
│    (triggers backend watchdog timeout check if stuck > 20 min)         │
└──────────────────┬─────────────────────────────┬───────────────────────┘
                   │ Direct chunked PUTs         │ API calls
                   ▼                             ▼
┌──────────────────────────────┐        ┌────────────────────────────────┐
│ AWS S3 / MinIO               │        │ FastAPI Backend                │
│ Bucket: zip-uploads/ prefix  │        │                                │
└──────────────┬───────────────┘        │ • Manages multipart presigns   │
               │ S3 ObjectCreated Event │ • Creates bundle_upload_job    │
               ▼                        │ • Manages Experiment.status    │
┌──────────────────────────────┐        │ • Constant-time HMAC service   │
│ AWS Lambda (Python 3.12)     │        │   auth (X-Internal-Service-Key)│
│                              │        │ • Backend timeout watchdog     │
│ 1. Download to /tmp          │        │ • Existing /data-units logic   │
│ 2. Zip-bomb check (< 10GB)   │        └──────────────▲─────────────────┘
│ 3. Zip-slip path traversal   │                       │
│ 4. Extract media/ files      │                       │
│ 5. Upload files to S3        │───────────────────────┘
│ 6. POST /data-units per file │ Calls with X-Internal-Service-Key
│ 7. PATCH /bundle-upload/{id} │ (scoped: experiment must be processing;
│    (top-level try/except/    │  no user impersonation)
│     finally guarantees report│
│ 8. Clean /tmp & delete zip   │
└──────────────────────────────┘
```

---

## 2. Work Breakdown & Milestones

### Milestone 1: Database Model & Alembic Migration
- [x] Add `draft_media_processing` and `draft_media_failed` to valid `Experiment.status` values.
- [x] Create `bundle_upload_job` table:
  - `id UUID PRIMARY KEY`
  - `experiment_id UUID REFERENCES experiment(id) ON DELETE CASCADE`
  - `user_id UUID REFERENCES app_user(id) ON DELETE SET NULL`
  - `s3_key TEXT NOT NULL`
  - `status TEXT NOT NULL` (`queued`, `processing`, `completed`, `failed`)
  - `files_total INT NOT NULL DEFAULT 0`
  - `files_processed INT NOT NULL DEFAULT 0`
  - `applied JSONB NOT NULL DEFAULT '[]'`
  - `errors JSONB NOT NULL DEFAULT '[]'`
  - `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `completed_at TIMESTAMPTZ`
- [x] Generate and test Alembic migration with upgrade & downgrade cycles (`a7c8e9f01234_add_bundle_upload_job_table.py`).

---

### Milestone 2: Backend API Endpoints & Scoped Internal Authentication

#### 2.1 Lambda ↔ Backend Internal Service Authentication
- **Secret & Transport**:
  - `INTERNAL_SERVICE_KEY` in environment / `.env` on EC2 and Lambda environment variable.
  - Header: `X-Internal-Service-Key: <the secret>`.
- **Constant-Time Verification**:
  ```python
  import hmac

  def verify_internal_service_key(provided_key: str) -> bool:
      expected = settings.INTERNAL_SERVICE_KEY
      if not expected or not provided_key:
          return False
      return hmac.compare_digest(provided_key, expected)
  ```
- **Strict Logic-Level Scoping**:
  - The internal service key is valid **only** on two endpoints:
    1. `POST /experiments/{id}/data-units`
    2. `PATCH /experiments/{id}/bundle-upload/{job_id}`
  - **No User Impersonation**: For `POST /experiments/{id}/data-units`, an explicit code path handles calls carrying a valid internal-service credential with no user identity attached to the created `DataUnit` rows beyond their existing `experiment_id`.
  - **State Guard**: `POST /data-units` via service key only succeeds if the target experiment is currently `draft_media_processing` and has an active `queued` or `processing` bundle job.
  - `PATCH /bundle-upload/{job_id}` via service key only succeeds if the job is still `queued` or `processing`.

#### 2.2 Multipart Upload Endpoints (`backend/main.py`)
- `POST /uploads/presign-multipart`:
  - Request: `{ filename: string, content_type?: string, experiment_id?: string }`
  - Calls boto3 S3 `create_multipart_upload` under key `zip-uploads/{experiment_id}/{uuid}.zip`.
  - Returns: `{ upload_id: string, s3_key: string }`.
- `POST /uploads/presign-multipart-part`:
  - Request: `{ s3_key: string, upload_id: string, part_number: int }`
  - Generates presigned URL for `upload_part`.
  - Returns: `{ presigned_url: string, part_number: int }`.
- `POST /uploads/complete-multipart`:
  - Request: `{ s3_key: string, upload_id: string, parts: [{ PartNumber: int, ETag: string }] }`
  - Calls boto3 S3 `complete_multipart_upload`.
  - Returns: `{ s3_key: string, s3_uri: string }`.

#### 2.3 Bundle Upload Job Management & Watchdog
- `POST /experiments/{id}/bundle-upload`:
  - Request: `{ s3_key: string }`
  - Verifies experiment ownership and checks `status !== 'draft_media_processing'`.
  - Sets `experiment.status = 'draft_media_processing'`.
  - Creates `BundleUploadJob` record with `status = 'queued'`.
  - Returns: `{ job_id: string, status: 'queued' }`.
- `GET /experiments/{id}/bundle-upload/{job_id}` (**Strictly Owner-Only**):
  - Authenticated via `get_current_user` and `get_owned_experiment` (no share-token branch).
  - **Crash-Safety Watchdog**: If `job.status in ('queued', 'processing')` and `job.updated_at < now() - 20 minutes`:
    - Automatically marks `job.status = 'failed'` with error: `"Processing timed out after 20 minutes without heartbeat"`.
    - Updates `experiment.status = 'draft_media_failed'`.
    - Commits and returns the failed state.
  - Returns: `{ status, progress: { files_processed, files_total }, result: { applied, errors } }`.
- `PATCH /experiments/{id}/bundle-upload/{job_id}`:
  - Requires valid `X-Internal-Service-Key`.
  - Updates progress, applied files, itemized errors, and transitions status to `completed` or `failed`.
  - When `completed`: sets `experiment.status = 'draft'`.
  - When `failed`: sets `experiment.status = 'draft_media_failed'`.

---

### Milestone 3: Lambda Function Implementation & Crash Safety

Directory: `lambda/bundle_extractor/`

#### 3.1 Global Crash Safety & Error Handling
- Wrap the entire handler logic in a top-level `try ... except ... finally`:
  - If any uncaught exception occurs (network blip, unexpected runtime error, memory limit), immediately send `PATCH /experiments/{id}/bundle-upload/{job_id}` with `status: "failed"` and the error message before terminating.
  - In `finally`, ensure `/tmp` temporary extraction directories are purged.

#### 3.2 Security & Extraction Guardrails
1. **Zip-Bomb Protection**:
   - Compute `sum(info.file_size for info in zip.infolist())`.
   - Set ceiling to **10 GB** (`MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024 * 1024`) with headroom for high-ratio decompressions.
   - If sum exceeds ceiling, abort with itemized failure.
2. **Zip-Slip Protection**:
   - Validate every entry's target path resolves strictly inside `/tmp/extracted`.
3. **Structure Validation**:
   - Require `media/` top-level directory; reject archives with missing media root.

#### 3.3 File Processing & Registration
- Check file extensions against experiment's modality-allowed list (`audio`, `video`, `image`).
- Stream each valid file to S3: `experiments/{experiment_id}/{uuid}/{basename}`.
- Make HTTP POST to `POST /experiments/{experiment_id}/data-units` passing `X-Internal-Service-Key`.
- Record per-file success or failure (partial-success job).
- On completion of all files, send `PATCH /experiments/{experiment_id}/bundle-upload/{job_id}`.
- Delete original zip from `zip-uploads/`.

#### 3.4 Local Test Harness & Simulation
- Local test runner (`backend/services/bundle_worker.py` or pytest fixture) executing the extraction logic against MinIO to thoroughly test in automated CI / test suites.

---

### Milestone 4: Frontend Resumable Multipart Uploader & UX

#### 4.1 Resumable Multipart Upload Service (`frontend/src/services/multipartUpload.ts`)
- Configurable chunk size (50MB - 100MB).
- Parallel upload worker pool (concurrency 4).
- Per-chunk retry with exponential backoff (up to 3 retries per chunk).
- LocalStorage caching key: `hash(file.name + file.size + file.lastModified)` storing `{ uploadId, s3Key, completedParts: [{ partNumber, etag }] }`.
- Resumes already-uploaded chunks on page refresh.
- Accurate progress callback reporting `(bytesUploaded / totalBytes) * 100`.

#### 4.2 Experiment Creation Wizard Updates (`CreateExperiment.tsx`)
- In Step 3 (Dataset Upload):
  - Add choice: **"Single Archive (.zip) for Large Datasets"** vs. **"Individual Files"**.
  - Show multipart upload progress bar with chunk transfer stats and cancel/pause control.
  - On upload completion, immediately transition to `draft_media_processing`.
- **Non-blocking Designer Workflow**:
  - Persistent sticky status banner across the wizard:
    - `draft_media_processing`: *"Media archive is processing in the background (X/Y files). You can continue configuring qualifications, routing, and teaching examples below."*
    - `draft_media_failed`: *"Media archive processing encountered errors. Review errors below or retry upload."*
  - Gate media-dependent steps:
    - Step 3 metadata/gold upload and Step 4 dataset preview show an informative disabled state with progress polling indicator while media is processing.
    - Finalize / Deploy button is disabled until media processing returns to `draft` with data units created.
  - Surface detailed error list on failure with one-click **"Retry Zip Upload"** or **"Switch to Individual Files"**.

---

### Milestone 5: Testing & Verification

1. **Unit Tests**:
   - Backend multipart presigning, part presigning, and completion.
   - Internal service key constant-time comparison and logic-level scoping.
   - Owner-only authorization and watchdog timeout on `GET /experiments/{id}/bundle-upload/{job_id}`.
   - Lambda zip-bomb, zip-slip, and extension validation logic.
   - Frontend multipart chunk slicing and localStorage resume logic.
2. **Integration Tests**:
   - Full flow: Multipart presign → complete upload → job creation → mock worker execution → data unit registration → status transition.
   - Watchdog test: simulate a stuck job older than 20 minutes and verify watchdog auto-fails it.
   - Partial failure test: archive containing valid audio files plus one invalid extension, verifying partial registration and accurate error reporting.
   - Connection drop simulation: verify chunk retry and resumption without full re-upload.
3. **Build & Lint Verification**:
   - `npm run build` & `npm test`.
   - `pytest` on backend.
