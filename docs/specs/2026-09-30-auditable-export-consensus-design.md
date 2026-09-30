# Auditable Dataset Export and Consensus Design

**Status:** Proposed  
**Date:** 2026-09-30  
**Product:** TaskGlass

## 1. Goal

Give an experiment owner a durable, self-explanatory ZIP archive that can be
used outside TaskGlass without losing the evidence behind the labels.

The export flow offers two modes:

1. **Complete archive** — original media, sample metadata, gold references,
   every submitted annotation, annotator quality evidence, item agreement, and
   the methods used to compute derived scores.
2. **Consensus dataset** — one final answer per accepted sample, plus the raw
   evidence, exclusions, warnings, and reproducibility information used to
   choose it.

Raw submissions are immutable source evidence. Consensus is a derived view and
must never overwrite or hide those submissions.

## 2. Product principles

- **Raw export is always available.** Quality concerns cannot trap an owner's
  data inside TaskGlass.
- **Consensus is explainable.** Every selected answer names its source
  annotations, weights, algorithm version, confidence, and warning status.
- **Guardrails inform and require acknowledgement.** They separate clean items
  from items needing review. They do not silently discard work.
- **Gold and agreement have different jobs.** Gold answers estimate annotator
  reliability when enough evidence exists. Inter-annotator agreement identifies
  ambiguous items and supports consensus confidence; it is not, by itself, a
  reason to declare an annotator incorrect.
- **Consensus is annotation-type-owned.** The shared lifecycle validates inputs,
  weights, output shape, audit fields, and score bounds. Annotation modules can
  specialize selection without changing export orchestration.
- **An export is a snapshot.** Its manifest records the source cutoff, counts,
  configuration, code/algorithm versions, and checksum.
- **Confidence is local.** It is useful for ranking items within an experiment,
  not as an absolute probability of correctness or for comparison across
  unrelated experiments.

## 3. User experience

The experiment dashboard replaces the current one-click JSON action with an
**Export dataset** dialog.

### 3.1 Choose an export mode

- **Complete archive** — recommended for audit, research, and custom processing.
- **Consensus dataset** — recommended for training and downstream consumption.

Both modes include media by default. The dialog shows an estimated item count
and, when available, an estimated media size.

### 3.2 Configure consensus guardrails

Consensus mode shows a policy panel with defaults and short explanations:

- minimum annotations required for consensus: `2`;
- annotations below `3`: accepted only as `low_evidence`;
- minimum gold items before automatic gold-based exclusion: `5`;
- minimum acceptable full-history gold score: `0.70`;
- minimum item agreement: `0.60`;
- flagged-item behavior: place in `review/needs_review.jsonl` and omit from the
  training-ready file.

Thresholds are export-time policy, not changes to stored annotations or live
experiment scoring. The chosen values are written to `quality/methodology.json`.

### 3.3 Preflight

Before generation, TaskGlass computes and displays:

- total, annotated, unannotated, and gold samples;
- samples accepted for consensus;
- samples with insufficient overlap;
- samples below the agreement threshold;
- tied or otherwise unresolved samples;
- annotators included, excluded, or lacking enough gold evidence;
- estimated archive size when object metadata is available.

The complete archive can always proceed. Consensus generation requires explicit
acknowledgement when warnings exist. The resulting manifest exposes
`training_ready: false` while unresolved warnings remain.

### 3.4 Progress and download

ZIP creation is asynchronous and durable. The dashboard shows queued,
generating, ready, failed, and expired states. A ready export receives a
short-lived presigned download URL. Users can regenerate an expired archive
from a new snapshot.

## 4. Archive contracts

### 4.1 Complete archive

```text
taskglass-{safe-experiment-name}-{snapshot}.zip
├── README.md
├── manifest.json
├── media/
│   └── {data_unit_id}/{original_filename}
├── dataset/
│   ├── samples.jsonl
│   └── metadata.csv
├── annotations/
│   ├── all_annotations.jsonl
│   └── gold_answers.jsonl
└── quality/
    ├── annotators.csv
    ├── items.csv
    ├── warnings.json
    └── methodology.json
```

### 4.2 Consensus dataset

```text
taskglass-{safe-experiment-name}-{snapshot}-consensus.zip
├── README.md
├── manifest.json
├── media/
│   └── {data_unit_id}/{original_filename}
├── dataset/
│   ├── final_annotations.jsonl
│   └── metadata.csv
├── review/
│   ├── needs_review.jsonl
│   └── excluded_annotations.jsonl
└── quality/
    ├── raw_annotations.jsonl
    ├── annotators.csv
    ├── items.csv
    ├── warnings.json
    └── methodology.json
```

JSONL is canonical for row-oriented records. CSV is supplied only where values
are naturally tabular. JSON serialization is UTF-8, timestamps are ISO 8601
UTC, and UUIDs are strings.

