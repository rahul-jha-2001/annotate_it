# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two designer groups are weighted equally, and future work should serve both:

- **Academic research labs** running human-labeling studies (speech, vision, and similar), who care about methodological rigor, recruited-participant handling, and results they can defend.
- **ML/data teams at startups** building training or evaluation data, who care about setup speed, trustworthy quality signals, and exports that drop into their pipelines.

Supporting roles:

- **Annotator:** anyone allowed in by an experiment's share link. Depending on the experiment's access mode, they sign in with a verified account, give an unverified guest name, or stay anonymous in a stable per-experiment session. Their job is to finish their assigned queue, which may begin with qualification questions.
- **Platform administrator:** can inspect all experiments and administer unowned legacy data.

## Product Purpose

TaskGlass lets one designer design an annotation experiment, deploy it as a single shareable link, and track whether the returning annotations can be trusted while collection is still running. It then exports the result with the evidence behind every label.

Success means a designer can go from a folder of supported media to a live annotation link in one sitting, with no per-experiment engineering. Gold accuracy and agreement update within seconds of a submission. The exported data stays explainable outside TaskGlass.

## Positioning

Other tools cover parts of this: Label Studio provides an annotation UI, and MTurk and Prolific provide distribution. TaskGlass combines four things:

1. **Fast experiment design:** registered modality plus task, a dataset bundle assembled and validated by filename, qualifications, and metadata routing.
2. **One-link deployment** with three access modes: verified, guest, or anonymous.
3. **Live quality tracking:** per-annotator accuracy against interleaved gold items, and per-item inter-annotator agreement, both visible during the run.
4. **Auditable export:** a complete archive or a consensus dataset. Each consensus answer names its source annotations, weights, algorithm version, confidence, and warnings. Raw submissions are never overwritten or hidden.

## Operating Context

- **Designer flow:** sign in (Clerk) → six-step wizard (basics, annotation task with live annotator preview, dataset bundle of media + optional metadata CSV + optional gold JSON, dataset preview table with inline previews, qualifications/routing and optional observational teaching examples, review) → deploy → share link by any outside channel → poll-based dashboard → review by sample → auditable export.
- **Annotator flow:** open link → access gate → qualification questions if any → observational teaching examples (with answer overlays and explanations, never scored) if configured → instructions → queue of items with gold items interleaved and not visually marked → submit until the queue runs out or they stop.
- **Annotation catalog:** designers browse presets by modality, try the real annotator experience on example media, and can start the wizard with modality and task preselected.
- **Export:** a ZIP snapshot whose manifest records source cutoff, counts, configuration, code/algorithm versions, checksum, and consensus settings.

## Capabilities and Constraints

- **Modalities:** audio, video, and image, as build-time plugins.
- **Tasks:** categorical, transcription, temporal segment, labeled temporal/diarization, bounding box, polygon, polyline, ellipse, and keypoint. Each experiment has exactly one annotation type.
- **Extensibility:** modality and task are independent and joined through declared capabilities. Shared screens must not branch on a specific modality or task. Adding a modality touches only its plugin, its backend descriptor, and tests.
- **Validation:** the backend is authoritative, and frontend validation only improves authoring feedback. Duplicate, missing, orphaned, or malformed dataset entries block progress rather than being dropped.
- **Locking:** after the first annotation, access mode, overlap, and gold cadence lock. Name and instructions stay editable. Deletion requires typing the exact name and is a soft delete.
- **Quality semantics:** gold estimates annotator reliability. Agreement identifies ambiguous items and is not by itself proof that an annotator is wrong. Confidence is local to one experiment, not an absolute probability. With few annotators, agreement must be shown alongside N so it does not imply false precision.
- **Guardrails:** they inform and require acknowledgement. They never silently discard work, and raw export is always available.
- **Out of scope:** in-app sharing beyond generating the link, a gold dispute/appeals flow, and runtime third-party plugins. Masks, skeletons, cuboids, tracking, OCR, LiDAR, and multi-camera data are deferred (`docs/DEFERRED_ANNOTATION_SYSTEMS.md`).
- **Open:** whether to replace pairwise categorical agreement with Cohen's or Fleiss' kappa.

## Brand Commitments

- The product name is **TaskGlass**. "Annotate It" and "Annotation Experiment Platform" must not appear in the shell or title (enforced by `frontend/src/productBranding.test.ts`).
- **Honest sample data:** illustrative UI is labeled as sample data. Never invent customers, testimonials, benchmarks, or metrics.

## Evidence on Hand

- Product docs: `PRD.md`, `project_summary.md`, `TECH_DESIGN.md`, `AUTHENTICATION.md`, `docs/specs/2026-09-30-auditable-export-consensus-design.md`.
- Sample data: `sample/`, catalog example media in `frontend/public/catalog/`, and example export archives at the repo root (`taskglass-Test_Exp_1-*.zip`).
- None of the following exist yet, and future work must not fabricate them: customers, testimonials, case studies, usage numbers, press, pricing, or published benchmarks.

## Product Principles

1. **Trust is visible while it can still be acted on.** Quality signals belong in the live run, not in a post-mortem.
2. **Evidence is never lost.** Raw submissions are immutable, derived views explain themselves, and data is never trapped inside TaskGlass.
3. **Inform, don't silently decide.** Guardrails flag problems and ask for acknowledgement. Pausing an annotator or excluding an item is the designer's call.
4. **No false precision.** Scores come with their N, their method, and their scope.
5. **One sitting, no engineering.** Setup should be self-explanatory and should block invalid states early, with clear reasons.
