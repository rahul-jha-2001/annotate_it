# Annotation Experiment Platform — Status Summary

## Product Goal

Build an end-to-end annotation platform where a designer creates an experiment,
uploads media, distributes a configurable-access share link, and monitors annotation
quality during collection through gold answers and inter-annotator agreement.

## Implemented

### Accounts and access control

- Clerk authentication and user management with configurable Google, Microsoft,
  passwordless, or other Clerk-supported sign-in methods.
- Short-lived Clerk session tokens verified by the FastAPI backend, including an
  authorized-party check; authentication secrets stay out of frontend code.
- Protected dashboard, creation, review, export, upload, deploy, and annotator
  management APIs. Experiments are owned by their creator; regular designers see
  only their projects, while platform administrators can inspect all projects.
- Clerk-powered profile page for identity, security, connected-account, and
  session management.
- Experiment-level annotator access supports required Clerk sign-in, an
  unverified guest display name, or a fully anonymous experiment-scoped session.

### Experiment design and storage

- FastAPI, PostgreSQL, SQLAlchemy, Alembic, and AWS S3 (with local MinIO support) foundation.
- Experiment creation with modality, instructions, annotation schema,
  `overlap_n`, `gold_ratio`, and annotator access mode.
- Owner-only experiment settings allow name and instruction edits at any time.
  Access mode, overlap, and gold cadence can be edited until annotation begins,
  then lock to protect collected work and derived scores.
- Experiment deletion requires typing the exact experiment name and warns that
  collected annotations will also disappear from product access. Deletion is
  soft: the experiment receives `status="deleted"` and `deleted_at`, while its
  samples, annotator profiles, annotations, and scores remain retained in PostgreSQL.
- Direct-to-S3 uploads through presigned URLs and batch data-unit creation.
- JSON gold-manifest processing with filename matching and per-entry errors.
- Environment-driven database, object-storage, CORS, and score-window settings.
- Six-step experiment wizard covering basics, annotation task, a combined dataset
  bundle, dataset preview, annotator qualifications/routing, and final review.
- Task selection includes an interactive annotator preview and a dynamic gold-data
  reference panel. Required JSON and examples are owned by each annotation module.
- Draft-first deployment: an experiment becomes public only after its files and
  configuration have been registered successfully.
- Media, metadata CSV, and gold-answer JSON are assembled by exact filename
  before upload. The preview table plays each sample, displays and edits its
  inferred typed metadata and gold answer, and blocks invalid rows.
- Audio, video, and image are registered media plugins. Each owns accepted upload types,
  dataset/review previews, and its lazy-loaded annotation renderer.
- Video supports categorical/transcription tasks, labeled temporal regions, and
  timestamped spatial shapes. Image supports categorical and spatial tasks.
- The shared Aqua Lab visual system uses white surfaces, cyan interaction states,
  mint completion/validation feedback, dark ocean text, and reserved amber for
  gold-data semantics across designer and annotator screens.

### Qualification-aware routing

- Experiment-defined qualification forms with single-choice, multi-choice,
  yes/no, numeric/proficiency, and free-text questions. Free-text responses are
  collected for review but intentionally excluded from automatic routing.
- The qualification builder explains the designer's decision in plain language,
  suggests questions and options from dataset metadata, and expresses routing
  rules as readable sample-to-answer matching sentences.
- Qualification answers are validated and stored separately from annotation
  answers.
- Constrained routing rules support equality, membership, and minimum numeric
  proficiency comparisons.
- Annotators must complete required qualification questions before allocation.
- Allocation applies qualification routing before unseen-item, overlap, and gold
  cadence rules and explains when remaining work does not match qualifications.

### Annotation-type architecture

- One annotation type per experiment, with choices as labels/options within it.
- Generic inherited backend template owns schema upgrades, config/answer/gold
  validation, catalog output, bounded scoring, and pairwise agreement. Children
  implement protected semantic and scoring hooks; public lifecycle replacement is rejected.
- Capability-based backend modality registry. Annotation types declare a required
  interaction and modality compatibility is derived from modality capabilities.
