# Technical Design: Annotation Experiment Platform (v1)

Companion to PRD.md. This is the implementation spec — hand this to engineering agents alongside the PRD.

## 1. Stack
- **Backend**: FastAPI (Python 3.11+)
- **DB**: PostgreSQL (JSONB for flexible schema/answer fields)
- **Migrations**: Alembic
- **Object storage**: S3-compatible (S3, or R2/B2) and local for testing for raw media files; DB stores URIs only, never bytes
- **Frontend**: React + Vite (no Next.js — no SSR requirement for v1)
- **Audio annotation UI**: wavesurfer.js (waveform render + region/point selection)
- **Image annotation UI** (stretch, not v1 blocking): Konva.js / react-konva for bbox/polygon
- **Live dashboard updates**: polling (3–5s interval) against derived scoring tables — no websockets in v1
- **Repo layout**: monorepo
  ```
  /backend   (FastAPI app, Alembic migrations, scoring logic)
  /frontend  (React + Vite: designer app + annotator app, can be two entry points in one Vite project or two packages)
  ```
- **Deployment**: Dockerize the application as frontend and backend seprately

## 2. Data model

```sql
-- Experiment: the unit of design/deploy/track
CREATE TABLE experiment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    modality TEXT NOT NULL,                 -- 'audio' | 'image' (v1: 'audio' only enforced at app layer)
    instructions TEXT,
    label_schema JSONB NOT NULL,            -- label set, annotation type (point|segment|bbox|polygon), cardinality rules
    overlap_n INT NOT NULL DEFAULT 1,        -- how many distinct annotators must see each non-gold item
    gold_ratio FLOAT NOT NULL DEFAULT 0.1,   -- fraction of each annotator's queue that is gold, interleaved
    share_token TEXT UNIQUE NOT NULL,        -- public link identifier, e.g. nanoid
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DataUnit: one item to be annotated
CREATE TABLE data_unit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    raw_uri TEXT NOT NULL,                   -- S3 URI to the raw audio/image file
    is_gold BOOLEAN NOT NULL DEFAULT FALSE,
    gold_answer JSONB                        -- null unless is_gold; shape matches label_schema
);

-- Annotator: anonymous, session-token identified
CREATE TABLE annotator (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    session_token TEXT UNIQUE NOT NULL,      -- set via cookie on first visit to share link
    status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'paused' (manual designer action)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
- `annotator_score` and `item_agreement` are **derived tables**, not sources of truth. They must always be re-derivable from `annotation` + `data_unit`. Do not let them drift into being edited directly.

## 3. API surface (v1)

### Designer-facing (no auth in v1 — add an API key or session later, not blocking)
- `POST /experiments` — create experiment (name, modality, instructions, label_schema, overlap_n, gold_ratio) → returns `share_token`
- `POST /experiments/{id}/data-units` — batch upload: accepts list of raw file references (already uploaded to S3 via presigned URL, see below) plus optional `is_gold`/`gold_answer` per item
- `GET /experiments/{id}/dashboard` — returns completion %, annotator list with scores, item agreement summary (this is what the dashboard polls)
- `PATCH /annotators/{id}` — set status to `paused` (manual removal from pool)
- `GET /experiments/{id}/export` — returns the data pack (JSON/JSONL: data_unit + all annotations + agreement/gold scores + provenance)
- `POST /uploads/presign` — returns a presigned S3 URL so raw files go directly from browser to object storage, not through the FastAPI app

### Annotator-facing (share_token based, session-token identified)
- `GET /annotate/{share_token}/session` — creates or resumes an annotator session (sets/reads session token), returns experiment instructions + label_schema
- `GET /annotate/{share_token}/next` — returns the next item for this annotator's queue (gold-interleaved per `gold_ratio`, respecting `overlap_n` so the allocator doesn't over/under-assign)
- `POST /annotate/{share_token}/items/{data_unit_id}/annotations` — submit an answer; triggers the scoring event handler (see below)

## 4. Scoring logic (the core differentiated piece — build carefully)

Triggered synchronously or via a lightweight background task on every `POST .../annotations`:

```
on_annotation_submitted(annotation):
    data_unit = get(annotation.data_unit_id)

    if data_unit.is_gold:
        is_correct = compare(annotation.answer, data_unit.gold_answer, label_schema)
        update_rolling_gold_accuracy(annotation.annotator_id, is_correct)  # rolling window, not lifetime average

    all_annotations_for_item = get_annotations(data_unit.id)
    if len(all_annotations_for_item) >= experiment.overlap_n and not data_unit.is_gold:
        agreement = compute_agreement(all_annotations_for_item, label_schema)
        upsert_item_agreement(data_unit.id, agreement, n=len(all_annotations_for_item))
        for a in all_annotations_for_item:
            update_rolling_agreement_score(a.annotator_id, agreement)
