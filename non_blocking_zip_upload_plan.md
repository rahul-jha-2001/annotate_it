# Implementation Plan: Non-Blocking Zip Upload in Experiment Creation Wizard

## 1. Overview & Objectives

This plan details the implementation of a non-blocking dataset ingestion flow in the TaskGlass experiment creation wizard. When an experiment designer uploads a large zip archive:
1. **Immediate Wizard Progression**: The designer is never blocked waiting for multi-gigabyte decompression and S3 transfer.
2. **Decoupled Definition**: The dataset structure and attributes are rendered immediately from the designer's `metadata.csv` (client-side or via preview endpoint) with placeholder thumbnails while media files extract in the background.
3. **Early Gold-Answer Assignment**: Gold answers can be tagged and entered against filenames from the CSV before extraction completes, stored in `pending_gold_manifest`.
4. **Reconciliation & Validation Point**: Real validation (3-way set comparison between registered files, metadata rows, and gold answers) occurs at the Review step via a shared canonical validator before deployment.

---

## 2. State Machine & Status Lifecycle

```
[Start Wizard]
       │
       ▼ (Step 2: Zip upload begins)
[draft_media_processing] ◄────────────────────────────────────────┐
       │                                                          │
       ├─────────────────────────────────┐                        │ POST /reupload-media
       ▼ (Extraction succeeds)           ▼ (Extraction fails)     │ (Full clean reset)
    [draft]                      [draft_media_failed] ────────────┘
       │                                 │
       ▼ (Review Step: Pre-deploy check) │ (Independent fix without re-uploading media)
[Canonical Validation Pass]              ├──► POST /reupload-metadata
       │                                 └──► POST /reupload-gold-manifest
       ▼ (Deploy: POST /deploy)
   [active]
```

### Experiment Status Values:
* `draft`: Individual files mid-wizard, or zip archive after extraction completes successfully.
* `draft_media_processing`: Zip archive uploaded; extraction actively running in background; wizard is unblocked.
* `draft_media_failed`: Extraction failed or timed out; re-upload of media or metadata/gold manifest required.
* `active`: Successfully deployed with public share token.
* `deleted`: Soft-deleted experiment.

---

## 3. Data Model & Database Migration

### 3.1 `Experiment` Table (`backend/models.py`)
Add two JSONB fields to track pending dataset specifications prior to extraction reconciliation:
```python
class Experiment(Base):
    # Existing fields...
    pending_metadata = Column(JSONB, nullable=False, default=list)
    pending_gold_manifest = Column(JSONB, nullable=False, default=list)
```

* `pending_metadata`: Array of objects `[{"filename": "audio1.wav", "attributes": {"language": "en", ...}}, ...]`.
* `pending_gold_manifest`: Array of objects `[{"filename": "audio1.wav", "answer": {...}}, ...]`.

### 3.2 Alembic Migration
Create a new migration script adding `pending_metadata` (JSONB, default `'[]'::jsonb`) and `pending_gold_manifest` (JSONB, default `'[]'::jsonb`) to the `experiment` table.

---

## 4. Backend Architecture & Endpoints

### 4.1 Canonical Pre-Deploy Validation (`backend/services/experiment_validation.py`)
A single shared canonical function prevents drift between preflight UI checks and the deploy mutation:

