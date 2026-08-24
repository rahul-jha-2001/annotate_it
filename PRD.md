# PRD: Annotation Experiment Platform (v1)

## 1. Problem
Teams and individuals need to design data-annotation tasks (mark points/segments in audio, boxes/polygons in images, etc.), get them annotated by other people via a shared link, and know — while it's happening, not after — whether the annotations coming back are trustworthy.

Existing tools solve pieces of this (Label Studio: annotation UI; MTurk/Prolific: distribution) but not the combination of: fast experiment design + shareable-by-link deployment + **live** quality tracking via gold-standard items and inter-annotator overlap.

## 2. Goal (v1 scope — explicitly cut)
Build a system where a single designer can:
1. **Design** an annotation experiment: choose modality, define a label schema, upload a dataset, mark some items as gold-standard (with known correct answers), and set an overlap ratio (how many independent annotators see the same item).
2. **Deploy** the experiment as a single shareable link.
3. **Share** that link with anyone — no login required, just enough session identity to prevent trivial double-submission and to attribute scores per person.
4. **Track** the experiment live: per-annotator accuracy against gold items, per-item agreement across overlapping annotators, and overall completion.


## 3. Users
- **Designer**: the person creating and monitoring the experiment (could be a solo researcher, or an enterprise user — same flow either way in v1, since there's no auth differentiation yet).
- **Annotator**: anyone with the share link. Anonymous, identified only by a session token.

## 4. Core user flows

### 4.1 Design an experiment
- Designer creates an Experiment: name, modality (audio for v1), instructions text.
- Designer defines a label schema: the label set and annotation type (e.g. "point mark" or "segment/region"), plus cardinality rules (e.g. "0 or more segments per item").
- Designer uploads a dataset (batch of audio files).
- Designer marks a subset of items as "gold": provides the correct answer for that item. These are used for accuracy scoring and are NOT visually distinguished from regular items to the annotator.
- Designer sets `overlap_n` (how many distinct annotators must annotate each non-gold item) and `gold_ratio` (fraction of items in each annotator's queue that are gold, interleaved rather than front-loaded).

### 4.2 Deploy & share
- Designer clicks "Deploy" → system generates a unique share link (`/annotate/{share_token}`).
- Designer copies/shares this link by any channel (email, social, Slack — out of scope to build in-app sharing beyond generating the link).

### 4.3 Annotate (annotator flow)
- Annotator opens the share link. No login. A session token is created and persisted (cookie) on first visit.
- Annotator sees instructions, then is served the next unannotated item from their assigned queue (gold items interleaved).
- Annotator uses the modality-specific tool (e.g. waveform + click/drag to mark point/segment, pick a label) and submits.
- Repeats until their queue is exhausted or they stop.

### 4.4 Track (designer dashboard)
- Live-updating (poll-based) dashboard per experiment showing:
  - Completion %, items remaining, total annotators active.
  - Per-annotator: rolling accuracy vs. gold items, items completed.
  - Per-item: agreement score once `overlap_n` annotations are in.
  - A simple flag/highlight for annotators whose rolling accuracy has dropped below a threshold — visible, not automated.
- Designer can manually pause/remove an annotator from the pool (their session stops receiving new items).

### 4.5 Export
- Designer exports a "data pack": raw data + final annotations + per-item confidence/agreement + provenance (annotator id, timestamp), in a standard format (JSON/JSONL to start).

## 5. Success criteria for v1
- A designer can go from "I have a folder of audio files" to "I have a live shareable link with a working annotation tool" in one sitting, without needing engineering help per-experiment.
- Gold-item accuracy and overlap agreement scores update within seconds of a relevant submission (not batch/overnight).
- At least one full experiment can be run end-to-end (design → deploy → share → 3+ real annotators → export) as the acceptance test for this version.

## 6. Key risks / open questions
- **Scoring correctness**: Cohen's/Fleiss' kappa (categorical) and IoU (spatial/temporal overlap) must be correctly implemented — this is the differentiated, hardest part of the product and the most likely source of subtle bugs.
- **Cold start on agreement**: with few annotators, overlap-based agreement is statistically noisy. v1 should surface confidence/N alongside any agreement score rather than implying false precision.
- **Ambiguous gold items**: some gold "correct" answers may be genuinely disputable (e.g. audio segment boundary ±200ms). No dispute/appeals flow in v1 — accepted risk, revisit once real usage surfaces this.
- **Modality choice for v1**: audio first (waveform region/point marking via wavesurfer.js). Image as second modality only after audio flow is fully working end-to-end.