Media paths include the data-unit UUID so duplicate input filenames cannot
overwrite each other. `samples.jsonl` maps each logical sample to its archive
path and original S3 URI. Presigned URLs are never embedded because they expire.

## 5. Record shapes

Each raw annotation record contains:

```json
{
  "annotation_id": "uuid",
  "data_unit_id": "uuid",
  "filename": "clip.wav",
  "annotator_export_id": "annotator-0003",
  "answer": {},
  "submitted_at": "2026-09-30T10:00:00Z",
  "is_gold_item": false,
  "gold_score": null,
  "included_in_consensus": true,
  "exclusion_reasons": []
}
```

Session tokens, Clerk IDs, email addresses, and presigned URLs are never
exported. Annotators receive stable experiment-scoped export IDs. The complete
archive includes qualification answers because they are part of experiment
provenance; `manifest.json` marks them as potentially sensitive.

Each final consensus record contains:

```json
{
  "data_unit_id": "uuid",
  "filename": "clip.wav",
  "metadata": {},
  "answer": {},
  "consensus": {
    "method": "quality_weighted_medoid",
    "algorithm_version": 1,
    "confidence": 0.84,
    "agreement": 0.78,
    "votes_total": 3,
    "votes_used": 2,
    "source_annotation_ids": ["uuid", "uuid"],
    "excluded_annotation_ids": ["uuid"],
    "status": "accepted",
    "warnings": []
  }
}
```

Gold items use their configured gold answer and report
`method: "gold_reference"`. Worker answers on those items remain in the quality
audit files.

## 6. Consensus and quality model

### 6.1 Export-time annotator evidence

The export recomputes full-history gold evidence at the snapshot cutoff instead
of using the live rolling window alone:

- `gold_items_seen`;
- raw mean gold score;
- reliability weight shrunk toward neutral to reduce small-sample volatility;
- live rolling gold and agreement values for operational context.

The default reliability weight is:

```text
(sum(gold_scores) + prior_strength * 0.5) /
(gold_items_seen + prior_strength)
```

with `prior_strength = 2`. Before `minimum_gold_items` is reached, the
annotator is `insufficient_gold_evidence`, receives neutral weight `1.0`, and is
not automatically excluded. After enough evidence, an annotator below the
configured gold threshold is excluded from default consensus but retained in
the archive.

Low annotator agreement creates a warning. It does not automatically exclude
an annotator because majority disagreement can reflect ambiguous items or a
systematic majority error.

### 6.2 Shared consensus lifecycle

`BaseAnnotationType` gains a final public method conceptually shaped as:

```python
consensus(
    answers: list[WeightedAnswer],
    config: dict,
) -> ConsensusResult
```

The base implementation:

1. validates every answer through the module's existing answer model;
2. rejects invalid/non-finite weights;
3. computes pairwise similarity through the module's scoring hook;
4. selects the submitted answer with the greatest weighted mean similarity to
   the other eligible answers;
5. reports exact top-score ties as unresolved, with tied candidates sorted by
   submission timestamp then UUID for deterministic output;
6. validates a uniquely selected answer again;
7. returns selected source IDs, confidence, method, and algorithm version.

Selecting a real submitted answer (a medoid) avoids manufacturing invalid
temporal boundaries, polygons, or transcripts. Modules may override only the
protected selection hook when a task-specific algorithm is justified. The base
lifecycle and audit result remain mandatory.

### 6.3 Item statuses

- `gold_reference` — final answer came from configured gold.
- `accepted` — passed overlap, eligibility, and agreement policy.
- `low_evidence` — two answers produced a result, but fewer than the recommended
  three were available.
- `needs_review_low_agreement` — below item threshold.
- `needs_review_tie` — no unique winning candidate.
- `needs_review_insufficient_overlap` — fewer than the minimum answers.
- `needs_review_no_eligible_annotations` — all answers were excluded.
- `unannotated` — no submitted answer.

Only `gold_reference`, `accepted`, and—when explicitly enabled—`low_evidence`
appear in `dataset/final_annotations.jsonl`. Every other sample appears in
`review/needs_review.jsonl`.

## 7. Durable export jobs

Generating ZIPs inside a request is unsafe for large media collections and the
gateway's request timeout. Add an `export_job` table:

- `id`, `experiment_id`, `requested_by_user_id`;
- `mode` (`complete` or `consensus`);
- `status` (`queued`, `running`, `ready`, `failed`, `expired`);
- `policy` JSONB;
- `source_cutoff_at` and source counts/fingerprint;
- `preflight_summary` JSONB and `warnings` JSONB;
- `object_uri`, `size_bytes`, `sha256`;
- `error_code`, sanitized `error_message`;
- `created_at`, `started_at`, `completed_at`, `expires_at`.

A dedicated exporter process uses PostgreSQL as its queue with
`FOR UPDATE SKIP LOCKED`. This avoids introducing Redis while remaining durable
across API restarts. The worker runs from the backend image through a separate
Compose service and command. It:

