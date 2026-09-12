# Extensible Annotation Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow structural plugin contracts with inherited backend and frontend annotation modules, then add production-ready transcription, labeled-temporal, image-spatial, and frame-aware video-spatial tasks without adding concrete annotation branches to shared workflows.

**Architecture:** Introduce generic base modules that own validation, gold scoring, agreement iteration, catalog metadata, and frontend lifecycle defaults. Child modules override narrow configuration, UI, interaction, and pair-scoring hooks. Registries remain the only lookup mechanism, while discriminated media interactions isolate annotation semantics from audio/image/video rendering.

**Tech Stack:** Python 3.11+, Pydantic 2, FastAPI, SQLAlchemy JSONB, React 18, TypeScript 5, SVG pointer interactions, Vitest, unittest, Shapely 2.x for robust polygon geometry.

**Spec:** `docs/superpowers/specs/2026-09-12-extensible-annotation-modules-design.md`

## Global Constraints

- Existing `categorical` and `segment` schemas and answer payloads remain valid.
- The base owns public lifecycle operations; children override protected strategy hooks.
- Shared API routes and page coordinators must not branch on concrete annotation keys.
- Annotation modules never branch on media modality; media modules never branch on annotation type.
- All stored schemas include `schema_version`; a missing version on legacy data means version 1.
- Frontend schema and answer types use module-augmented open type maps, not a central closed union.
- Gold scoring and agreement aggregation have separate protected strategy hooks.
- Modalities are advertised as compatible only when their implementation is available.
- Normal and gold answers use the same strict answer model.
- Every score must be finite and inside `[0, 1]`.
- Normalized image coordinates remain inside `[0, 1]`; video time is non-negative seconds.
- Large deferred systems listed in the spec must not receive partial placeholder implementations.

## Why this sequence

The work uses a strangler migration. The new bases are introduced beside the current
contracts, existing types move onto them with compatibility tests, and only then do
new answer families arrive. This avoids simultaneously changing architecture and
behavior, and it provides a known-good reference implementation for every later
child.

## Risk register

| Risk | Effect | Mitigation and verification |
| --- | --- | --- |
| Existing JSON schemas have no version | Old experiments could fail validation | Treat missing version as v1 and run API fixtures created before the refactor |
| A child overrides a public lifecycle method | Base fixes would not propagate | Mark Python lifecycle methods `@final`, reject forbidden overrides in `__init_subclass__`, and contract-test registrations |
| TypeScript generic types are erased in a heterogeneous registry | Unsafe casts could spread into screens | Keep one checked erasure boundary in the registry; expose typed child methods internally and test every registered module |
| Builder currently owns categorical state | New configuration editors could leave stale schema/gold data | Replace it atomically with module-owned schema state and reset bundle/preview state when type changes |
| SVG coordinates differ from media content bounds | Saved geometry can drift on resize or letterboxing | Centralize client-to-normalized conversion and unit-test portrait/landscape containment calculations |
| Arbitrary polygon intersection is numerically difficult | Incorrect gold/agreement scores | Use Shapely, reject invalid/self-intersecting polygons, and test concave/disjoint/edge-touching cases |
| Many shapes make pairwise matching expensive | Submission latency increases | Enforce configurable `max_shapes` (default 500), use greedy candidate sorting, and record a future spatial-index threshold |
| Diarization labels are arbitrary cluster names | Exact label comparison falsely penalizes agreement | Align speaker clusters by maximum temporal overlap before scoring; document that this is not a full DER implementation |
| Video timestamps are not exact frame indices | Variable-frame-rate media can shift overlays | Store seconds, pause before drawing, use configurable tolerance, and explicitly defer frame-accurate transcoding/indexing |
| Review overlays from many annotators become unreadable | Designer cannot inspect results | Render one selectable answer overlay at a time, with gold as a separate selectable overlay |
| Shapely wheels are unavailable on a deployment target | Backend installation fails | Pin `shapely>=2,<3`, verify lock/install in CI, and document supported Python/platform images |

---

### Task 1: Introduce the inherited backend lifecycle

