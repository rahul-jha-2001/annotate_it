# Technical Design: Annotation Experiment Platform (v1)

Companion to PRD.md. This is the implementation spec — hand this to engineering agents alongside the PRD.

For implementation checklists and extension examples, see
[`ANNOTATION_EXTENSION_GUIDE.md`](ANNOTATION_EXTENSION_GUIDE.md).

## 1. Stack
- **Backend**: FastAPI (Python 3.11+)
- **DB**: PostgreSQL (JSONB for flexible schema/answer fields)
- **Migrations**: Alembic
- **Object storage**: S3-compatible (S3, or R2/B2) and local for testing for raw media files; DB stores URIs only, never bytes
- **Frontend**: React + Vite (no Next.js — no SSR requirement for v1)
- **Authentication and user management**: Clerk React SDK in the browser and
  Clerk's Python SDK for FastAPI session-token verification
- **Audio annotation UI**: wavesurfer.js (waveform render + region/point selection)
- **Video annotation UI**: native browser video playback with plugin-owned temporal region controls
- **Image/spatial annotation UI**: dependency-free SVG overlay with normalized
  coordinates, immutable editing state, and shared image/video tools
- **Spatial scoring**: Shapely-backed polygon/ellipse geometry plus deterministic
  pure matching functions
- **Live dashboard updates**: polling (3–5s interval) against derived scoring tables — no websockets in v1
- **Repo layout**: monorepo
  ```
  /backend   (FastAPI app, Alembic migrations, scoring logic)
  /frontend  (React + Vite: designer app + annotator app, can be two entry points in one Vite project or two packages)
  ```
- **Deployment**: Dockerize the application as frontend and backend seprately

### 1.1 Modality and annotation plugin architecture

The extension boundary is capability-based. Media modalities and annotation
types are independent plugins joined by a small interaction contract; screens
must not switch directly on modality or annotation-type strings.

Frontend media plugins live under `frontend/src/plugins/media/` and declare a
stable key, display name, upload rules, supported interactions, dataset/review
preview, lazy-loaded annotator renderer, and modality-owned module defaults.
Frontend annotation modules inherit `BaseAnnotationModule` and declare their
required interaction, configuration editor, answer control, completeness check,
answer summary, initial state, gold format, validation, examples, and
answer-to-media interaction mapping. The base owns shared lifecycle behavior and
the registry rejects child overrides of protected public operations. Its
`prepareAnswer` lifecycle derives a safe render shape from each child's declared
initial answer, preventing stale or empty coordinator state from leaking into a
newly selected annotation module.

The coordinator passes a discriminated `MediaInteraction` to the selected media
renderer. A segment task therefore produces `temporal-regions` without knowing
whether audio or video renders it. Audio and video consume that interaction
without knowing the task's answer schema.

Backend modalities are registered in `backend/modalities.py` with interactions
and media capabilities. Backend annotation classes inherit the generic
`BaseAnnotationType`; the base owns schema-version handling, strict parsing,
normal/gold validation, finite bounded scoring, pairwise agreement aggregation,
and catalog output. Children implement protected semantic/scoring hooks.
Compatible modalities are derived from required interaction, required media
capabilities, and implementation availability. The backend remains authoritative.

Architectural invariant:

> Adding or modifying a modality may change its media plugin, backend modality
> descriptor, and tests, but must not require changes to experiment creation,
> dataset preview, annotator coordination, or review screens.

Audio, video, and image are implemented media plugins. Annotation children cover
categorical, transcription, unlabeled/labeled temporal tasks, diarization, and
five spatial shapes. Shared read-only interactions render selectable gold and
submission overlays in dataset and review workflows. Heavy renderers use
`React.lazy`, keeping modality dependencies out of coordinators.

## 2. Data model

