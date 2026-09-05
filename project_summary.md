# Annotation Experiment Platform — Status Summary

## Product Goal

Build an end-to-end annotation platform where a designer creates an experiment,
uploads media, distributes an anonymous share link, and monitors annotation
quality during collection through gold answers and inter-annotator agreement.

## Implemented

### Experiment design and storage

- FastAPI, PostgreSQL, SQLAlchemy, Alembic, and MinIO foundation.
- Experiment creation with modality, instructions, annotation schema,
  `overlap_n`, and `gold_ratio`.
- Direct-to-MinIO uploads through presigned URLs and batch data-unit creation.
- JSON gold-manifest processing with filename matching and per-entry errors.
- Environment-driven database, object-storage, CORS, and score-window settings.
- Six-step experiment wizard covering basics, annotation task, a combined dataset
  bundle, dataset preview, annotator qualifications/routing, and final review.
- Draft-first deployment: an experiment becomes public only after its files and
  configuration have been registered successfully.
- Audio, metadata CSV, and gold-answer JSON are assembled by exact filename
  before upload. The preview table plays each sample, displays and edits its
  inferred typed metadata and gold answer, and blocks invalid rows.

### Qualification-aware routing

- Experiment-defined qualification forms with single-choice, multi-choice,
  yes/no, and numeric/proficiency questions.
- Qualification answers are validated and stored separately from annotation
  answers.
- Constrained routing rules support equality, membership, and minimum numeric
  proficiency comparisons.
- Annotators must complete required qualification questions before allocation.
- Allocation applies qualification routing before unseen-item, overlap, and gold
  cadence rules and explains when remaining work does not match qualifications.

### Annotation-type architecture

- One annotation type per experiment, with choices as labels/options within it.
- Registry-based backend contract covering config validation, answer validation,
  gold matching, agreement calculation, and modality compatibility.
- Strict, distinct categorical answer models:
  - single-select: `{ "value": "Choice" }`
  - multi-select: `{ "values": ["Choice"] }`
- Segment answers: `{ "label": "Choice", "regions": [{ "start": 0, "end": 1 }] }`.
- Configured-choice membership, duplicate choices, extra fields, and invalid
  segment boundaries are rejected at the API boundary.

### Annotator application

- Anonymous session creation/resumption using a locally persisted token.
- Schema-driven annotation controls for categorical single-select,
  categorical multi-select, and audio segments.
- Media rendering is separated from answer controls so future modalities and
  annotation types do not need to be hard-coded into the page coordinator.
- Submission errors, paused sessions, loading states, queue completion, and
  per-item state reset are handled.

### Allocation and scoring

- Allocation excludes previously seen items and normal items that reached
  `overlap_n`.
- Gold examples are interleaved according to each annotator's progress and
  `gold_ratio`.
- Submission verifies that the share token, annotator, and data unit belong to
  the same experiment.
- A row lock prevents concurrent submissions from exceeding `overlap_n`.
- Annotation insertion and derived-score updates occur in one transaction.
- Gold accuracy and agreement use configurable fixed-size rolling windows
  (default: 20).
- Gold items are excluded from inter-annotator agreement.
- Derived scores can be rebuilt with `python rebuild_scores.py [experiment-id]`.

### Dashboard and export

- Polling experiment dashboard with completion, remaining work, active
  annotators, gold accuracy with sample count, and agreement metrics.
- Manual annotator pause/resume.
- JSON export with experiment configuration, data-unit metadata, gold answers,
  qualification provenance, annotations, timestamps, and agreement scores.

## Verification

- Frontend TypeScript and Vite production build passes.
- Frontend unit tests cover annotation completion rules plus quoted CSV parsing,
  metadata type inference, filename joining, and bundle validation errors.
- Backend unit tests cover strict categorical shapes, choice validation,
  Jaccard similarity, segment boundaries, IoU, and unmatched regions.
- Database-backed API integration test covers experiment creation, allocation,
  invalid-answer rejection, two-annotator overlap, scoring, dashboard, export,
  cross-experiment session isolation, draft deployment, qualification onboarding,
  and metadata-based language routing.

## Remaining Product Work

- Add designer authentication and ownership checks before non-local deployment.
- Add durable assignment reservations if items must remain reserved while an
  annotator has loaded them but not yet submitted.
- Decide whether categorical agreement should remain pairwise agreement or use
  Cohen/Fleiss kappa after enough production data is available.
- Decide whether segment gold correctness needs an explicit pass/fail IoU
  threshold in addition to the current continuous score.
- Add image/text renderers and bbox/polygon annotation plugins when audio is
  validated with real users.
- Add browser-level tests for waveform interactions and direct MinIO uploads.
- Push metadata filtering into SQL or a dedicated routing index if experiments
  grow beyond the current in-process v1 allocator scale.

## Recommended Next Action

Run a small real audio experiment with at least three annotators. Use it to
validate the gold cadence, segment ergonomics, and whether the displayed quality
metrics are understandable before adding more modalities.
