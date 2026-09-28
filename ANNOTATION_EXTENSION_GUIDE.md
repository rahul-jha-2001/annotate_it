# Annotation and Modality Extension Guide

This guide explains how annotation types and media modalities are connected in
Annotate It. Use it when changing an existing task or adding a new modality,
annotation type, or interaction.

## 1. Mental model

The system separates three concepts:

1. A **modality** describes the media being shown, such as audio or video.
2. An **annotation type** describes the answer being collected, such as a
   category or labeled time regions.
3. An **interaction capability** connects the two without either knowing the
   other's implementation.

```text
Annotation type                 Interaction                 Modality
---------------                 -----------                 --------
Categorical        requires     none             supported by audio/video
Segment            requires     temporal-regions supported by audio/video
```

For example, the Segment plugin produces a generic `temporal-regions`
interaction. The audio plugin draws those regions on a waveform, while the video
plugin provides start/end controls around a video player. Segment code does not
contain an audio/video branch.

Compatibility is valid only when both sides agree:

```text
annotation.requiredInteraction ∈ modality.supportedInteractions
```

The backend is authoritative. Frontend checks provide immediate feedback, but
the API validates the experiment configuration and every submitted answer.

## 2. Current support

| Modality | Frontend plugin | Backend descriptor | Supported frontend interactions |
| --- | --- | --- | --- |
| Audio | Yes | Yes | `none`, `temporal-regions` |
| Video | Yes | Yes | `none`, `temporal-regions` |
| Image | Not yet | Reserved | None in the UI yet |
| Text | Not yet | Reserved | None in the UI yet |

The backend descriptors reserve `spatial-shapes` and `text-ranges` for future
plugins. Those interactions must be added to the frontend contract before the UI
can use them.

## 3. Repository map

```text
backend/
├── modalities.py                    # Modality registry and capabilities
├── annotation_types/
│   ├── base.py                       # AnnotationTypeSpec protocol
│   ├── __init__.py                   # Annotation registry and compatibility
│   ├── categorical.py                # Categorical config/answers/scoring
│   └── segment.py                    # Temporal regions and IoU scoring
├── services/scoring.py               # Dispatches scoring through the registry
├── main.py                           # API validation and catalog endpoints
└── tests/test_annotation_types.py    # Contract, validation, and scoring tests

frontend/src/
├── plugins/
│   ├── contracts.ts                  # Shared plugin and interaction contracts
│   ├── registry.test.ts              # Registry/capability tests
│   ├── media/
│   │   ├── registry.ts               # Media plugin registry
│   │   ├── audio.tsx                 # Audio manifest and preview
│   │   └── video.tsx                 # Video manifest and preview
│   └── annotations/
│       ├── registry.ts               # Annotation plugin registry
│       ├── categorical.tsx           # Categorical UI and client validation
│       └── segment.tsx               # Segment UI and interaction adapter
└── components/
    ├── CreateExperiment.tsx          # Resolves plugins for authoring/preview
    ├── Annotator.tsx                 # Joins media + annotation plugins
    ├── ReviewAnnotations.tsx         # Uses plugin previews and summaries
    ├── datasetBundle.ts              # Delegates gold validation to plugins
    └── annotator/
        ├── AudioMediaRenderer.tsx
        ├── VideoMediaRenderer.tsx
        ├── AnnotationControl.tsx      # Thin annotation-registry adapter
        └── types.ts                   # Shared schema and answer shapes
```

## 4. Backend annotation types

Every backend annotation type implements `AnnotationTypeSpec` from
`backend/annotation_types/base.py`.

### Required fields

- `key`: stable value stored in `label_schema.annotation_type`.
- `name`: designer-facing name.
- `required_interaction`: capability required from a modality.
- `supports_choices`: whether the current designer UI should collect labels.
- `supports_multi_select`: whether the designer may enable multiple choices.

Keys and interaction names are persistent API/data values. Do not rename them
after experiments exist unless a data migration and legacy normalization path are
also added.

### Required methods

- `validate_config(config)` validates and normalizes the experiment's
  `label_schema`. Return JSON-serializable normalized data.
- `get_answer_model(config)` returns the Pydantic model for the current
  configuration. It may select different models, as categorical does for single
  versus multiple choice.
- `validate_answer(answer, config)` validates both shape and experiment-specific
  constraints, such as membership in configured choices.
- `gold_match(answer, gold_answer, config)` returns a score from `0.0` to `1.0`.
- `agreement(answers, config)` returns inter-annotator agreement from `0.0` to
  `1.0`.

Use strict Pydantic models with `extra="forbid"`. Shape validation alone is not
enough: validate configured labels, uniqueness, ranges, ordering, and other
semantic constraints inside `validate_config` or `validate_answer`.

### Where the backend dispatches

The registry is used automatically for:

- experiment configuration in `POST /experiments`;
- inline and manifest gold-answer validation;
- annotator submissions;
- gold scoring and overlap agreement;
- score rebuilding.

`GET /annotation-types` exposes annotation metadata and derived compatible
modalities. `GET /modalities` exposes modality capabilities.

## 5. Frontend plugins

### MediaPlugin

A media plugin owns everything specific to displaying or uploading one modality:

- accepted browser file types and upload copy;
- example filename used in gold guidance;
- supported interaction capabilities;
- lightweight dataset/review preview;
- lazy-loaded full annotation renderer.

The full renderer receives only:

```ts
interface MediaRendererProps {
  mediaUrl: string;
  interaction: MediaInteraction;
}
```

It must not inspect `label_schema.annotation_type`. It renders the interaction it
receives or ignores `none`.

### AnnotationPlugin

An annotation plugin owns task-specific behavior:

