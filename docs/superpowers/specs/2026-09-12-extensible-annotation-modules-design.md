# Extensible Annotation Modules Design

## Purpose

Turn the current registry-shaped annotation system into a true inherited module
framework. Backend and frontend annotation modules must inherit common lifecycle
behavior, override narrow task-specific hooks, and remain discoverable through
registries. Adding a type that uses an existing media interaction must not require
changes to API routes, allocation, dashboards, review coordination, export, or the
experiment wizard.

## Current state

The backend `AnnotationTypeSpec` is a structural `Protocol`. It documents required
methods but supplies no implementation, runtime registration checks, schema
versioning, or typed relationship between configuration and answers.

The frontend `AnnotationPlugin` is a plain-object interface. It provides useful
registry dispatch, but the shared `LabelSchema`, `AnnotationAnswer`, and
`MediaInteraction` types encode only categorical and simple temporal-region tasks.
`CreateExperiment.tsx` owns label and multi-select configuration, preventing an
annotation module from owning its complete lifecycle.

The PostgreSQL model is not the limiting factor: experiment schemas and answers
already use JSONB. Existing API dispatch through registries, modality capability
matching, allocation, storage, authentication, and export remain valid.

## Architectural principles

1. The base owns the process; children provide decisions through protected hooks.
2. Stored schema and answer objects are strict, discriminated, and versioned.
3. Annotation modules never branch on media modality.
4. Media renderers never branch on annotation type.
5. A media interaction is the stable protocol between those module families.
6. Existing categorical and segment schemas remain valid without data migration.
7. A new type using an existing interaction changes only its child modules,
   registration, and tests.
8. A genuinely new physical interaction requires a one-time addition to the media
   interaction protocol and each modality that claims to render it.

## Backend module framework

Add an abstract generic `BaseAnnotationType[ConfigT, AnswerT]` while retaining an
`AnnotationTypeSpec` protocol for registry/static typing.

The base class owns these public lifecycle operations:

- `validate_config(raw)` parses the child config model, normalizes it, and emits a
  JSON-serializable versioned schema.
- `validate_answer(raw, config)` parses config and answer models, calls the child
  semantic-validation hook, and emits normalized JSON.
- `validate_gold_answer(raw, config)` uses the same answer contract as normal
  submissions.
- `gold_match(answer, gold, config)` parses both sides, invokes `score_pair`, and
  enforces a finite result in `[0, 1]`.
- `agreement(answers, config)` validates every answer and averages all unique
  pairwise `score_pair` results.
- `catalog_entry()` produces the API registry descriptor consistently.

Children provide:

- stable `key`, display `name`, `schema_version`, and `required_interaction`;
- Pydantic `config_model` and `answer_model`;
- optional `_validate_semantics(answer, config)`;
- required `score_pair(left, right, config)`.

Family bases provide reusable decisions:

```text
BaseAnnotationType
├── ChoiceAnnotationBase
├── TextAnnotationBase
├── TemporalCollectionAnnotationBase
└── SpatialCollectionAnnotationBase
```

Registrations accept only `BaseAnnotationType` instances, reject duplicate keys,
and run a contract self-check at import/test time. Public lifecycle methods are
marked `@final`; child classes override only documented hooks.

Pure scoring utilities remain separate from lifecycle classes:

```text
backend/annotation_types/scoring/
├── collections.py   # pairwise averages and greedy labeled matching
├── text.py          # word tokenization, edit distance, WER similarity
├── temporal.py      # temporal IoU and cluster-aware matching
└── geometry.py      # normalized geometry and spatial similarity
```

## Frontend module framework

Add an abstract generic `BaseAnnotationModule<SchemaT, AnswerT>`. This is a module
class, not React component inheritance. React controls remain ordinary functional
components supplied by the module.

The base module owns shared methods for catalog identity checks, gold envelope
creation, common validation error formatting, read-only interaction creation,
and safe conversion at the registry boundary. Children supply:

- `defaultSchema(context)`, where context contains interaction capabilities and
  defaults supplied by the selected media plugin rather than a modality name;