```sql
-- Experiment: the unit of design/deploy/track
CREATE TABLE experiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES app_user(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    modality TEXT NOT NULL,                 -- registered media-plugin key, e.g. 'audio' or 'video'
    instructions TEXT,
    label_schema JSONB NOT NULL,            -- label set, annotation type (point|segment|bbox|polygon), cardinality rules
    overlap_n INT NOT NULL DEFAULT 1,        -- how many distinct annotators must see each non-gold item
    gold_ratio FLOAT NOT NULL DEFAULT 0.1,   -- fraction of each annotator's queue that is gold, interleaved
    access_mode TEXT NOT NULL DEFAULT 'anonymous', -- sign_in_required | guest_name | anonymous
    share_token TEXT UNIQUE NOT NULL,        -- public link identifier, e.g. nanoid
    status TEXT NOT NULL DEFAULT 'active',   -- 'draft' | 'active' | 'deleted'
    metadata_schema JSONB NOT NULL DEFAULT '[]',
    qualification_form JSONB NOT NULL DEFAULT '[]',
    routing_rules JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ                    -- set only for soft-deleted experiments
);

-- DataUnit: one item to be annotated
CREATE TABLE data_unit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    raw_uri TEXT NOT NULL,                   -- S3 URI to the raw audio/image file
    is_gold BOOLEAN NOT NULL DEFAULT FALSE,
    gold_answer JSONB,                       -- null unless is_gold; shape matches label_schema
    metadata JSONB NOT NULL DEFAULT '{}'
);

-- Annotator: experiment-scoped profile; account linkage remains optional
CREATE TABLE annotator (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
    display_name TEXT,                       -- unverified, experiment-scoped guest name
    session_token TEXT UNIQUE NOT NULL,      -- persisted in browser local storage
    status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'paused' (manual designer action)
    qualification_answers JSONB,
    qualified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Designer account, external identity mapping, and revocable app session
CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    clerk_user_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Annotation: a single submitted answer for a single item by a single annotator
CREATE TABLE annotation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_unit_id UUID NOT NULL REFERENCES data_unit(id) ON DELETE CASCADE,
    annotator_id UUID NOT NULL REFERENCES annotator(id) ON DELETE CASCADE,
    answer JSONB NOT NULL,                   -- shape matches label_schema
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (data_unit_id, annotator_id)      -- one annotator can't annotate the same item twice
);

-- AnnotatorScore: derived/live, updated by scoring worker on each relevant annotation insert
CREATE TABLE annotator_score (
    annotator_id UUID PRIMARY KEY REFERENCES annotator(id) ON DELETE CASCADE,
    rolling_gold_accuracy FLOAT,             -- null until they've hit >=1 gold item
    rolling_agreement_score FLOAT,           -- null until they've participated in >=1 completed overlap item
    items_completed INT NOT NULL DEFAULT 0,
    gold_items_seen INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ItemAgreement: derived/live, computed once an item hits overlap_n annotations
CREATE TABLE item_agreement (
    data_unit_id UUID PRIMARY KEY REFERENCES data_unit(id) ON DELETE CASCADE,
    agreement_score FLOAT,
    n_annotations INT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notes for implementing agents:
- `label_schema` and `answer`/`gold_answer` are intentionally loosely typed (JSONB) at the DB layer — validate their shape in the application layer against `label_schema` on write, not via DB constraints.
- `metadata_schema`, `qualification_form`, and `routing_rules` are constrained
  application-level schemas. Metadata and qualification answers must be validated
  before persistence; arbitrary client-defined routing expressions are not allowed.
- `annotator_score` and `item_agreement` are **derived tables**, not sources of truth. They must always be re-derivable from `annotation` + `data_unit`. Do not let them drift into being edited directly.

## 3. API surface (v1)

### Designer-facing (authenticated and owner-scoped)
- `GET /auth/me` — resolve the verified Clerk identity to the local application
  user and return domain-profile information.
- `GET /annotation-types` — list registered task types and modality capabilities.
- `GET /modalities` — list registered modalities and their interaction capabilities.
- `GET /experiments` — list experiments for the designer landing page.
- `POST /experiments` — create a draft or active experiment with label schema,
  metadata schema, qualification form, routing rules, overlap, and gold cadence.
- `POST /experiments/{id}/data-units` — register uploaded raw references with
  validated per-sample metadata and optional inline gold configuration.
- `POST /experiments/{id}/gold-manifest` — apply validated gold answers to
  registered samples by exact filename, returning per-entry errors.
- `POST /experiments/{id}/deploy` — activate a populated draft experiment.
- `GET/PATCH /experiments/{id}/settings` — read or edit general, access, and
  quality settings. Access/quality fields lock after the first annotation.
- `DELETE /experiments/{id}` — require an exact experiment-name confirmation,
  set `status='deleted'` and `deleted_at`, and preserve all related rows. Deleted
  experiments are excluded from normal owner and share-link APIs.
- `GET /experiments/{id}/dashboard` — returns completion %, annotator list with scores, item agreement summary (this is what the dashboard polls)
- `PATCH /annotators/{id}` — set status to `paused` (manual removal from pool)
- `GET /experiments/{id}/review` — return samples with media URLs, metadata,
  gold answers, agreement, and all annotations for designer inspection.
- `GET /experiments/{id}/export` — returns the data pack (JSON/JSONL: data_unit + all annotations + agreement/gold scores + provenance)
- `POST /uploads/presign` — returns a presigned S3 URL so raw files go directly from browser to object storage, not through the FastAPI app

All experiment reads and mutations require a designer session. Non-admin users
can access only experiments whose `owner_id` matches their user ID. Platform
administrators may inspect all experiments. Legacy rows with a null owner are
visible only to platform administrators; every new experiment receives its
creator as owner. The frontend attaches a short-lived Clerk session token as a
Bearer token. FastAPI verifies its signature, lifetime, type, and `azp` against
`CLERK_AUTHORIZED_PARTIES` before evaluating local authorization.

### Annotator-facing (share_token based, session-token identified)
- `GET /annotate/{share_token}/configuration` — publicly returns the active
  experiment name and access mode before a session is created.
- `GET /annotate/{share_token}/session` — creates or resumes anonymous/signed-in
  sessions; `POST` accepts guest identity in a JSON body so names are not placed
  in URLs or access logs. Both enforce the configured identity policy and return
  experiment instructions + label schema.
- `POST /annotate/{share_token}/qualifications` — validate and persist the
  annotator's qualification answers before allocation.
- `GET /annotate/{share_token}/next` — returns the next item for this annotator's queue (gold-interleaved per `gold_ratio`, respecting `overlap_n` so the allocator doesn't over/under-assign)
- `POST /annotate/{share_token}/items/{data_unit_id}/annotations` — submit an answer; triggers the scoring event handler (see below)

## 4. Scoring logic (the core differentiated piece — build carefully)

Triggered synchronously in the annotation transaction on every `POST .../annotations`:

```
on_annotation_submitted(annotation):
    data_unit = get(annotation.data_unit_id)

    if data_unit.is_gold:
        is_correct = compare(annotation.answer, data_unit.gold_answer, label_schema)
        update_rolling_gold_accuracy(annotation.annotator_id, is_correct)  # rolling window, not lifetime average

    all_annotations_for_item = get_annotations(data_unit.id)
    if len(all_annotations_for_item) >= experiment.overlap_n:
        agreement = compute_agreement(all_annotations_for_item, label_schema)
        upsert_item_agreement(data_unit.id, agreement, n=len(all_annotations_for_item))
        for a in all_annotations_for_item:
            update_rolling_agreement_score(a.annotator_id, agreement)
