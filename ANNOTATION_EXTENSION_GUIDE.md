# Annotation and Modality Extension Guide

This guide describes the extension contract used by Annotate It. The design has
three independent layers:

1. an annotation module owns schema, answer validation, scoring, controls, and
   answer-to-interaction mapping;
2. a media plugin owns upload rules and rendering for a modality;
3. a typed interaction is the small protocol between them.

Shared API routes and screens resolve these pieces from registries. They must not
switch on concrete annotation keys or media keys.

## Supported matrix

| Family | Annotation keys | Audio | Video | Image | Interaction |
| --- | --- | ---: | ---: | ---: | --- |
| Categorical | `categorical` | Yes | Yes | Yes | `none` |
| Transcription | `transcription` | Yes | Yes | No | `none` + audio capability |
| Unlabeled temporal | `segment` | Yes | Yes | No | `temporal-regions` |
| Labeled temporal | `speaker_diarization`, `speaker_identification`, `sound_event`, `speech_segmentation` | Yes | Yes | No | `labeled-temporal-regions` + audio capability |
| Video temporal | `video_event`, `action_recognition` | No | Yes | No | `labeled-temporal-regions` + visual capability |
| Spatial | `bounding_box`, `polygon`, `polyline`, `ellipse`, `keypoint` | No | Yes | Yes | `spatial-shapes` + visual capability |

Text media and text-range interaction are reserved but unavailable. A modality
is advertised only when its frontend renderer is actually registered.

## Backend template lifecycle

All backend modules inherit
`backend/annotation_types/base_type.py::BaseAnnotationType[ConfigT, AnswerT]`.
The base class is the template used by API creation, gold ingestion, submission,
agreement, score rebuild, review, and export.

The base owns these final public operations:

- `validate_config`
- `validate_answer`
- `validate_gold_answer`
- `gold_match`
- `agreement`
- `catalog_entry`

A child cannot replace them. It declares metadata and implements protected hooks:

- required: `_score_pair(left, right, config)`;
- optional: `_validate_semantics(answer, config)`;
- optional: `_score_gold(answer, gold, config)` when gold differs from agreement;
- optional: `_aggregate_agreement(answers, config)` for a non-pairwise metric;
- optional: `_get_answer_model(config)` for configuration-dependent answers;
- optional: `_upgrade_config(raw, from_version)` for stored schema upgrades.

The base validates schema identity/version, runs strict Pydantic parsing, invokes
semantic validation, checks finite scores in `[0, 1]`, and averages pairwise
agreement by default. A change to this base lifecycle applies to every child.

Minimal backend child:

```py
from typing import Literal
from pydantic import BaseModel, ConfigDict
from annotation_types.base_type import BaseAnnotationType

class Config(BaseModel):
    model_config = ConfigDict(extra="forbid")
    annotation_type: Literal["my_type"]
    schema_version: Literal[1] = 1

class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: float

class MyType(BaseAnnotationType[Config, Answer]):
    key = "my_type"
    name = "My type"
    schema_version = 1
    required_interaction = "none"
    config_model = Config
    answer_model = Answer

    def _score_pair(self, left, right, config):
        return max(0.0, 1.0 - abs(left.value - right.value))
```

Register its class in `backend/annotation_types/__init__.py`. Declare
`required_media_capabilities` when an interaction alone is insufficient; for
example transcription requires `audio-content`, while spatial children require
`visual-content`.

### Backend answer examples

Categorical single and multiple choice:

```json
{ "value": "Good" }
```

```json
{ "values": ["Good", "Noisy"] }
```

Transcription and labeled temporal regions:

```json
{ "text": "Expected transcript" }
```

```json
{
  "regions": [
    { "start": 0.5, "end": 2.75, "label": "Speech" }
  ]
}
```

Image bounding box:

```json
{
  "boxes": [
    {
      "id": "box-1",
      "label": "Car",
      "x": 0.1,
      "y": 0.2,
      "width": 0.3,
      "height": 0.4
    }
  ]
}
```

Video polygon uses the same normalized geometry plus seconds:

```json
{
  "polygons": [
    {
      "id": "polygon-1",
      "label": "Person",
      "time": 1.25,
      "points": [
        { "x": 0.1, "y": 0.1 },
        { "x": 0.7, "y": 0.1 },
        { "x": 0.4, "y": 0.7 }
      ]
    }
  ]
}
```

Coordinates are normalized to `[0, 1]`. Shape IDs are stable and unique within
an answer. `time` is required when `frame_aware=true` and forbidden otherwise.

## Frontend template lifecycle

All frontend annotation modules inherit
`frontend/src/plugins/annotations/BaseAnnotationModule.ts`. A child supplies:

- stable `key`, `name`, `schemaVersion`, and `requiredInteraction`;
- `ConfigurationEditor`, `Control`, and `AnswerView` components;
- `defaultSchema`, `createInitialAnswer`, and `createInteraction`;
- `isComplete`, `validateAnswer`, and `createGoldExample`.

The base owns answer preparation, shared gold validation/envelopes, validation
formatting, and read-only interactions. `createInitialAnswer` must declare every
top-level answer field. The base uses that shape to discard stale fields and
replace missing or incompatible values before controls, completeness checks, or
media interactions run. Registry registration freezes modules and rejects child
attempts to replace those lifecycle methods. Optional `schemaForContext` adapts
a schema to modality-owned defaults; the spatial family uses it for timeless
images and frame-aware video without a coordinator branch.