```python
@dataclass
class PreDeployValidationResult:
    can_deploy: bool
    status: str
    orphaned_gold_entries: list[str]       # Hard block
    missing_from_extraction: list[str]     # Warning
    missing_from_metadata: list[str]       # Informational note
    blocker_reason: str | None = None
    registered_count: int = 0
    metadata_count: int = 0
    gold_count: int = 0

def validate_experiment_for_deploy(experiment: Experiment, db: Session) -> PreDeployValidationResult:
    # 1. State check
    if experiment.status == "draft_media_processing":
        return PreDeployValidationResult(
            can_deploy=False, status=experiment.status,
            orphaned_gold_entries=[], missing_from_extraction=[], missing_from_metadata=[],
            blocker_reason="Cannot deploy while media archive is processing in the background",
        )
    if experiment.status == "draft_media_failed":
        return PreDeployValidationResult(
            can_deploy=False, status=experiment.status,
            orphaned_gold_entries=[], missing_from_extraction=[], missing_from_metadata=[],
            blocker_reason="Cannot deploy when media archive processing failed",
        )
    
    # 2. Registered DataUnits
    units = db.query(DataUnit).filter_by(experiment_id=experiment.id).all()
    if not units:
        return PreDeployValidationResult(
            can_deploy=False, status=experiment.status,
            orphaned_gold_entries=[], missing_from_extraction=[], missing_from_metadata=[],
            blocker_reason="Upload at least one media sample before deployment",
        )

    registered_files = {u.raw_uri.rsplit('/', 1)[-1] for u in units}
    metadata_files = {row["filename"] for row in (experiment.pending_metadata or []) if isinstance(row, dict) and "filename" in row}
    gold_files = {entry["filename"] for entry in (experiment.pending_gold_manifest or []) if isinstance(entry, dict) and "filename" in entry}
    # Also include gold status from existing units
    for u in units:
        if u.is_gold:
            gold_files.add(u.raw_uri.rsplit('/', 1)[-1])

    orphaned_gold = sorted(list(gold_files - registered_files))
    missing_from_ext = sorted(list(metadata_files - registered_files)) if metadata_files else []
    missing_from_meta = sorted(list(registered_files - metadata_files)) if metadata_files else []

    can_deploy = True
    blocker_reason = None

    if orphaned_gold:
        can_deploy = False
        blocker_reason = f"{len(orphaned_gold)} gold entries reference files that were never found in the uploaded archive."
    elif experiment.gold_ratio > 0 and len(gold_files) == 0:
        can_deploy = False
        blocker_reason = 'Add at least one gold answer or set quality-check frequency to "None"'

    return PreDeployValidationResult(
        can_deploy=can_deploy,
        status=experiment.status,
        orphaned_gold_entries=orphaned_gold,
        missing_from_extraction=missing_from_ext,
        missing_from_metadata=missing_from_meta,
        blocker_reason=blocker_reason,
        registered_count=len(registered_files),
        metadata_count=len(metadata_files),
        gold_count=len(gold_files),
    )
```

### 4.2 Concurrency & Row-Level Locking (`with_for_update`)
To avoid race conditions between a user submitting gold answers while background extraction finishes:
* **`POST /api/experiments/{id}/gold-manifest`** and **`PATCH /api/experiments/{id}/bundle-upload/{job_id}`** both acquire an exclusive row lock:
  ```python
  experiment = db.query(Experiment).filter_by(id=experiment_id).with_for_update().one()
  ```
* When extraction completes (`bundle_worker` / `PATCH .../bundle-upload/{id}`):
  It reconciles `experiment.pending_gold_manifest` onto the newly created `DataUnit` rows immediately and updates `status = "draft"`.

### 4.3 Endpoint Specifications

#### 1. `POST /api/experiments/{id}/metadata-preview` & `POST /api/experiments/{id}/reupload-metadata`
* Accepts CSV file upload (`multipart/form-data`) or JSON list of rows.
* Parses and validates rows against `experiment.metadata_schema`.
* Saves to `experiment.pending_metadata`.
* Returns preview rows and count without needing existing `DataUnit` rows.

#### 2. `POST /api/experiments/{id}/gold-manifest` & `POST /api/experiments/{id}/reupload-gold-manifest`
* Accepts `{"manifest": [{"filename": "...", "answer": {...}}]}`.
* Validates answers against `experiment.label_schema` using plugin `validate_answer`.
* Acquires row lock `with_for_update()`.
* If `DataUnit` rows exist: applies `is_gold=True` and `gold_answer=answer` to matching units and updates `pending_gold_manifest`.
* If `DataUnit` rows do not exist yet (mid-extraction): saves to `pending_gold_manifest` for reconciliation.

#### 3. `POST /api/experiments/{id}/reupload-media` (Deterministic Full Reset)
* Preconditions: `experiment.status in ('draft_media_failed', 'draft_media_processing')`.
* Full clean slate actions:
  1. **S3 Deletion**: List and bulk-delete all objects under `experiments/{id}/` and `zip-uploads/{id}/`.
  2. **DB Deletion**: Delete all `DataUnit` records for this experiment.
  3. **Pending State Reset**:
     ```python
     experiment.pending_metadata = []
     experiment.pending_gold_manifest = []
     ```
  4. **Job Cancellation**: Any active `BundleUploadJob` marked `superseded`.
  5. **Status Reset**: `experiment.status = 'draft_media_processing'`.
* Returns a fresh presigned multipart upload session for the new zip archive.

#### 4. `GET /api/experiments/{id}/pre-deploy-validation`
* Calls `validate_experiment_for_deploy(experiment, db)`.
* Returns validation payload for inline display on the Review step.