```

- **`compare()` / `compute_agreement()` dispatch by `label_schema.annotation_type`**:
  - Categorical single-select: exact equality for gold and average pairwise equality for overlap agreement.
  - Categorical multi-select: Jaccard similarity for gold and average pairwise Jaccard similarity for agreement.
  - Temporal segment/region (audio or video): labels must match, then greedily matched temporal regions are scored by IoU for both gold and pairwise agreement.
- **Rolling window**: annotator gold accuracy and agreement are recomputed from a
  configurable fixed-size recent window (default 20). Derived values can be
  rebuilt from source annotations with `rebuild_scores.py`.
- **Gold agreement**: gold samples use the same inter-annotator agreement logic
  after `overlap_n` submissions while also retaining their independent expected-
  answer score. Because gold items are not capped by overlap, agreement is
  recomputed across all answers whenever another annotator submits one.
- **Low-N caveat**: agreement is unavailable while `n_annotations < overlap_n`.
  Surface `n_annotations` alongside every agreement score so the UI can visually
  de-emphasize scores based on few annotations.

## 5. Task allocation (assigning items to annotators)

`overlap_n` and `gold_ratio` are enforced by the isolated
`allocate_next_item(db, experiment, annotator)` service:

- Query annotation counts and prefer regular items with the lowest count below
  `overlap_n`; exclude samples already seen by the current annotator.
- Determine whether gold is due from the annotator's completed/gold counts and
  configured ratio. Pick unseen eligible gold randomly, with a regular fallback.
- Apply metadata/qualification routing to both regular and gold candidates.
- A row lock and a second count check during submission prevent concurrent
  requests from exceeding the regular-item overlap limit.

### 5.1 Metadata and qualification routing

Each `DataUnit` may carry typed JSONB metadata validated against the experiment's
`metadata_schema`. Experiments may also define a `qualification_form` and a list
of constrained `routing_rules`. Annotator qualification answers are stored
separately from annotation answers.

Supported qualification questions are single choice, multiple choice, boolean,
numeric/proficiency, and free text. Free-text responses are stored as annotator
qualifications but cannot participate in routing. Supported routing comparisons are:

- sample metadata equals an annotator answer;
- a sample metadata value is contained in an annotator's multi-choice answer;
- annotator numeric proficiency is greater than or equal to a sample requirement.

All routing rules use AND semantics. The allocation order is:

1. require an active experiment and annotator;
2. require the qualification form to be complete;
3. exclude samples that do not match routing rules;
4. exclude samples already seen by the annotator;
5. enforce the non-gold overlap limit;
6. apply gold-item cadence among eligible samples.

Gold samples follow the same metadata routing rules as regular samples. The API
distinguishes a truly exhausted queue from remaining work that does not match an
annotator's qualifications.

#### Anonymous annotator identity

Anonymous access removes the account requirement but does not remove the
experiment-scoped identity. The first session request creates an `Annotator` row
and returns a random session token, which the browser stores under a key scoped to
the experiment share token. Questionnaire answers and `qualified_at` are saved on
that annotator; annotations and derived scores reference its UUID.

The designer dashboard exposes the stable anonymous ID, questionnaire answers,
completion count, gold/agreement metrics, status, and last activity. The review
and export endpoints use the same annotator UUID, allowing individual submissions
to be traced back to the anonymous profile. Clearing browser storage or changing
browsers creates a new anonymous identity. When a signed-in user follows an
annotation link, the same experiment-scoped profile is also linked through
`annotator.user_id`, while public contributors can continue without an account.

### 5.2 Dataset bundle import

Experiment creation stages media, metadata, and gold answers together in the
browser before deployment. Metadata uses CSV with a required `filename` column;
gold answers use a JSON array with `filename` and `answer`. The client joins both
to media by exact filename, infers metadata field types, validates gold answers
against the task schema, and displays the assembled rows in an editable table.
Duplicate filenames, orphan manifest entries, missing metadata rows, and invalid
gold answers block deployment.

The Task step displays the required gold structure beside the task controls and
updates it as the annotation configuration changes. Supported answer payloads are:

```json
{"value": "Good"}
{"values": ["Good", "Noisy"]}
{"label": "Good", "regions": [{"start": 0.5, "end": 2.75}]}
{"text": "Expected transcript"}
{"regions": [{"start": 0.5, "end": 2.75, "label": "Speech"}]}
{"boxes": [{"id": "box-1", "label": "Car", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}]}
{"polygons": [{"id": "polygon-1", "label": "Person", "time": 1.25, "points": [{"x": 0.1, "y": 0.1}, {"x": 0.7, "y": 0.1}, {"x": 0.4, "y": 0.7}]}]}
```

These represent categorical single/multi-select, segment, transcription, labeled
temporal, image-box, and frame-aware video-polygon answers. Each gold-manifest
item wraps one answer as `{ "filename": "clip.wav", "answer": ... }`.

After preview validation, the draft-first API flow uploads media, registers typed
metadata, applies gold answers, and only then activates the experiment. Incomplete
imports therefore remain inaccessible through the public share link.

## 6. Implemented v1 milestones

1. **Schema and migrations** — six core tables plus experiment metadata/routing
   configuration and annotator qualification storage.
2. **Experiment creation** — six-step designer flow, registry-backed task schema,
   dataset bundle validation/preview, presigned uploads, and draft deployment.
3. **Annotation runtime** — anonymous resumable session, qualification onboarding,
   allocation, and plugin controls for audio, video, and image tasks.
4. **Scoring** — synchronous rolling gold/agreement updates with exact, Jaccard,
   word-edit, temporal-IoU, cluster-aligned, spatial-IoU, path, and keypoint
   scoring; derived-score rebuild command included.
5. **Designer operations** — global navigation, polling dashboard, annotator
   pause/resume, and per-sample annotation review.
6. **Export** — JSON data pack containing experiment configuration, metadata,
   qualifications, raw annotations, gold answers, scores, and provenance.
7. **Accounts and authorization** — Clerk-hosted authentication, security, and
   profile management; verified session tokens; app-owned user records,
   experiment ownership, protected designer routes, and optional annotator links.
8. **Extensible module lifecycle** — inherited backend/frontend templates,
   versioned schemas, capability-derived compatibility, modality context, and
   editable/read-only shared interactions.

## 7. Visual system

The frontend uses a light Aqua Lab theme designed for long annotation sessions:

- warm white canvas/surfaces with dark ocean text (`#102A32`);
- cyan (`#30AFFF`, `#92EEFF`) for navigation, focus, progress, waveform, and
  interactive selection;