Use TypeScript module augmentation so new schemas and answers join the open maps
in `components/annotator/types.ts`. A family base should implement shared UI and
mapping once; its children should normally declare only key, name, defaults,
collection field, and tool.

The spatial family demonstrates the intended pattern:

```ts
class BoundingBoxModule extends SpatialAnnotationModule<"bounding_box"> {
  readonly key = "bounding_box" as const;
  readonly name = "Bounding boxes";
  readonly tool = "bounding_box" as const;
  readonly collectionField = "boxes";
  readonly defaultLabel = "Object";
}
```

It inherits configuration UI, answer validation, completion, gold guidance,
summaries, readonly overlays, and stored-answer/interaction conversion.

## Media plugins and interaction context

A `MediaPlugin` declares upload MIME types, copy, example filename, supported
interactions, lightweight preview, lazy full renderer, and `moduleContext`.

```tsx
export const imagePlugin: MediaPlugin = {
  key: "image",
  name: "Image",
  accept: "image/png,image/jpeg,image/webp",
  uploadTitle: "Choose image files",
  uploadHelp: "PNG, JPEG, or WebP images",
  exampleFilename: "image.jpg",
  moduleContext: { interactionDefaults: { frame_aware: false } },
  supportedInteractions: ["none", "spatial-shapes"],
  AnnotationRenderer: lazy(() => import("../../components/annotator/ImageMediaRenderer")),
  PreviewRenderer: ImagePreview,
};
```

Renderers receive only `{ mediaUrl, interaction }`; they never inspect the
annotation key. Image and video both consume `spatial-shapes`. Video enriches it
with playback time and visibility filtering; image renders timeless shapes.

Compatibility requires all of the following:

```text
annotation.requiredInteraction is supported by modality
annotation.requiredMediaCapabilities are a subset of modality capabilities
modality is marked available
frontend media and annotation registries contain matching implementations
```

## Adding an annotation child using an existing interaction

1. Write failing backend config, answer, gold, and agreement tests.
2. Add strict Pydantic models and a `BaseAnnotationType` child or family child.
3. Register the backend class and assert modality capability resolution.
4. Write failing frontend default/config/gold/interaction tests.
5. Add a `BaseAnnotationModule` child and augment the schema/answer maps.
6. Register the frontend instance. Do not edit shared screens.
7. Add an API integration scenario covering create → gold manifest → two
   annotators → review → export.

If step 6 requires a concrete key branch in `main.py`, `CreateExperiment.tsx`,
`Annotator.tsx`, `ReviewAnnotations.tsx`, or `ExperimentAnnotators.tsx`, stop:
the base/family contract is missing a hook.

## Adding a new interaction

A genuinely new gesture/rendering language is a framework change:

1. define a discriminated `MediaInteraction` variant in `contracts.ts`;
2. implement pure state/coordinate helpers and tests;
3. build an editable/read-only renderer;
4. declare it on every capable frontend media plugin and backend modality;
5. create child modules that translate stored answers to/from the interaction;
6. integrate modality-owned defaults through `moduleContext`;
7. verify authoring, runtime, review overlay, gold scoring, and export.

Do not use an untyped `Record<string, unknown>` interaction payload. Exhaustive
discriminated unions are what make renderer changes safe.

## Scoring implementations

- categorical single: exact equality;
- categorical multi: Jaccard similarity;
- transcription: normalized word edit similarity;
- temporal: greedy labeled interval IoU;
- diarization: label-cluster alignment followed by interval matching;
- boxes/polygons/ellipses: IoU;
- polylines: symmetric point-to-segment similarity;
- keypoints: normalized Euclidean similarity;
- spatial collections: deterministic greedy same-label matching with unmatched
  penalties and optional timestamp tolerance.

Shapely is used only in pure backend geometry scoring. Frontend SVG state remains
dependency-free.

## Verification checklist

```bash
cd backend
UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest discover -s tests -v

DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db \
RUN_INTEGRATION=1 UV_CACHE_DIR=/tmp/annotate-it-uv-cache \
uv run python -m unittest discover -s tests -v

cd ../frontend
npm test
npm run build
```

With local PostgreSQL and S3/MinIO available, run the integration suite:

```bash
cd backend
DATABASE_URL=postgresql://annotate_user:annotate_password@localhost:5433/annotate_db \
RUN_INTEGRATION=1 UV_CACHE_DIR=/tmp/annotate-it-uv-cache \
uv run python -m unittest discover -s tests -v
```

Manually verify this full path with a real media file:

1. Select the modality and a compatible annotation type.
2. Upload media, metadata, and gold answers.
3. Confirm dataset preview playback/rendering.
4. Deploy and submit an annotation through the public link.
5. Confirm the creator review renders the media and answer correctly.
6. Confirm gold and agreement scores still update.
7. Also manually test pointer accuracy at multiple viewport sizes, image aspect
   ratios, video seeks, and browser zoom levels. Unit tests prove transformations;
   they cannot prove the feel of drawing controls.

## 11. Definition of done

A modality addition is complete when it needs only its frontend plugin/renderer,
backend descriptor, local styles, and tests. Existing shared screens should not
change.

An annotation-type addition is complete when normal answers and gold answers use
the same documented schema, API validation rejects malformed answers, scoring is
deterministic, compatible modalities are derived correctly, and all designer,
annotator, review, and export paths understand the new plugin through the
registry.