**Files:**
- Create: `backend/annotation_types/base_type.py`
- Create: `backend/annotation_types/scoring/collections.py`
- Create: `backend/tests/test_annotation_base.py`
- Modify: `backend/annotation_types/base.py`
- Modify: `backend/annotation_types/__init__.py`
- Modify: `backend/main.py`
- Modify: `backend/schemas.py`

**Interfaces:**
- Produces: `BaseAnnotationType[ConfigT, AnswerT]`
- Produces: `average_pairwise(values, scorer) -> float`
- Produces: `register_type(module)`, `get_type(key)`, `list_types()`
- Preserves: the existing `AnnotationTypeSpec` registry-facing protocol

- [ ] **Step 1: Write a failing lifecycle contract test**

Create strict dummy config/answer models and assert that a child implementing only
`score_pair` inherits config validation, answer validation, gold matching, pairwise
agreement, score-bound enforcement, and catalog serialization:

```python
class DummyType(BaseAnnotationType[DummyConfig, DummyAnswer]):
    key = "dummy"
    name = "Dummy"
    schema_version = 1
    required_interaction = "none"
    config_model = DummyConfig
    answer_model = DummyAnswer

    def score_pair(self, left, right, config):
        return 1.0 if left.value == right.value else 0.0

self.assertEqual(DummyType().agreement(
    [{"value": "a"}, {"value": "a"}, {"value": "b"}],
    {"annotation_type": "dummy", "schema_version": 1},
), 1 / 3)
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd backend && UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest tests.test_annotation_base -v`

Expected: import failure for `BaseAnnotationType`.

- [ ] **Step 3: Implement the minimal generic base**

Implement concrete `validate_config`, `validate_answer`, `validate_gold_answer`,
`gold_match`, `agreement`, `catalog_entry`, and `_checked_score`. Make `_score_pair`
abstract; provide separate `_score_gold` and `_aggregate_agreement` defaults plus
stepwise `_upgrade_config`; make `_validate_semantics` a no-op protected hook. Reject subclasses that
define public lifecycle names in their own `__dict__`.

- [ ] **Step 4: Add registry failure tests**

Assert duplicate keys, non-base instances, blank keys, unknown interactions, and
non-finite/out-of-range scores fail with explicit errors.

- [ ] **Step 5: Run the focused backend tests and verify GREEN**

Run: `cd backend && UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest tests.test_annotation_base -v`

Expected: all lifecycle and registry tests pass.

- [ ] **Step 6: Commit the backend foundation**

```bash
git add backend/annotation_types backend/tests/test_annotation_base.py
git commit -m "refactor: add inherited backend annotation lifecycle"
```

### Task 2: Migrate categorical and segment without changing stored behavior

**Files:**
- Modify: `backend/annotation_types/categorical.py`
- Modify: `backend/annotation_types/segment.py`
- Modify: `backend/annotation_types/__init__.py`
- Modify: `backend/tests/test_annotation_types.py`
- Modify: `backend/tests/test_api_integration.py`
- Modify: `backend/schema_compat.py`

**Interfaces:**
- Consumes: `BaseAnnotationType`
- Produces: inherited `CategoricalType` and `SegmentType`
- Preserves: categorical `{value}` / `{values}` and segment `{label, regions}`

- [ ] **Step 1: Add failing legacy compatibility assertions**

Assert both missing and explicit `schema_version: 1` configs validate; normalized
answers remain byte-for-byte equal to current fixtures; API creation/session/export
still use keys `categorical` and `segment`.

- [ ] **Step 2: Run compatibility tests and verify RED**

Run: `cd backend && UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest tests.test_annotation_types.LegacySchemaTests -v`

Expected: explicit schema-version inputs fail because current config models forbid
the field.

- [ ] **Step 3: Convert existing types into children**

Make both classes inherit their typed base. Move configured-choice membership into
`_validate_semantics` and reduce each scorer to `score_pair`. Preserve the existing
Jaccard and temporal-IoU algorithms as pure helpers.

- [ ] **Step 4: Verify old and new configs**

Run the complete backend unit suite. Then run the database-backed integration suite
and confirm existing dashboard, gold, agreement, review, and export assertions.

- [ ] **Step 5: Commit the compatibility migration**

```bash
git add backend/annotation_types backend/tests
git commit -m "refactor: migrate existing annotations to backend base"
```

