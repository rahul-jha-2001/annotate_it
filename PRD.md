# PRD: Annotation Experiment Platform (v1)

## 1. Problem
Teams and individuals need to design data-annotation tasks (mark points/segments in audio, boxes/polygons in images, etc.), get them annotated by other people via a shared link, and know — while it's happening, not after — whether the annotations coming back are trustworthy.

Existing tools solve pieces of this (Label Studio: annotation UI; MTurk/Prolific: distribution) but not the combination of: fast experiment design + shareable-by-link deployment + **live** quality tracking via gold-standard items and inter-annotator overlap.

## 2. Goal (v1 scope — explicitly cut)
Build a system where a single designer can:
1. **Design** an annotation experiment: choose a registered modality, define a label schema, select an annotator access mode, import media with metadata and gold answers, preview the assembled dataset, optionally qualify annotators and route samples by metadata, and configure overlap/quality-check frequency.
2. **Deploy** the experiment as a single shareable link.
3. **Share** that link using one of three experiment-level access modes: verified
   sign-in, unverified guest name, or a fully anonymous session.
4. **Track** the experiment live: per-annotator accuracy against gold items,
   per-item agreement across overlapping annotators for both regular and gold
   samples, and overall completion.


## 3. Users
- **Designer**: a signed-in user who creates and owns experiments. Clerk manages
  their configured sign-in methods and account security; designers can access
  only their own projects.
- **Platform administrator**: can inspect all experiments and administer legacy
  unowned data. The first account created is the bootstrap administrator.
- **Annotator**: anyone permitted by the share link's access mode. They may use a
  verified account, provide a guest display name, or remain anonymous, and are
  represented by a stable experiment-scoped profile containing their questionnaire,
  activity, annotations, and derived quality metrics.

## 4. Core user flows

### 4.0 Sign in and manage an account
- A designer signs up or signs in through Clerk using the methods enabled for the
  deployment, initially Google and Microsoft.
- Clerk manages credentials, account verification, sessions, connected accounts,
  and recovery. The frontend sends Clerk's short-lived session token to FastAPI,
  which verifies it before performing local authorization.
- The Clerk profile UI lets the designer update identity details, inspect
  security settings, manage connected accounts, and terminate sessions.

### 4.1 Design an experiment
- Designer creates an Experiment: name, modality (audio or video), instructions text.
- Designer chooses whether annotators must sign in, provide a guest name, or may
  participate fully anonymously.
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
- The designer can later edit the name and instructions. Access mode, overlap,
  and gold cadence remain editable only until the first annotation is submitted;
  task schema and dataset changes are intentionally outside this settings flow.
- Deleting an experiment requires its exact name and clearly warns that all
  collected work will disappear from the application. v1 performs a recoverable
  soft delete and retains the underlying rows for audit/recovery.

### 4.2 Deploy & share
- Designer clicks "Deploy" → system generates a unique share link (`/annotate/{share_token}`).
- Designer copies/shares this link by any channel (email, social, Slack — out of scope to build in-app sharing beyond generating the link).

### 4.3 Annotate (annotator flow)
- Annotator opens the share link. Depending on the experiment, they sign in with
  Clerk, enter an unverified display name, or continue anonymously. A stable
  experiment-scoped session token is persisted in browser local storage.
- If the experiment has qualification questions, the annotator completes them
  once before receiving work. Required answers are validated, and sample routing
  uses only supported structured answers.
- Annotator sees instructions, then is served the next unannotated item from their assigned queue (gold items interleaved).
- Annotator uses plugin-driven media and answer controls: categorical choices or
  labeled time regions over audio/video, then submits.
- Repeats until their queue is exhausted or they stop.
- “Anonymous” means no account or name is required, not that activity is discarded. The
  same browser session continues under the same anonymous ID for that experiment.
  Guest names are explicitly marked as unverified. Sign-in-required experiments
  link the annotator profile to the verified local Clerk-backed user.

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
- Designer APIs reject anonymous requests and prevent one designer from reading
  or changing another designer's experiments.
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