- `ConfigurationEditor`;
- `Control`;
- `AnswerView`;
- `createInitialAnswer(schema)`;
- `createInteraction(schema, answer, onChange)`;
- `isComplete(schema, answer)`;
- annotation-specific client validation.

Replace optional-field containers with discriminated unions:

```text
AnnotationSchema = Categorical | SegmentV1 | Text | LabeledTemporal | Spatial
AnnotationAnswer = Categorical | SegmentV1 | Text | LabeledTemporal | Spatial
MediaInteraction = None | TemporalRegions | LabeledTemporalRegions | SpatialShapes
```

The frontend registry accepts only base-module instances and rejects duplicate
keys. A shared contract test runs against every registered module.

`CreateExperiment` stores the selected module's schema as a single state object
and renders its `ConfigurationEditor`. It does not own `labels`, `multiSelect`, or
type-specific validity rules. Dataset gold validation receives the complete schema
and delegates to the module.

`Annotator`, review, and dataset preview resolve module behavior through the
registry. Read-only overlays use the same interaction data without mutation
callbacks.

## Interaction families and answer contracts

### Existing compatibility contracts

Existing categorical schemas and answers remain unchanged. Existing segment v1
answers remain `{label, regions: [{start, end}]}` and continue using the current
plugin key `segment`.

Both legacy config models accept missing `schema_version` as version 1. Existing
stored records are read without a bulk migration.

### Text/transcription

Schema key: `transcription`.

```json
{
  "annotation_type": "transcription",
  "schema_version": 1,
  "case_sensitive": false,
  "collapse_whitespace": true,
  "strip_punctuation": false,
  "minimum_length": 1
}
```

Answer: `{ "text": "spoken words" }`.

Scoring uses `1 - min(1, word_edit_distance / max(reference_word_count,
hypothesis_word_count, 1))` after configured normalization. Agreement uses the
same pair metric.

### Labeled temporal collections

Shared answer:

```json
{
  "regions": [
    { "start": 0.5, "end": 2.1, "label": "Speaker 1" }
  ]
}
```

Task children:

- `speaker_diarization` — cluster labels may differ between annotators; scoring
  aligns speaker clusters before temporal IoU aggregation.
- `speaker_identification` — configured known identities require exact label
  matching plus temporal IoU.
- `sound_event` — configured event label plus temporal IoU.
- `speech_segmentation` — speech/silence label plus temporal IoU.
- `video_event` — event label plus temporal IoU.
- `action_recognition` — action label plus temporal IoU.

The existing global-label `segment` remains available for backward compatibility;
new tasks use independently labeled regions.

### Spatial collections

Coordinates are finite normalized values in `[0, 1]`, independent of rendered
resolution. Every shape has a stable client-generated ID and configured label.
Video shapes additionally carry non-negative `time` seconds.

Core task keys and payload collections:

- `bounding_box`: `{boxes: [{id, label, x, y, width, height, time?}]}`
- `polygon`: `{polygons: [{id, label, points: [{x, y}], time?}]}`
- `polyline`: `{polylines: [{id, label, points: [{x, y}], time?}]}`
- `ellipse`: `{ellipses: [{id, label, cx, cy, rx, ry, time?}]}`
- `keypoint`: `{points: [{id, label, name, x, y, time?}]}`

Spatial schemas include `frame_aware`, label choices, minimum geometry rules, and
comparison thresholds. Media plugins publish interaction defaults: video publishes
`frame_aware=true` for `spatial-shapes`, while image publishes false. The wizard
passes those opaque capability defaults to `defaultSchema(context)`; neither the
wizard nor annotation module branches on a modality key.

Scoring:

- bounding boxes: greedy label-matched IoU;
- polygons: label-matched polygon IoU;
- polylines: label-matched symmetric point-to-segment distance converted to a
  thresholded `[0, 1]` similarity;
- ellipses: label-matched overlap approximation with a documented resolution;
- keypoints: matching name and label followed by normalized-distance similarity;
- frame-aware shapes: candidates must fall within the configured time tolerance
  before spatial comparison.

