# Annotation Experiment Platform — Status Summary

## Product Goal

Build an end-to-end annotation platform where a designer creates an experiment,
uploads media, distributes an anonymous share link, and monitors annotation
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
- Anonymous annotation links remain public and experiment-scoped. Signed-in
  annotators are optionally linked to their user account without making login a
  requirement.

### Experiment design and storage

- FastAPI, PostgreSQL, SQLAlchemy, Alembic, and MinIO foundation.
- Experiment creation with modality, instructions, annotation schema,
  `overlap_n`, and `gold_ratio`.
- Direct-to-MinIO uploads through presigned URLs and batch data-unit creation.
- JSON gold-manifest processing with filename matching and per-entry errors.
- Environment-driven database, object-storage, CORS, and score-window settings.
- Six-step experiment wizard covering basics, annotation task, a combined dataset
  bundle, dataset preview, annotator qualifications/routing, and final review.
- Task selection includes an interactive annotator preview and a dynamic gold-data
  reference panel. The required JSON shape and example update for categorical
  single-select, categorical multi-select, and segment tasks.
- Draft-first deployment: an experiment becomes public only after its files and
  configuration have been registered successfully.
- Media, metadata CSV, and gold-answer JSON are assembled by exact filename
  before upload. The preview table plays each sample, displays and edits its
  inferred typed metadata and gold answer, and blocks invalid rows.
- Audio and video are registered media plugins. Each owns accepted upload types,
  dataset/review previews, and its lazy-loaded annotation renderer.
- Video supports categorical tasks and labeled temporal regions using native
  playback plus start/end region controls.
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
- Registry-based backend contract covering config validation, answer validation,
  gold matching, and agreement calculation.
- Capability-based backend modality registry. Annotation types declare a required
  interaction and modality compatibility is derived from modality capabilities.
- Typed frontend media and annotation plugin registries centralize upload rules,
  renderers, answer controls, gold examples/validation, summaries, and answer-to-
  media interaction mapping.
- Strict, distinct categorical answer models:
  - single-select: `{ "value": "Choice" }`
  - multi-select: `{ "values": ["Choice"] }`
- Segment answers: `{ "label": "Choice", "regions": [{ "start": 0, "end": 1 }] }`.
- Configured-choice membership, duplicate choices, extra fields, and invalid
  segment boundaries are rejected at the API boundary.

### Annotator application

- Anonymous session creation/resumption using a locally persisted token.
- Plugin-driven annotation controls for categorical single-select, categorical
  multi-select, and temporal segments over audio or video.
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
- Gold items are excluded from inter-annotator agreement.
- Derived scores can be rebuilt with `python rebuild_scores.py [experiment-id]`.

### Dashboard and export

- Polling experiment dashboard with completion, remaining work, active
  annotators, gold accuracy with sample count, and agreement metrics.
- Anonymous annotators remain experiment-scoped profiles: the dashboard shows a
  stable anonymous ID, saved questionnaire answers, progress, quality metrics,
  status, and last submission/qualification activity.
- Manual annotator pause/resume.
- JSON export with experiment configuration, data-unit metadata, gold answers,
  qualification provenance, annotations, timestamps, and agreement scores.

## Verification

- Frontend TypeScript and Vite production build passes.
- Frontend unit tests cover plugin discovery, capability compatibility, temporal
  interaction mapping, annotation completion, quoted CSV parsing, metadata type
  inference, filename joining, and bundle validation errors.
- Backend unit tests cover modality capability derivation, strict categorical
  shapes, choice validation, Jaccard similarity, segment boundaries, IoU,
  unmatched regions, and free-text qualification validation.
- Database-backed API integration test covers experiment creation, allocation,
  invalid-answer rejection, two-annotator overlap, scoring, dashboard, export,
  cross-experiment session isolation, draft deployment, qualification onboarding,
  and metadata-based language routing.

## Remaining Product Work

- Add Clerk Organizations when multi-user workspaces, invitations, and project
  roles become part of the product.
- Add durable assignment reservations if items must remain reserved while an
  annotator has loaded them but not yet submitted.
- Decide whether categorical agreement should remain pairwise agreement or use
  Cohen/Fleiss kappa after enough production data is available.
- Decide whether segment gold correctness needs an explicit pass/fail IoU
  threshold in addition to the current continuous score.
- Add image/text media plugins and spatial-shape/text-range annotation plugins
  after validating the audio/video flows with real users.
- Add browser-level tests for waveform interactions and direct MinIO uploads.
- Push metadata filtering into SQL or a dedicated routing index if experiments
  grow beyond the current in-process v1 allocator scale.

## Recommended Next Action

Run one small audio experiment and one video experiment with at least three
annotators. Use them to validate gold cadence, temporal-region ergonomics, media
compatibility, and whether the displayed quality metrics are understandable.
