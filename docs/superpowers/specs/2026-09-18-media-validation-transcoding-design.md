# Media Validation and Transcoding Design

**Date:** 2026-09-18  
**Status:** Approved for implementation planning  
**Branch:** `codex/extensible-annotation-modules`

## Objective

Accept a practical range of uploaded media while guaranteeing that annotators
receive browser-compatible playback files. Preserve direct-to-MinIO uploads,
perform authoritative server-side inspection, transcode decodable but
incompatible media asynchronously, and prevent experiment deployment until all
media is ready.

## Current state

The browser currently uploads files directly to MinIO through presigned PUT
URLs. The frontend then registers each uploaded object as a `DataUnit`, applies
gold answers, and deploys the experiment. `DataUnit.raw_uri` is returned to the
browser through a presigned GET URL without inspecting its actual container or
codec.

Consequently, a valid MP4 object can be uploaded and served successfully while
still failing in the browser. The generated action-recognition fixtures exposed
this boundary: their MP4 container and `video/mp4` object metadata were valid,
but their MPEG-4 Part 2 (`mp4v`) video stream was not supported by the browser.

## Chosen architecture

Use PostgreSQL as a durable media-processing queue and run FFmpeg/ffprobe in a
dedicated worker process. This retains the existing PostgreSQL and MinIO
dependencies and avoids adding Redis or an external queue.

FastAPI background tasks are not used because they are lost on API restart and
would make long transcodes compete with request handling. Celery is deferred
because its operational cost is unnecessary for the current scale.

```text
Frontend preflight
    |
    v
Original uploaded directly to MinIO
    |
    v
Data unit and processing job registered atomically
    |
    v
Worker claims job with SELECT ... FOR UPDATE SKIP LOCKED
    |
    v
ffprobe inspection
    |---------------------------|
    |                           |
compatible                 incompatible but decodable
    |                           |
playback_uri = raw_uri      FFmpeg creates playback copy
    |                           |
    |---------------------------|
                |
                v
              ready
```

Invalid, corrupt, oversized, or undecodable input transitions to `failed` with
a safe user-facing reason and detailed diagnostics in worker logs.

## Compatibility policy

Frontend checks are advisory and provide immediate feedback. Backend probing is
authoritative because extensions and declared MIME types can be incorrect.

### Video

The canonical playback output is:

- MP4 container;
- H.264/AVC video;
- `yuv420p` pixel format;
- AAC audio when an audio stream exists;
- fast-start metadata for progressive playback.

An input already satisfying this policy reuses the original object. Any input
that ffprobe/FFmpeg can decode but that does not satisfy the policy is
transcoded.

### Audio

Browser-compatible AAC/M4A and MP3 inputs may reuse the original. Other
decodable audio is converted to a canonical AAC/M4A playback object. Audio
policy is based on probed streams rather than filename alone.

### Images

PNG, JPEG, and WebP inputs are verified by their actual content and dimensions.
Image transcoding is not included in this iteration. Corrupt or unsupported
images fail processing.

### General limits

Configuration provides maximum input bytes, probe timeout, transcode timeout,
maximum output bytes, and retry count. FFmpeg is invoked with an argument list,
never through a shell. Each job uses a private temporary directory that is
removed on success or failure.

## Data model

### `data_unit` additions

| Column | Type | Meaning |
|---|---|---|
| `playback_uri` | nullable string | Browser-compatible object; equals `raw_uri` when no derivative is needed |
| `media_status` | non-null string | `pending`, `inspecting`, `transcoding`, `ready`, or `failed` |
| `media_info` | non-null JSONB | Sanitized probe summary: container, streams, duration, dimensions, codecs |
| `media_processing_error` | nullable string | Safe explanation displayed to the experiment owner |

`raw_uri` continues to identify the immutable original upload. Exports include
both URIs and `media_info`. Annotator and review responses generate presigned
URLs from `playback_uri` and never expose an unready object.

Existing data units are migrated to `ready` with `playback_uri = raw_uri`, so
current experiments remain usable without retroactive processing.

### `media_processing_job`