### Task 3: Introduce the inherited frontend module and discriminated contracts

**Files:**
- Create: `frontend/src/plugins/annotations/BaseAnnotationModule.ts`
- Create: `frontend/src/plugins/annotations/moduleContract.test.ts`
- Modify: `frontend/src/components/annotator/types.ts`
- Modify: `frontend/src/plugins/contracts.ts`
- Modify: `frontend/src/plugins/annotations/registry.ts`

**Interfaces:**
- Produces: `BaseAnnotationModule<SchemaT, AnswerT>` and `AnnotationModuleContext`
- Produces: module-augmented `AnnotationSchemaMap` and `AnnotationAnswerMap`
- Produces: checked `registerAnnotationModule` and `getAnnotationModule`
- Produces: `ConfigurationEditorProps`, `ReadonlyMediaInteraction`

- [ ] **Step 1: Write a failing frontend module-contract test**

Create a dummy child class and assert inherited gold-envelope creation, catalog
identity, duplicate-key rejection, initial-answer validation, and readonly
interaction defaults. Assert every registry value is an instance of the base.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `cd frontend && npm test -- src/plugins/annotations/moduleContract.test.ts`

Expected: import failure for `BaseAnnotationModule`.

- [ ] **Step 3: Define discriminated types**

Add `annotation_type` and `schema_version` discriminants to each schema. Define
open interfaces that child modules augment locally and derive the schema/answer
unions from their values. Define separate answers rather than one object with
unrelated optional fields. Extend
`MediaInteraction` with readonly-safe callback omission, but do not add spatial
behavior in this task. `AnnotationModuleContext` carries media interaction defaults
without exposing a modality key to annotation modules.

- [ ] **Step 4: Implement the abstract module and checked registry**

The class provides shared gold envelope/copy/error helpers. Abstract properties hold
functional React component references; React components themselves do not inherit.
Keep the unavoidable heterogeneous-registry cast private to `registry.ts`.

- [ ] **Step 5: Run module and TypeScript checks and verify GREEN**

Run: `cd frontend && npm test -- src/plugins/annotations/moduleContract.test.ts`

Run: `cd frontend && npm run build`

- [ ] **Step 6: Commit the frontend foundation**

```bash
git add frontend/src/plugins frontend/src/components/annotator/types.ts
git commit -m "refactor: add inherited frontend annotation modules"
```

### Task 4: Move existing frontend tasks and configuration into modules

**Files:**
- Create: `frontend/src/plugins/annotations/config/ChoiceConfiguration.tsx`
- Modify: `frontend/src/plugins/annotations/categorical.tsx`
- Modify: `frontend/src/plugins/annotations/segment.tsx`
- Modify: `frontend/src/components/CreateExperiment.tsx`
- Modify: `frontend/src/components/datasetBundle.ts`
- Modify: `frontend/src/components/annotator/AnnotationControl.tsx`
- Modify: `frontend/src/components/Annotator.tsx`
- Modify: `frontend/src/components/datasetBundle.test.ts`
- Modify: `frontend/src/plugins/registry.test.ts`

**Interfaces:**
- Consumes: `BaseAnnotationModule`
- Produces: module-owned `defaultSchema`, `ConfigurationEditor`, and schema validity
- Preserves: current categorical and segment authoring/annotation behavior

- [ ] **Step 1: Write failing module-ownership tests**

Assert categorical defaults contain three labels and multi-select false; segment
defaults contain labels and segment v1; module configuration rendering includes the
label editor; dataset validation accepts the full schema rather than
`{annotationType, labels, multiSelect}`.

- [ ] **Step 2: Run frontend tests and verify RED**

Expected: tests fail because the wizard still creates schema fields directly.

- [ ] **Step 3: Convert categorical and segment to child classes**

Move choice configuration, defaults, completion, gold examples, controls, answer
views, and interaction creation behind inherited module instances.

- [ ] **Step 4: Refactor `CreateExperiment` to one schema state**

Replace `annotationType`, `labels`, and `multiSelect` state with:

```ts
const [schema, setSchema] = useState<AnnotationSchema>(
  getAnnotationModule("categorical").defaultSchema(mediaPlugin.moduleContext),
);
```