#### 5. `POST /api/experiments/{id}/deploy`
* Calls `validate_experiment_for_deploy(experiment, db)`.
* If `not result.can_deploy`: raises `HTTPException(409, detail=result.blocker_reason)`.
* Reconciles any remaining `pending_metadata` and `pending_gold_manifest`.
* Sets `experiment.status = "active"` and returns deployed experiment.

---

## 5. Frontend Architecture & Wizard Integration (`CreateExperiment.tsx`)

### 5.1 Step 2 & 3: Dataset Ingestion & Catalog Preview
* **Non-Blocking Progression**: When a zip archive is selected and upload begins, `status` becomes `draft_media_processing`. The "Continue" button is enabled immediately.
* **Metadata CSV Upload**: The designer can drop a `metadata.csv` at Step 2 or 3.
* **Immediate Table Rendering**:
  - The catalog preview renders rows directly from `metadata.csv` (or `pending_metadata`).
  - Instead of waiting for media files, media cells render a neutral placeholder: `<span className="media-placeholder">Media extracting...</span>`.
  - Gold-answer tagging controls are active: clicking "Set Gold" allows entering answers mapped by filename immediately.

### 5.2 Persistent Navigation Indicator
* A persistent status pill in the top wizard header/navigation:
  - While extracting: `Extracting dataset archive (X/Y files) ...` with rotating spinner.
  - On failure: `Dataset extraction failed` in danger theme with a quick link back to Step 2.
  - On ready: `Dataset ready (N files)` in success badge.

### 5.3 Step 6: Review & Finalize Validation Display
* Fetches `GET /api/experiments/{id}/pre-deploy-validation`.
* Displays inline status boxes:
  - **Hard Blocker (Red)**: If `orphaned_gold_entries` exist:
    > "N gold entries reference files that were never found in the uploaded archive: [filenames]. Fix the gold manifest or re-check filenames."
    > Deploy button is **disabled**.
  - **Warning (Yellow)**: If `missing_from_extraction` exist:
    > "N files listed in your metadata were not found in the archive: [filenames]. They will not be part of this experiment."
    > Deploy button remains **enabled**.
  - **Notice (Blue/Gray)**: If `missing_from_metadata` exist:
    > "N extracted files have no metadata row. This is fine if metadata is optional for your use case."
* If `status === draft_media_failed`:
  - Renders itemized extraction errors.
  - Renders two independent action buttons:
    1. **"Re-upload Archive (.zip)"** $\rightarrow$ calls `POST /reupload-media`.
    2. **"Re-upload Metadata / Gold"** $\rightarrow$ opens file picker calling `POST /reupload-metadata` or `POST /reupload-gold-manifest`.

---

## 6. Implementation Milestones

### Milestone 1: Data Model & Alembic Migration
- [ ] Add `pending_metadata` and `pending_gold_manifest` to `models.py`.
- [ ] Generate Alembic revision and apply migration.

### Milestone 2: Backend Validation & Endpoints
- [ ] Implement `validate_experiment_for_deploy` in `backend/services/experiment_validation.py`.
- [ ] Implement `POST /api/experiments/{id}/metadata-preview` & `reupload-metadata`.
- [ ] Update `POST /api/experiments/{id}/gold-manifest` & `reupload-gold-manifest` with row lock `with_for_update()`.
- [ ] Implement `POST /api/experiments/{id}/reupload-media` with complete S3, DB, and `pending_*` cleanup.
- [ ] Implement `GET /api/experiments/{id}/pre-deploy-validation`.
- [ ] Update `POST /api/experiments/{id}/deploy` to call canonical validator and reconcile.
- [ ] Update worker extraction completion callback to reconcile `pending_gold_manifest` immediately.

### Milestone 3: Frontend Wizard Integration
- [ ] Add metadata CSV upload and instant preview rendering in Step 2/3.
- [ ] Add persistent header status pill for `draft_media_processing` and `draft_media_failed`.
- [ ] Update Review step to show inline validation banners (blocking, warning, notice).
- [ ] Implement independent re-upload controls on failure.

### Milestone 4: Automated Testing & Verification
- [ ] Backend tests for:
  - 3-way validation logic (orphaned gold blocking, missing extraction warning).
  - Row locking concurrency between gold upload and extraction completion.
  - Full reset on `reupload-media`.
- [ ] Frontend tests in `CreateExperiment.test.tsx`:
  - Instant navigation when zip upload starts.
  - Preview rendered from metadata CSV before extraction completes.
  - Inline validation rendering on Review step.
- [ ] End-to-end integration run.