| Column | Type | Meaning |
|---|---|---|
| `id` | UUID primary key | Job identity |
| `data_unit_id` | unique UUID foreign key | One durable job per data unit |
| `status` | non-null string | `pending`, `processing`, `retry_wait`, `complete`, or `failed` |
| `attempt_count` | non-null integer | Number of started attempts |
| `available_at` | timestamp | Earliest time the job may be claimed |
| `lease_expires_at` | nullable timestamp | Allows recovery after worker death |
| `last_error` | nullable text | Sanitized most recent failure |
| `created_at` | timestamp | Audit timestamp |
| `updated_at` | timestamp | Audit timestamp |

The job and data unit are created in one database transaction after a successful
direct upload. The worker claims one eligible job using row locking with
`SKIP LOCKED`, marks it `processing`, increments `attempt_count`, and assigns a
lease. Multiple workers can run without processing the same job concurrently.

An expired lease makes a job claimable again. Transient failures retry up to
three attempts with delayed availability. Permanent validation failures move
directly to `failed`.

## API contract

### Upload preflight and presigning

The presign request changes from bare filenames to file descriptors:

```json
{
  "files": [
    {
      "filename": "clip.mp4",
      "content_type": "video/mp4",
      "size_bytes": 123456
    }
  ]
}
```

The backend checks filename safety, allowed extension for the experiment
modality, declared MIME type, duplicate names, batch size, and configured input
size limit before issuing URLs. Presigned PUT URLs bind the expected content
type. This is early validation only; worker probing remains authoritative.

The presign operation is scoped to an owned draft experiment, ensuring upload
policy derives from its modality.

### Data-unit registration

`POST /experiments/{id}/data-units` continues to register metadata and original
URIs. It creates each data unit as `pending` and creates its processing job in
the same transaction. It rejects object URIs that were not issued for that
experiment or do not resolve inside the configured bucket/upload prefix.

### Processing status

`GET /experiments/{id}/media-processing` returns aggregate counts and per-file
state:

```json
{
  "summary": {
    "total": 5,
    "pending": 1,
    "inspecting": 1,
    "transcoding": 1,
    "ready": 1,
    "failed": 1
  },
  "items": [
    {
      "data_unit_id": "uuid",
      "filename": "clip.mp4",
      "status": "transcoding",
      "media_info": {
        "container": "mov,mp4,m4a,3gp,3g2,mj2",
        "video_codec": "mpeg4",
        "duration_seconds": 8.0
      },
      "error": null
    }
  ]
}
```

### Retry

`POST /experiments/{id}/data-units/{data_unit_id}/retry-media-processing` is
owner-only. It clears the safe error, resets the data unit to `pending`, and
makes the existing failed job available immediately. It returns `409` for a job
that is already pending or processing.

### Deployment

`POST /experiments/{id}/deploy` returns `409` unless:

- at least one data unit exists;
- every data unit is `ready`;
- no processing job is pending, active, retrying, or failed;
- the existing dataset and gold validation requirements pass.

The response includes status counts so the frontend can explain why deployment
is blocked.

## Worker lifecycle

The worker is a separate executable loop:

1. claim one eligible job in a short database transaction;
2. download the original object into a private temporary directory;
3. run ffprobe with a timeout and parse its JSON output;
4. validate the real media type against the experiment modality;
5. store a sanitized probe summary;
6. determine whether the original meets the playback policy;
7. when compatible, set `playback_uri = raw_uri`;
8. otherwise run the modality-specific FFmpeg command;
9. probe the derivative and verify that it satisfies the canonical policy;
10. upload the derivative under `playback/{data_unit_id}/...` with the correct
    content type;
11. atomically mark the data unit `ready` and job `complete`;
12. clean temporary files.

Worker state changes use fresh transactions so a long-running FFmpeg process
does not hold database row locks. Before committing success, the worker verifies
that it still owns an unexpired lease. Derivative object keys are deterministic,
making a retry idempotent.

Unexpected exceptions are logged with job and data-unit IDs but without
presigned URLs or credentials. User-visible errors are mapped to stable messages
such as `Video could not be decoded` or `Media processing timed out`.

## Frontend behavior

The final wizard action becomes **Create and process media**.