Render `module.ConfigurationEditor`; use `module.isSchemaComplete(schema)` for step
navigation; send `schema` unchanged to experiment creation; clear preview and bundle
state whenever the module key changes. Media plugins expose `moduleContext` with
defaults keyed by interaction, so this coordinator never checks for image or video.

- [ ] **Step 5: Remove concrete schema assumptions from dataset and annotator coordinators**

Pass the full schema to module validation and use `createInitialAnswer(schema)` when
loading each item. Confirm no `categorical`, `segment`, `choices`, or `multi_select`
branch remains in shared coordinators.

- [ ] **Step 6: Run all frontend tests and production build**

Run: `cd frontend && npm test`

Run: `cd frontend && npm run build`

- [ ] **Step 7: Commit the frontend migration**

```bash
git add frontend/src
git commit -m "refactor: make annotation modules own frontend lifecycle"
```

### Task 5: Add transcription as the first new inherited family

**Files:**
- Create: `backend/annotation_types/scoring/text.py`
- Create: `backend/annotation_types/transcription.py`
- Create: `backend/tests/test_transcription_annotation.py`
- Create: `frontend/src/plugins/annotations/transcription.tsx`
- Create: `frontend/src/plugins/annotations/transcription.test.tsx`
- Modify: backend/frontend annotation registries

**Interfaces:**
- Produces schema: `TranscriptionConfig`
- Produces answer: `{text: string}`
- Produces score: normalized word-edit similarity

- [ ] **Step 1: Write failing backend text tests**

Assert whitespace normalization, optional case folding, optional punctuation
stripping, minimum length, extra-field rejection, known WER examples, symmetry, and
score bounds. Use `"hello brave world"` versus `"hello world"` to expect `2/3`.

- [ ] **Step 2: Verify backend RED, implement minimal scorer and child, verify GREEN**

Register `TranscriptionAnnotation`; rely on inherited answer/gold/agreement flow.

- [ ] **Step 3: Write failing frontend transcription tests**

Assert the configuration editor controls normalization fields, the textarea emits
`{text}`, blank normalized text is incomplete, and the gold example uses exactly the
normal answer shape.

- [ ] **Step 4: Implement the frontend child and verify GREEN**

Use interaction `none`; do not modify audio/video renderers.

- [ ] **Step 5: Run complete unit suites and commit**

```bash
git add backend/annotation_types backend/tests frontend/src/plugins
git commit -m "feat: add inherited transcription annotation"
```

### Task 6: Add independently labeled temporal collections and task children

**Files:**
- Create: `backend/annotation_types/scoring/temporal.py`
- Create: `backend/annotation_types/labeled_temporal.py`
- Create: `backend/annotation_types/temporal_tasks.py`
- Create: `backend/tests/test_labeled_temporal_annotations.py`
- Create: `frontend/src/plugins/annotations/LabeledTemporalModule.tsx`
- Create: `frontend/src/plugins/annotations/temporalTasks.ts`
- Create: `frontend/src/plugins/annotations/labeledTemporal.test.tsx`
- Modify: `frontend/src/plugins/contracts.ts`
- Modify: `frontend/src/components/annotator/AudioMediaRenderer.tsx`
- Modify: `frontend/src/components/annotator/VideoMediaRenderer.tsx`
- Modify: backend/frontend registries

**Interfaces:**
- Produces interaction: `labeled-temporal-regions`
- Produces answer: `{regions: Array<{start, end, label}>}`
- Produces children: diarization, speaker identification, sound event, speech
  segmentation, video event, and action recognition

- [ ] **Step 1: Write failing temporal validation/scoring tests**

Cover independent labels, overlap, unmatched regions, identity label mismatch,
speaker-cluster renaming, empty collections, and invalid boundaries. Assert
diarization scores identically when `Speaker 1/2` are consistently renamed `A/B`.

- [ ] **Step 2: Verify RED and implement backend family/children**

Put common region validation and labeled IoU matching in the family base. Override
only diarization cluster alignment; task children supply key, name, defaults, and
interaction compatibility.

- [ ] **Step 3: Write failing frontend interaction tests**