```

- **`compare()` / `compute_agreement()` dispatch by `label_schema.annotation_type`**:
  - Categorical label (single class per item): exact match for gold; Cohen's kappa (2 annotators) or Fleiss' kappa (3+) for overlap agreement.
  - Segment/region (audio) or bbox/polygon (image): IoU-based — threshold match (e.g. IoU ≥ 0.5) for gold correctness; average pairwise IoU for overlap agreement.
- **Rolling window**: use a fixed-size window (e.g. last 20 gold items) or exponential decay, not a lifetime average — an annotator's early mistakes shouldn't permanently haunt their score. Pick fixed-window for v1 simplicity; exponential decay is a reasonable v1.1 upgrade, not a blocker.
- **Low-N caveat**: when `n_annotations < overlap_n` is impossible by construction (agreement only computes at exactly `overlap_n`), but do surface `n_annotations` alongside every agreement score in the API/dashboard response so the UI can (and should) visually de-emphasize scores based on very few gold items too (e.g. "accuracy: 80% (n=4)" reads very differently from "n=40").

## 5. Task allocation (assigning items to annotators)

Needed so `overlap_n` and `gold_ratio` are actually honored, not just configured:
- Maintain, per experiment, a simple counter per `data_unit` of how many *non-gold* annotations it has so far; `GET .../next` should prefer items with `count < overlap_n` and exclude items the requesting annotator has already annotated (enforced by the `UNIQUE` constraint anyway, but check before serving to avoid a wasted round trip).
- Interleave gold items: e.g. every 1/`gold_ratio` items served to a given annotator should be a gold item they haven't seen yet, picked pseudo-randomly from the gold set — not always the same first N items.
- Keep this allocator as its own function/module (`allocate_next_item(experiment, annotator)`) even in v1 — it's a small piece of logic but it's load-bearing for the scoring math being valid, and it's easy to accidentally entangle with the API handler if not kept separate.

### 5.1 Metadata and qualification routing

Each `DataUnit` may carry typed JSONB metadata validated against the experiment's
`metadata_schema`. Experiments may also define a `qualification_form` and a list
of constrained `routing_rules`. Annotator qualification answers are stored
separately from annotation answers.

Supported qualification questions are single choice, multiple choice, boolean,
and numeric/proficiency. Supported routing comparisons are:

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

### 5.2 Dataset bundle import

Experiment creation stages media, metadata, and gold answers together in the
browser before deployment. Metadata uses CSV with a required `filename` column;
gold answers use a JSON array with `filename` and `answer`. The client joins both
to media by exact filename, infers metadata field types, validates gold answers
against the task schema, and displays the assembled rows in an editable table.
Duplicate filenames, orphan manifest entries, missing metadata rows, and invalid
gold answers block deployment.

After preview validation, the draft-first API flow uploads media, registers typed
metadata, applies gold answers, and only then activates the experiment. Incomplete
imports therefore remain inaccessible through the public share link.

## 6. Build order (match to PRD milestones)

1. **Schema + migrations** — all 6 tables above, running locally via Docker Postgres. No app logic yet.
2. **Experiment CRUD** — create experiment, presigned upload → batch-create data_units (incl. gold), minimal designer React form. Acceptance: can create an experiment and see its items in the DB.
3. **Single-modality annotation flow (audio)** — share link → session → `next` endpoint (allocator, gold interleaving) → wavesurfer.js UI → submit. No scoring yet. Acceptance: a real person can open the link and submit annotations that land in the `annotation` table correctly.
4. **Scoring** — event handler + kappa/IoU implementations + `annotator_score`/`item_agreement` tables populated live. Acceptance: submitting a wrong answer on a gold item visibly changes that annotator's rolling accuracy within seconds; completing the Nth overlap annotation populates `item_agreement`.
5. **Dashboard** — polling React view over `GET /experiments/{id}/dashboard`. Acceptance: designer can watch scores update live while annotators are working, and can pause an annotator.
6. **Export** — `GET /experiments/{id}/export` → JSON/JSONL data pack.

Do not start step 3 before step 1–2 are solid — the schema is the contract every later step depends on, and reworking it after the annotation UI exists is expensive.