Before upload, the frontend validates extensions, browser-reported MIME types,
duplicate filenames, empty files, and configured size limits. It explains that
unsupported codecs may be accepted and converted after upload.

After upload and registration, the wizard polls the processing-status endpoint
and displays one of:

- Uploading;
- Waiting for inspection;
- Inspecting;
- Transcoding;
- Ready;
- Failed.

Failed rows show their safe error and a **Retry processing** action. Deployment
occurs automatically when every file is ready and existing gold/dataset checks
pass.

If the page is closed, the draft experiment remains durable. The experiment
dashboard displays the same media-processing card for draft experiments and
allows the owner to retry failures or deploy once ready. The experiment list
continues to show drafts so processing can be resumed.

## Object lifecycle

Original uploads are preserved. Compatible originals are used directly;
incompatible inputs gain a separate playback object. Soft-deleting an
experiment continues to retain database rows and media objects. Physical object
garbage collection remains deferred because it requires a separate retention
policy.

If transcoding ultimately fails, any partial local output is removed. A
deterministic derivative object from a failed or superseded attempt may be
overwritten by a later successful retry.

## Configuration and local operation

New settings include:

- `MEDIA_MAX_INPUT_BYTES`;
- `MEDIA_MAX_OUTPUT_BYTES`;
- `MEDIA_PROBE_TIMEOUT_SECONDS`;
- `MEDIA_TRANSCODE_TIMEOUT_SECONDS`;
- `MEDIA_PROCESSING_MAX_ATTEMPTS`;
- `MEDIA_JOB_LEASE_SECONDS`;
- `MEDIA_WORKER_POLL_SECONDS`.

Docker Compose gains a worker service using the same backend code and an image
containing FFmpeg/ffprobe. The API and worker share PostgreSQL and MinIO but run
as separate processes. Local documentation includes both Docker Compose and
direct worker commands.

## Observability

Structured logs record:

- job claimed, attempt, and lease deadline;
- probe completed with safe codec/container summary;
- transcode started and completed with duration;
- derivative upload completion;
- retry scheduling;
- permanent processing failure.

Logs use data-unit/job IDs for correlation. They never include MinIO secret
keys, presigned query strings, or full FFmpeg command output at normal log
levels.

## Testing strategy

### Unit tests

- filename, extension, MIME, size, and modality preflight policy;
- ffprobe JSON parsing and sanitized media summaries;
- compatibility decisions for image, audio, and video;
- FFmpeg argument construction without shell invocation;
- retry classification and delay calculation;
- safe error mapping;
- frontend preflight and processing-state presentation.

### Database and API integration tests

- data-unit and job creation in one transaction;
- deployment blocked for every non-ready state;
- status endpoint ownership and aggregate counts;
- manual retry authorization and valid state transitions;
- expired lease recovery;
- two workers cannot claim the same job;
- annotator, review, and export responses use/preserve the correct URIs;
- existing data migration to ready playback state;
- Alembic downgrade, upgrade, and schema check.

### Worker integration tests

- compatible H.264/AAC input skips transcoding;
- the failing MPEG-4 Part 2 (`mp4v`) fixture produces an H.264, `yuv420p`,
  fast-start playback object;
- corrupt input fails with a sanitized error;
- a transient object-storage failure retries and succeeds;
- output is re-probed before a job becomes ready;
- temporary files are cleaned after success and failure.

### End-to-end smoke test

Create an action-recognition experiment using the generated `mp4v` sample,
observe `Transcoding`, wait for `Ready`, deploy, and confirm the returned media
plays in a browser through a presigned playback URL.

## Rollout and compatibility

The migration marks existing data units ready and points `playback_uri` at
`raw_uri`; it does not rewrite existing media. New uploads enter the processing
pipeline. This avoids unexpectedly blocking or modifying deployed experiments.

Presign and data-unit request changes are coordinated with the frontend in the
same release. No public backward-compatibility guarantee currently exists for
these internal APIs.

## Deferred work

- image transcoding and thumbnail generation;
- adaptive bitrate/HLS output;
- antivirus or content-safety scanning;
- physical object deletion and retention policies;
- distributed queue infrastructure such as Redis/Celery;
- autoscaling policies and per-tenant processing quotas;
- user-selectable output quality profiles.