Assert changing one region label does not affect other regions, deleting a region
preserves the remainder, and each task child is compatible only with declared media.

- [ ] **Step 4: Implement labeled temporal interaction/rendering**

Audio waveform regions and video timeline entries display stable label colors. The
renderer edits geometry; the module control owns active label selection.

- [ ] **Step 5: Run all unit suites and commit**

```bash
git add backend/annotation_types backend/tests frontend/src
git commit -m "feat: add labeled temporal annotation family"
```

### Task 7: Build deterministic spatial geometry scoring

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock`
- Create: `backend/annotation_types/scoring/geometry.py`
- Create: `backend/tests/test_spatial_geometry.py`

**Interfaces:**
- Produces: `box_iou`, `polygon_iou`, `polyline_similarity`, `ellipse_iou`,
  `keypoint_similarity`, and `greedy_labeled_match`

- [ ] **Step 1: Add Shapely and lock dependencies**

Run: `cd backend && uv add 'shapely>=2,<3'`

- [ ] **Step 2: Write failing geometry tests**

Use exact fixtures for identical, partially overlapping, disjoint, edge-touching,
concave, self-intersecting, and out-of-range geometry. Test label mismatch,
unmatched-shape penalties, time tolerance, and finite score bounds.

- [ ] **Step 3: Verify RED and implement pure geometry functions**

Use Shapely for polygon validity/intersection and sampled ellipse polygons. Implement
point-to-segment distance for polylines and normalized Euclidean distance for
keypoints. Keep matching deterministic by stable index tie-breaking.

- [ ] **Step 4: Run geometry and complete backend unit tests**

Run: `cd backend && UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest tests.test_spatial_geometry -v`

- [ ] **Step 5: Commit scoring primitives**

```bash
git add backend/pyproject.toml backend/uv.lock backend/annotation_types/scoring backend/tests/test_spatial_geometry.py
git commit -m "feat: add spatial annotation scoring primitives"
```

### Task 8: Add inherited backend spatial annotation modules

**Files:**
- Create: `backend/annotation_types/spatial.py`
- Create: `backend/annotation_types/spatial_tasks.py`
- Create: `backend/tests/test_spatial_annotations.py`
- Modify: `backend/annotation_types/__init__.py`
- Modify: `backend/modalities.py`

**Interfaces:**
- Produces child keys: `bounding_box`, `polygon`, `polyline`, `ellipse`, `keypoint`
- Produces strict normalized spatial answer models
- Consumes: geometry scorers from Task 7

- [ ] **Step 1: Write failing strict-model tests**

For every shape, test a valid answer, extra fields, blank/unknown labels, duplicate
IDs, collection size limit, invalid points/dimensions, and optional video time.

- [ ] **Step 2: Verify RED and implement the spatial family base**

The family validates labels, IDs, bounds, `max_shapes`, `frame_aware`, and time
presence. Each child selects its collection model and scoring strategy.

- [ ] **Step 3: Add capability contract tests**

Assert all five keys resolve for image and video through `spatial-shapes`, and none
resolve for audio. Remove misleading reserved capabilities only if no registered
module can consume them.

- [ ] **Step 4: Run backend suites and commit**

```bash
git add backend/annotation_types backend/modalities.py backend/tests
git commit -m "feat: add inherited spatial annotation modules"
```

### Task 9: Build the shared frontend spatial engine

**Files:**
- Create: `frontend/src/plugins/spatial/types.ts`
- Create: `frontend/src/plugins/spatial/coordinates.ts`
- Create: `frontend/src/plugins/spatial/reducer.ts`
- Create: `frontend/src/plugins/spatial/SpatialOverlay.tsx`
- Create: `frontend/src/plugins/spatial/coordinates.test.ts`
- Create: `frontend/src/plugins/spatial/reducer.test.ts`
- Modify: `frontend/src/plugins/contracts.ts`

**Interfaces:**
- Produces interaction: `spatial-shapes`
- Produces: `mediaPointFromClient`, immutable spatial reducer, editable/read-only SVG
  overlay

- [ ] **Step 1: Write failing coordinate tests**

Assert conversion through a letterboxed content rectangle for square, portrait, and
landscape media; clamp edge points; reject clicks outside displayed media.

- [ ] **Step 2: Write failing reducer tests**

Assert create/update/delete/select operations are immutable; IDs remain stable;
polygon completion requires three unique points; undo removes only the latest draft
point; readonly mode emits no changes.

- [ ] **Step 3: Verify RED and implement coordinate/reducer functions**

Keep all pointer math out of React components. Add the discriminated interaction
variant only after the pure tests define its payload.

- [ ] **Step 4: Implement `SpatialOverlay`**

Render SVG geometry from normalized coordinates. Support drag boxes/ellipses,
click-to-add polygons/polylines, click keypoints, selection, handles, Escape cancel,
Delete removal, and read-only mode.

- [ ] **Step 5: Run frontend tests/build and commit**

```bash
git add frontend/src/plugins
git commit -m "feat: add shared spatial interaction engine"
```

### Task 10: Add image modality and spatial frontend child modules

**Files:**
- Create: `frontend/src/components/annotator/ImageMediaRenderer.tsx`
- Create: `frontend/src/plugins/media/image.tsx`
- Create: `frontend/src/plugins/annotations/SpatialAnnotationModule.tsx`
- Create: `frontend/src/plugins/annotations/spatialTasks.ts`
- Create: `frontend/src/plugins/annotations/spatialTasks.test.tsx`
- Modify: frontend media and annotation registries
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces: image plugin supporting `none` and `spatial-shapes`, with spatial
  interaction default `frame_aware=false`
- Produces: five frontend child modules matching Task 8 keys

- [ ] **Step 1: Write failing registry/configuration tests**

Assert image accepts PNG/JPEG/WebP, supports categorical and all five spatial tasks,
rejects temporal tasks, supplies an image gold filename, and each spatial module owns
label/max-shape/tolerance configuration.

- [ ] **Step 2: Verify RED and implement image plugin/renderer**

Load intrinsic dimensions, calculate the contained content rectangle, and mount the
shared overlay. Surface decode failures without mutating the answer.

- [ ] **Step 3: Implement spatial child modules**

Each child supplies defaults, collection-specific gold examples, completion rules,
answer summaries, and its overlay tool descriptor. Do not change shared screens.

- [ ] **Step 4: Run frontend suites/build and commit**

```bash
git add frontend/src
git commit -m "feat: add image spatial annotation modules"
```

### Task 11: Add frame-aware video spatial annotation

**Files:**
- Create: `frontend/src/plugins/spatial/videoTime.ts`
- Create: `frontend/src/plugins/spatial/videoTime.test.ts`
- Modify: `frontend/src/components/annotator/VideoMediaRenderer.tsx`
- Modify: `frontend/src/plugins/media/video.tsx`
- Modify: `frontend/src/plugins/annotations/SpatialAnnotationModule.tsx`
- Modify: `backend/tests/test_spatial_annotations.py`

**Interfaces:**
- Consumes: `spatial-shapes`
- Produces: timestamped shapes and tolerance-based visible-shape filtering

- [ ] **Step 1: Write failing timestamp/filter tests**

Assert a new shape receives current time, drawing is disabled while playback moves,
only shapes within tolerance are visible, and image answers reject unexpected time
while frame-aware video answers require it.

- [ ] **Step 2: Verify RED and implement video-time helpers**

Use seconds from `HTMLVideoElement.currentTime`; do not infer FPS. Publish
`frame_aware=true` in the video media plugin's spatial interaction defaults. Preserve
temporal region behavior when the interaction is not spatial.

- [ ] **Step 3: Add the shared overlay to video**

Position SVG over the contained video frame, pause before creation, and update visible
shapes on `timeupdate`/seek. Keep tracking IDs and interpolation out of scope.

- [ ] **Step 4: Run backend/frontend suites and commit**

```bash
git add frontend/src backend/tests/test_spatial_annotations.py
git commit -m "feat: add frame-aware video spatial annotations"
```

### Task 12: Add read-only overlays to dataset preview and review

**Files:**
- Modify: `frontend/src/plugins/contracts.ts`
- Modify: `frontend/src/components/CreateExperiment.tsx`
- Modify: `frontend/src/components/ReviewAnnotations.tsx`
- Modify: `frontend/src/components/ExperimentAnnotators.tsx`
- Create: `frontend/src/components/AnnotationOverlaySelector.tsx`
- Create: `frontend/src/components/AnnotationOverlaySelector.test.tsx`

**Interfaces:**
- Consumes: `module.createReadonlyInteraction(schema, answer)`
- Produces: selectable gold/submission overlays without coordinator type branches

- [ ] **Step 1: Write failing overlay-selection tests**

Assert gold and each submitted answer are separate options, selection produces the
module's readonly interaction, missing plugins fall back to JSON, and changing the
selection never changes stored answers.

- [ ] **Step 2: Verify RED and implement selector**

Pass the complete experiment schema through review types. Render one selected
overlay at a time and retain existing textual `AnswerView` output.

- [ ] **Step 3: Integrate dataset gold preview and participant drill-down**

Use the same selector/read-only interaction path. No concrete shape or annotation
key may appear in these coordinator files.

- [ ] **Step 4: Run frontend suites/build and commit**

```bash
git add frontend/src
git commit -m "feat: render annotation overlays in review workflows"
```

### Task 13: End-to-end API coverage, documentation, and deferred-work report

**Files:**
- Modify: `backend/tests/test_api_integration.py`
- Modify: `ANNOTATION_EXTENSION_GUIDE.md`
- Modify: `TECH_DESIGN.md`
- Modify: `PRD.md`
- Modify: `project_summary.md`
- Create: `docs/DEFERRED_ANNOTATION_SYSTEMS.md`

**Interfaces:**
- Verifies: creation through export for every implemented family
- Documents: exact child-module recipe and explicitly deferred systems

- [ ] **Step 1: Add failing integration scenarios**

Add four complete experiments:

1. audio transcription with two answers and word similarity;
2. audio diarization with renamed speaker clusters;
3. image bounding boxes with gold IoU and agreement;
4. video timestamped polygons with time tolerance.

For each, assert config rejection, valid creation, gold manifest, two annotators,
normalized stored answers, gold score, agreement, review payload, and export payload.

- [ ] **Step 2: Run integration tests and close boundary failures**

Run the existing PostgreSQL/MinIO integration command. Fix only registry/framework
boundary defects; do not add concrete-type branches to API routes.

- [ ] **Step 3: Update developer and product documentation**

Document the base/child lifecycle, protected override hooks, complete schema examples,
interaction addition process, compatibility rules, test checklist, and supported
task matrix.

- [ ] **Step 4: Write the deferred-system report**

For masks, skeletons, cuboids, OCR composition, attributes, tracking, multi-camera,
specialized imagery, and LiDAR, record required renderer, storage, scoring, API,
operational, and test changes plus the reason each is not a normal child module.

- [ ] **Step 5: Run final verification**

Run:

```bash
cd backend
UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest discover -s tests -v
DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db RUN_INTEGRATION=1 UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest discover -s tests -v

