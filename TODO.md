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