Polygon validity rejects fewer than three unique vertices and self-intersections.
Polyline validity requires two unique vertices. Boxes and ellipses require positive
dimensions contained within normalized bounds.

## Media modules

Add an image media plugin accepting browser-decodable image formats. Its annotation
renderer uses an SVG overlay aligned to `object-fit: contain`; pointer coordinates
are converted through the displayed image content rectangle, not the surrounding
container. The renderer supports selection, creation, deletion, and editing for
the five core spatial primitives.

Video reuses the spatial tool layer, records the paused/current playback time on
new shapes, and shows only shapes within the configured time tolerance. This is
frame-aware annotation, not tracking: there are no persistent track IDs or
interpolation in this scope.

Audio and video gain labeled-temporal rendering. Region labels and colors are part
of the interaction payload; answer semantics remain owned by annotation modules.

## API and storage

No relational schema change is required. `label_schema` and annotation `answer`
remain JSONB.

The annotation-type catalog adds `schema_version` and `configuration_kind` while
retaining `supports_choices` and `supports_multi_select` during a compatibility
period. API routes continue resolving modules by `label_schema.annotation_type`.

Schema changes are locked after collection begins, as they are today. Export
continues emitting raw normalized schemas and answers, preserving provenance.

## Error handling

- Registry startup fails on duplicate keys or invalid module declarations.
- Unknown schema versions fail with an explicit compatibility error.
- Invalid geometry reports the collection index and offending field.
- Non-finite coordinates, times, and scores are rejected.
- Unsupported annotation/modality pairs are rejected by backend capability checks
  and disabled in the frontend catalog.
- A renderer error affects the current item and produces a clear unsupported-tool
  state; it does not corrupt the answer or advance allocation.

## Testing strategy

Use red-green-refactor for every behavior.

- Base contract tests run against all backend and frontend registrations.
- Existing categorical/segment fixtures prove byte-for-byte normalized answer
  compatibility before and after migration.
- Pure scorer tests cover identity, disagreement, unmatched entities, invalid
  shapes, label mismatch, time mismatch, and score bounds.
- Frontend reducer/coordinate tests avoid relying solely on fragile browser pointer
  simulations.
- Integration tests cover creation, gold upload, two annotators, gold accuracy,
  agreement, review, and export for one text, labeled-temporal, image-spatial, and
  frame-aware video-spatial experiment.
- Production builds and the complete existing suite remain required gates.

## Explicitly deferred large subsystems

These are separate products/subsystems, not ordinary child annotation modules:

- raster masks and brush tooling — binary mask object storage, compositing, and
  versioned raster assets;
- skeletons — graph topology, constrained joint editing, and pose metrics;
- projected cuboids — perspective controls, hidden corners, and projected 3D
  scoring;
- OCR composition — linked geometry plus transcription and compound scoring;
- region attributes — references between primary annotations and attribute maps;
- video tracks — persistent identities, keyframes, interpolation, occlusion, and
  drift correction;
- multi-camera re-identification — synchronized multi-stream workspace and global
  identity graph;
- DICOM/whole-slide/multispectral imagery — tiled/specialized viewers, medical or
  spectral metadata, and additional compliance constraints;
- LiDAR/3D — WebGL point-cloud engine, spatial indexing, camera/projection tools,
  binary point-label storage, and asynchronous large-payload processing.

The new base framework is designed so these systems can later register modules,
but their media engines and storage models require independent designs.

## Success criteria

1. Categorical and segment experiments behave exactly as before.
2. Every annotation implementation inherits the backend and frontend base module.
3. Shared coordinators contain no concrete annotation-type branches.
4. Adding a task within uses an existing interaction requires only child modules,
   registry entries, and tests.
5. Text, labeled-temporal, five image spatial tasks, and frame-aware video spatial
   tasks work through creation, annotation, gold scoring, agreement, review, and
   export.
6. Deferred large systems are documented and are not represented by misleading
   partial implementations.