- An inherited frontend annotation template plus typed media/annotation registries centralize upload rules,
  renderers, answer controls, gold examples/validation, summaries, and answer-to-
  media interaction mapping.
- The frontend base prepares empty or stale coordinator answers from each
  module's declared initial shape before controls, completion checks, and media
  interactions run, so switching annotation types cannot crash a child module.
- Strict, distinct categorical answer models:
  - single-select: `{ "value": "Choice" }`
  - multi-select: `{ "values": ["Choice"] }`
- Segment answers: `{ "label": "Choice", "regions": [{ "start": 0, "end": 1 }] }`.
- Transcription normalizes text and scores word-level edit similarity.
- Six labeled temporal children cover diarization, speaker identification, sound
  events, speech/silence, video events, and action recognition. Diarization aligns
  consistently renamed speaker clusters before temporal matching.
- Five spatial children cover boxes, polygons, polylines, ellipses, and keypoints.
  Answers use normalized coordinates and stable IDs; video shapes require seconds,
  while image shapes forbid time.
- Shared deterministic geometry scorers provide IoU, point-to-segment path
  similarity, normalized keypoint distance, same-label matching, unmatched-shape
  penalties, and timestamp tolerance.
- Configured-choice membership, duplicate choices, extra fields, and invalid
  segment boundaries are rejected at the API boundary.

### Annotator application

- Access-aware onboarding reads the experiment policy before session creation:
  required Clerk sign-in, an unverified guest-name form, or fully anonymous entry.
- Experiment-scoped session creation/resumption uses a locally persisted token;
  a stale sign-in session is replaced safely when a different account continues.
- Guest names are stored on the annotator profile and shown as unverified, while
  anonymous-mode sessions deliberately avoid account linkage.
- Plugin-driven controls cover categorical, transcription, temporal/labeled
  temporal, and spatial tasks over compatible audio, video, or image media.
- Experiment creation, dataset preview, annotation runtime, and review resolve
  behavior through registries and contain no audio/video task-routing branches.
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
- Inter-annotator agreement is calculated for both regular and gold samples once
  they reach `overlap_n` submissions. Gold accuracy remains a separate comparison
  against the expected answer.
- Derived scores can be rebuilt with `python rebuild_scores.py [experiment-id]`.

### Observational onboarding (teaching examples)

- Designers can configure ordered teaching examples during experiment creation, either
  by picking any uploaded dataset item or reusing an existing gold-standard sample.
- If a gold sample is chosen as a teaching example, designers can select whether to keep
  it in the scored gold pool or remove it from scoring so it serves purely as training.
- Each teaching example pairs a media preview with an interactive correct-answer overlay,
  an expected answer summary card, and an optional written explanation of the reasoning.
- Dedicated step in the annotator flow: presented after qualification questions but before
  the active scoring queue begins. Teaching examples are explicitly observational and
  are never scored or counted toward annotator accuracy.
- Completed teaching onboarding is recorded on the annotator profile (`completed_teaching_examples_at`),
  and annotators cannot be allocated active queue items until this onboarding is complete.

### Audio waveform timeline and region overlay

- Integrated Wavesurfer `TimelinePlugin` to provide granular, dynamic x-axis time notches
  (from 0.5s intervals for short clips up to 30s for long recordings) beneath audio waveforms.
- Synchronized region hydration with Wavesurfer's `ready` and `decode` events to eliminate
  race conditions and clipping during fast example switching and read-only overlay inspection.
- Enhanced `temporal-regions` interaction with interaction-level `label` resolution so that
  segment/speech-segmentation tasks display their active category label and distinct color badge
  directly on the waveform and video timeline.
- Read-only review overlays display instructional feedback indicating annotated time spans.

### Dashboard and export

- Polling experiment dashboard with completion, remaining work, active
  annotators, gold accuracy with sample count, and agreement metrics.
- Signed-in, named guest, and anonymous annotators remain experiment-scoped
  profiles: the dashboard shows the appropriate identity label, saved questionnaire
  answers, progress, quality metrics, status, and last activity.