1. claims one queued job;
2. reads only annotations at or before `source_cutoff_at`;
3. streams S3 objects and generated JSONL/CSV into a temporary ZIP;
4. uploads the ZIP under `exports/{experiment_id}/{job_id}.zip`;
5. records checksum/size and marks the job ready;
6. removes temporary files in success and failure paths.

Jobs use bounded local disk, configurable maximum uncompressed/archive sizes,
and a retention period. A cleanup command deletes expired S3 artifacts and
marks their rows expired.

## 8. API contract

- `POST /experiments/{id}/exports/preflight`
  - body: mode and optional consensus policy;
  - response: counts, warnings, estimated size, normalized policy, and a
    preflight fingerprint.
- `POST /experiments/{id}/exports`
  - body: mode, normalized policy, preflight fingerprint, and
    `acknowledge_warnings`;
  - response: `202` with export-job ID;
  - rejects stale fingerprints so the user sees updated warnings.
- `GET /experiments/{id}/exports`
  - lists recent jobs owned by the experiment owner.
- `GET /experiments/{id}/exports/{job_id}`
  - status, progress phase, summary, warnings, and expiry.
- `POST /experiments/{id}/exports/{job_id}/download`
  - returns a short-lived presigned URL only for ready, unexpired jobs.

All endpoints use existing experiment ownership/admin authorization. The old
`GET /experiments/{id}/export` remains temporarily as the legacy JSON export,
is labeled deprecated, and is removed only after the ZIP workflow ships.

## 9. Snapshot and reproducibility

The job captures a source cutoff and deterministic ordering. Annotations are
included only when `submitted_at <= source_cutoff_at`. Because the current data
unit and gold-manifest endpoints do not fully lock dataset mutation, preflight
computes a fingerprint over ordered data-unit IDs, raw URIs, metadata, gold
answers, and eligible annotation IDs/answers. The worker recalculates it inside
a repeatable-read transaction before generation and fails with `source_changed`
if it no longer matches. The manifest records:

- experiment/schema versions and configuration;
- export mode and policy;
- annotation-module key/schema version;
- consensus algorithm name/version;
- source counts and cutoff;
- generated-at timestamp;
- a logical source/content fingerprint;
- warnings and `training_ready` state.

The non-circular SHA-256 of the completed ZIP is stored on `export_job` and
returned by the status/download APIs rather than embedded inside the ZIP.

The same snapshot and policy must produce byte-equivalent logical records.
ZIP container timestamps may be normalized if byte-for-byte reproducibility is
required.

## 10. Failure handling and security

- Object keys and original filenames are sanitized; archive paths cannot contain
  `..`, absolute roots, or platform separators.
- ZIP contents are generated by TaskGlass; uploaded archives are never expanded.
- Download URLs are short-lived and owner-authorized at issuance.
- Export artifacts inherit the experiment's access boundary and are not public.
- Failures expose stable error codes to users and keep detailed traces only in
  server logs.
- Partial local files and failed S3 objects are removed.
- A job can be retried by creating a new snapshot; completed artifacts are never
  mutated in place.

## 11. Observability

Structured events include `export.queued`, `export.started`,
`export.preflight_completed`, `export.completed`, `export.failed`, and
`export.expired`. They carry job/experiment IDs, mode, counts, duration, bytes,
warning totals, and algorithm version, but no answers, questionnaire values, or
presigned URLs.

## 12. Testing strategy

- Unit tests for reliability weighting, policy classification, weighted-medoid
  selection, deterministic ties, archive-path sanitization, JSONL/CSV rendering,
  and every item status.
- Contract tests proving every registered annotation module can produce a valid
  consensus result from its own valid answers.
- Integration tests for ownership, preflight staleness, warning acknowledgement,
  job claiming, snapshot cutoffs, ZIP contents, S3 upload/download, expiry, and
  cleanup.
- Failure tests for missing objects, duplicate filenames, worker restart,
  insufficient disk/size limits, and upload failure.
- Frontend tests for mode selection, policy defaults, warning acknowledgement,
  progress polling, ready download, failure, and expiry.
- End-to-end smoke tests with one categorical, one temporal, and one spatial
  experiment.

## 13. Delivery boundaries

### Included in the first release

- complete and consensus ZIP modes;
- original media and TaskGlass-native JSONL/CSV;
- full audit/provenance files;
- configurable guardrails and review bucket;
- shared quality-weighted-medoid consensus lifecycle;
- durable PostgreSQL-backed export worker;
- presigned downloads and expiry cleanup;
- legacy JSON export retained during migration.

### Deferred

- COCO, YOLO, RTTM, WebVTT, or other ecosystem-specific adapters;
- Dawid–Skene/EM inference for categorical labels;
- manual adjudication that writes a new authoritative annotation;
- automatic reassignment of flagged samples;
- cross-experiment confidence comparisons;
- scheduled or recurring exports.

These become independent export adapters or review workflows after the native
auditable bundle is validated with real experiments.