- answer control and answer summary;
- initial answer and completeness rules;
- required media interaction and answer-to-interaction mapping;
- gold-answer shape, example, guidance, and client validation;
- optional interactive task preview.

Controls must be controlled React components: read `answer`, and call `onChange`
with the complete next answer. Do not keep the authoritative answer only in local
component state.

Client gold validation should mirror the backend for authoring feedback. The
backend validator remains authoritative and must reject invalid data even if the
frontend accepted it.

## 6. Add a modality using existing interactions

Use this path for additions such as a new playable temporal-media format.

1. Add its backend descriptor to `backend/modalities.py`.
2. Create `frontend/src/plugins/media/<modality>.tsx`.
3. Create the annotation renderer under `frontend/src/components/annotator/`.
4. Add the plugin to `frontend/src/plugins/media/registry.ts`.
5. Add any modality-local styling and registry tests.
6. Run the complete verification commands below.

Minimal frontend plugin:

```tsx
import { lazy } from "react";
import type { MediaPlugin, MediaPreviewProps } from "../contracts";

function Preview({ mediaUrl, title }: MediaPreviewProps) {
  return <MyMediaPreview src={mediaUrl} title={title} />;
}

export const myMediaPlugin: MediaPlugin = {
  key: "my-media",
  name: "My media",
  accept: ".my-media",
  uploadTitle: "Choose my media files",
  uploadHelp: "Supported format description",
  exampleFilename: "sample.my-media",
  supportedInteractions: ["none"],
  AnnotationRenderer: lazy(() => import("../../components/annotator/MyMediaRenderer")),
  PreviewRenderer: Preview,
};
```

Minimal backend descriptor:

```py
"my-media": ModalitySpec("my-media", "My media", ["none"]),
```

Do not add modality branches to `CreateExperiment`, `Annotator`,
`ReviewAnnotations`, or `datasetBundle`. If one of those files appears necessary,
the behavior probably belongs in the media plugin contract instead.

## 7. Add an annotation type using an existing interaction

1. Create `backend/annotation_types/<type>.py` with strict config and answer
   models plus an `AnnotationTypeSpec` implementation.
2. Register its instance in `backend/annotation_types/__init__.py`.
3. Extend `LabelSchema` and `AnnotationAnswer` in frontend annotator types when
   the stored fields are new.
4. Create `frontend/src/plugins/annotations/<type>.tsx` implementing every
   `AnnotationPlugin` field.
5. Register it in `frontend/src/plugins/annotations/registry.ts`.
6. Add backend validation/scoring tests and frontend plugin/gold tests.

Minimal plugin outline:

```tsx
export const myAnnotationPlugin: AnnotationPlugin = {
  key: "my-annotation",
  description: mediaName => `Annotate ${mediaName.toLowerCase()}`,
  requiredInteraction: "none",
  Control: MyAnswerControl,
  AnswerView: MyAnswerView,
  createInitialAnswer: () => ({}),
  createInteraction: () => ({ kind: "none" }),
  isComplete: (_schema, answer) => /* boolean */,
  validateGold: (answer, schema) => /* string[] */,
  goldAnswerShape: () => "{ ... }",
  createGoldExample: schema => ({ /* valid example */ }),
};
```

The current experiment builder has shared support for choice-based schemas via
`choices` and `multi_select`. If a new type needs fundamentally different
configuration, first add a typed configuration-editor hook to
`AnnotationPlugin`; keep that configuration UI inside the plugin rather than
adding a type check to the wizard.

## 8. Add a new interaction capability

This is intentionally a wider change because it creates a new language between
annotation and media plugins. Examples are bounding boxes and text ranges.

1. Add a discriminated variant to `MediaInteraction` in `contracts.ts`.
2. Add its string to the backend modality descriptors that can render it.
3. Set the new annotation type's `required_interaction` on both backend and
   frontend implementations.
4. Implement the interaction in each supporting media renderer.
5. Test compatible and incompatible modality/task pairs.

Example shape:

```ts
type MediaInteraction =
  | { kind: "none" }
  | { kind: "temporal-regions"; regions: TemporalRegion[]; onChange: (...) => void }
  | { kind: "spatial-shapes"; shapes: SpatialShape[]; onChange: (...) => void };
```

Keep variants explicit and serializable except for their event callbacks. Avoid
generic `Record<string, unknown>` interaction payloads because they remove
exhaustive TypeScript checks.

## 9. Modification rules

When changing an existing modality:

- preserve its `key`;
- keep preview and annotation rendering behavior inside its plugin/renderer;
- do not change annotation answer shapes unless the annotation type itself is
  changing;
- update `supportedInteractions` in frontend and backend together;
- test every annotation type requiring a changed capability.

When changing an annotation type:

- treat stored schemas and answers as versioned data contracts;
- update config, normal answer, and gold-answer validation together;
- update gold and agreement scoring together where semantics change;
- ensure old experiments either remain valid or receive an explicit migration;
- keep frontend validation, example payloads, summaries, and controls aligned.

## 10. Testing checklist

Backend unit tests:

```bash
cd backend
UV_CACHE_DIR=/tmp/annotate-it-uv-cache uv run python -m unittest discover -s tests -v
```

Frontend tests and production build:

```bash
cd frontend
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

## 11. Definition of done

A modality addition is complete when it needs only its frontend plugin/renderer,
backend descriptor, local styles, and tests. Existing shared screens should not
change.

An annotation-type addition is complete when normal answers and gold answers use
the same documented schema, API validation rejects malformed answers, scoring is
deterministic, compatible modalities are derived correctly, and all designer,
annotator, review, and export paths understand the new plugin through the
registry.