- A dedicated experiment annotator table lists only people who submitted work,
  with annotation count, rolling gold score, agreement score, status, and last
  activity. Selecting an annotator opens every submission they made in that
  experiment, including media, metadata, answer, timestamp, sample agreement,
  and per-gold-item expected answer and score.
- The sample-oriented review page shows each uploaded sample with all of its
  annotations, modality-native preview, metadata, gold answer, and agreement.
- Dataset preview, sample review, and annotator drill-down provide selectable
  read-only gold/submission overlays through the same module interaction contract.
- Manual annotator pause/resume.
- Auditable asynchronous export service powered by Celery background workers, with
  Redis rate limiting and progress polling.
- Live export preflight preview with configurable consensus threshold overrides
  (minimum annotator overlap, agreement tolerance, confidence cutoffs).
- Checksummed export archives containing raw submissions, resolved consensus annotations,
  provenance manifests with SHA256 hashes, and algorithm version metadata.

### Operations and developer experience

- Structured request lifecycle logging records a safe request summary, generated
  or propagated request ID, response status, duration, validation failures, HTTP
  rejection details, authentication outcomes, and unexpected tracebacks.
- Logs include query-key names rather than query values so annotation session
  tokens are not exposed; every response includes `X-Request-ID` for correlation.
- Local `.env.local` files load before configuration is evaluated and remain
  excluded from Git. Clerk configuration logs report presence only, never values.
- `HOW_TO_RUN.md`, `AUTHENTICATION.md`, `TECH_DESIGN.md`, `PRD.md`, and
  `ANNOTATION_EXTENSION_GUIDE.md` document local operation, identity boundaries,
  architecture, product behavior, and extension of backend/frontend plugins.

## Verification

- Frontend TypeScript and Vite production build passes with zero errors.
- Frontend unit test suite contains 36 test files and 151 passing tests covering plugin discovery,
  capability compatibility, temporal/spatial mapping, audio timeline intervals, teaching examples
  onboarding, read-only overlays, consensus export modal, and dataset preview tables.
- Backend test suite contains 113 tests covering annotation modules, geometry scoring,
  allocation lifecycle, teaching examples, rate limiting, and auditable export generation.
- The latest Alembic migrations pass full upgrade/downgrade cycles and report no missing schema operations.

## Remaining Product Work

- Add Clerk Organizations when multi-user workspaces, invitations, and project
  roles become part of the product.
- Add durable assignment reservations if items must remain reserved while an
  annotator has loaded them but not yet submitted.
- Decide whether categorical agreement should remain pairwise agreement or use
  Cohen/Fleiss kappa after enough production data is available.
- Decide whether segment gold correctness needs an explicit pass/fail IoU
  threshold in addition to the current continuous score.
- Add text media/text-range plugins after validating the current flows with real users.
- Evaluate masks, skeletons, cuboids, OCR composition, attributes, tracking,
  multi-camera, specialized imagery, and LiDAR using the boundary report in
  `docs/DEFERRED_ANNOTATION_SYSTEMS.md`; these are framework projects, not ordinary children.
- Add browser-level tests for waveform interactions and direct S3/MinIO uploads.
- Push metadata filtering into SQL or a dedicated routing index if experiments
  grow beyond the current in-process v1 allocator scale.

## Recommended Next Action

Run one audio, one image, and one video experiment with at least three annotators
across all access modes. Validate onboarding, spatial coordinate accuracy at
multiple viewport sizes, temporal/spatial ergonomics, gold cadence, overlay
review, settings-lock messaging, and whether quality metrics are understandable.


### Authenticated annotation catalog

- Signed-in designers can open `/catalog`, filter the 15 implemented presets by Audio, Image, or Video, and search by annotation family and use case.
- Each working preset has a focused detail page with two curated samples, the production annotation controls and media renderer, raw metadata and gold-answer examples, scoring guidance, and a downloadable example bundle.
- Catalog interactions are preview-only React state: switching samples, resetting, or leaving the page discards the answer and never calls annotation or submission APIs.
- LiDAR/3D concepts are shown separately as coming soon and cannot open a preview or create an experiment.
- A working preset can open the existing experiment wizard with only its validated modality and annotation type preselected; invalid query pairs fall back to the normal audio/categorical defaults.
