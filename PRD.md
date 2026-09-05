# PRD: Annotation Experiment Platform (v1)

## 1. Problem
Teams and individuals need to design data-annotation tasks (mark points/segments in audio, boxes/polygons in images, etc.), get them annotated by other people via a shared link, and know — while it's happening, not after — whether the annotations coming back are trustworthy.

Existing tools solve pieces of this (Label Studio: annotation UI; MTurk/Prolific: distribution) but not the combination of: fast experiment design + shareable-by-link deployment + **live** quality tracking via gold-standard items and inter-annotator overlap.

## 2. Goal (v1 scope — explicitly cut)
Build a system where a single designer can:
1. **Design** an annotation experiment: choose a registered modality, define a label schema, import media with metadata and gold answers, preview the assembled dataset, optionally qualify annotators and route samples by metadata, and configure overlap/quality-check frequency.
2. **Deploy** the experiment as a single shareable link.
3. **Share** that link with anyone — no login required, just enough session identity to prevent trivial double-submission and to attribute scores per person.
4. **Track** the experiment live: per-annotator accuracy against gold items, per-item agreement across overlapping annotators, and overall completion.


## 3. Users
- **Designer**: the person creating and monitoring the experiment (could be a solo researcher, or an enterprise user — same flow either way in v1, since there's no auth differentiation yet).
- **Annotator**: anyone with the share link. They may remain anonymous, but are
  represented by a stable experiment-scoped session profile containing their
  questionnaire, activity, annotations, and derived quality metrics.

## 4. Core user flows

### 4.1 Design an experiment
- Designer creates an Experiment: name, modality (audio or video), instructions text.
- Designer defines one annotation type and its labels: categorical single-select,
  categorical multi-select, or temporal segment/region.
- The task step provides an interactive annotator preview and shows the exact
  gold-answer JSON structure required for the current task configuration.
- Designer imports one dataset bundle consisting of media files, an optional
  metadata CSV, and an optional gold-answer JSON file. Manifest entries join to
  media by exact filename.
- The system infers typed metadata fields and presents every assembled sample in
  a table with modality-appropriate playback/preview, editable metadata, editable gold answers, and a
  visible validation status. Duplicate, missing, orphaned, or malformed entries
  block progress rather than being silently dropped.
- Gold samples are used for accuracy scoring and are NOT visually distinguished
  from regular items to the annotator.
- Designer may ask annotators single-choice, multi-choice, yes/no, numeric, or
  free-text qualification questions. Structured answers may be connected to
  sample metadata using constrained routing rules. Free-text answers are stored
  for review/export and cannot be used for automatic routing.
- Designer sets `overlap_n` (how many distinct annotators must annotate each non-gold item) and `gold_ratio` (fraction of items in each annotator's queue that are gold, interleaved rather than front-loaded).
- Creation is draft-first: media, metadata, and gold configuration must register
  successfully before the experiment becomes active and its share link works.

### 4.2 Deploy & share
- Designer clicks "Deploy" → system generates a unique share link (`/annotate/{share_token}`).
- Designer copies/shares this link by any channel (email, social, Slack — out of scope to build in-app sharing beyond generating the link).

### 4.3 Annotate (annotator flow)
- Annotator opens the share link. No login. A session token is created and
  persisted in browser local storage on first visit.
- If the experiment has qualification questions, the annotator completes them
  once before receiving work. Required answers are validated, and sample routing
  uses only supported structured answers.
- Annotator sees instructions, then is served the next unannotated item from their assigned queue (gold items interleaved).
- Annotator uses plugin-driven media and answer controls: categorical choices or
  labeled time regions over audio/video, then submits.
- Repeats until their queue is exhausted or they stop.
- “Anonymous” means no account is required, not that activity is discarded. The
  same browser session continues under the same anonymous ID for that experiment.

### 4.4 Track (designer dashboard)
- Live-updating (poll-based) dashboard per experiment showing:
  - Completion %, items remaining, total annotators active.
  - Per-annotator: rolling accuracy vs. gold items, items completed.
  - Per-annotator profile: anonymous ID, questionnaire answers, qualification
    time, status, and last activity.
  - Per-item: agreement score once `overlap_n` annotations are in.
  - A simple flag/highlight for annotators whose rolling accuracy has dropped below a threshold — visible, not automated.
- Designer can manually pause/remove an annotator from the pool (their session stops receiving new items).
- Designer can open an annotation review view organized by sample, with its media,
  metadata, gold answer, agreement, and every submitted annotation together.

### 4.5 Export
- Designer exports a "data pack": raw data + final annotations + per-item confidence/agreement + provenance (annotator id, timestamp), in a standard format (JSON/JSONL to start).

## 5. Success criteria for v1
- A designer can go from a folder of supported media files to a live shareable
  annotation link in one sitting, without engineering help per experiment.
- Adding a modality changes only its frontend media plugin, backend capability
  descriptor, and tests; shared creation, annotation, preview, and review screens
  remain unchanged.
- Before deployment, the designer can verify that every uploaded filename,
  metadata record, and gold answer was assembled as intended.
- A designer can restrict language- or proficiency-specific samples without
  writing arbitrary code, while still collecting non-routable free-text context.
- Gold-item accuracy and overlap agreement scores update within seconds of a relevant submission (not batch/overnight).
- At least one full experiment can be run end-to-end (design → deploy → share → 3+ real annotators → export) as the acceptance test for this version.

## 6. Key risks / open questions
- **Scoring correctness**: categorical exact/Jaccard similarity and temporal IoU
  must be correctly implemented. Whether to replace pairwise categorical
  agreement with Cohen/Fleiss kappa after gathering real usage data remains open.
- **Cold start on agreement**: with few annotators, overlap-based agreement is statistically noisy. v1 should surface confidence/N alongside any agreement score rather than implying false precision.
- **Ambiguous gold items**: some gold "correct" answers may be genuinely disputable (e.g. audio segment boundary ±200ms). No dispute/appeals flow in v1 — accepted risk, revisit once real usage surfaces this.
- **Modality depth**: audio and video support categorical and temporal-region
  tasks. Image/text and spatial/text-range interactions remain later plugins and
  must preserve the same extension boundary.

## 7. Extensibility requirements

- Media modality and annotation task are independent concepts joined through
  declared interaction capabilities.
- Shared screens resolve renderers and task behavior through typed registries;
  they must not contain modality-specific or annotation-type-specific branches.
- The API rejects unknown or incompatible modality/task combinations.
- Frontend validation improves authoring feedback, while backend validation is
  always authoritative.
- Runtime third-party modules and microfrontends are out of scope. Plugins are
  internal, build-time modules until independent deployment becomes a real need.