cd ../frontend
npm test
npm run build

cd ..
git diff --check
```

Expected: every test passes, production build succeeds, and no whitespace errors
remain.

- [ ] **Step 6: Commit documentation and integration coverage**

```bash
git add backend/tests ANNOTATION_EXTENSION_GUIDE.md TECH_DESIGN.md PRD.md project_summary.md docs
git commit -m "docs: complete extensible annotation module rollout"
```

## Execution checkpoints

- **Checkpoint A — after Task 4:** Architecture is corrected and existing behavior
  is unchanged. Stop and review the base APIs before adding types.
- **Checkpoint B — after Task 6:** Audio and temporal expansion is complete. Validate
  real transcription and diarization workflows.
- **Checkpoint C — after Task 10:** Image spatial tools are complete. Manually test
  coordinate accuracy at several viewport sizes.
- **Checkpoint D — after Task 13:** Full core scope is complete and deferred systems
  have actionable reports.

## Expected main-code impact

The intentional shared-code changes are concentrated in Tasks 3–4 and 12. After
Checkpoint A, adding Tasks 5, 6, 8, and 10 should not require concrete-type changes
to `main.py`, `CreateExperiment.tsx`, `Annotator.tsx`, or review coordinators. Any
need to add such a branch is treated as a failed base abstraction and must stop the
task for design review.