- mint (`#D8FFC5`, `#C4F7CA`) for completed steps, qualified/active states, and
  valid dataset rows;
- a deeper ocean blue (`#087796`) for buttons requiring white text so controls
  retain accessible contrast;
- amber reserved for gold-answer semantics and red reserved for errors or
  destructive actions.

Large saturated backgrounds are avoided. Cards remain white with subtle borders
and shadows, tables use low-contrast row differentiation, and the annotator view
keeps color subordinate to the media and answer controls.


## Annotation catalog architecture

Implemented catalog entries are owned by `BaseAnnotationModule.catalogPresets()`. The catalog registry flattens those declarations and rejects blank or duplicate slugs, missing assets, unknown/incompatible modalities, schema key/version mismatches, invalid schemas, duplicate filenames, and invalid gold answers. Categorical can expose multiple presets while retaining one runtime module.

Examples live under `frontend/public/catalog/<slug>/` with media, `metadata.csv`, `gold_answers.json`, and a downloadable ZIP. Catalog pages use same-origin static fetches only; they have no backend, PostgreSQL, MinIO/S3, upload, session, or submission dependency.

`AnnotationExperience` is the shared production composition boundary for both the annotator runtime and catalog preview. It resolves registered annotation/media plugins, prepares the answer, creates the interaction, renders the registered media renderer and control, and contains media failures behind a retryable local boundary. Catalog answer state exists only in the detail component.

Both catalog routes use the existing Clerk `Protected` boundary. Creation links send `modality` and `annotation_type`; `resolveExperimentPreset()` accepts the pair only when both plugins exist and their capabilities match, otherwise it applies one atomic default pair.
