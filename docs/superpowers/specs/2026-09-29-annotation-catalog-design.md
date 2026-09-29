# Annotation Catalog Design

## Summary

Add an authenticated Annotation Catalog where designers can discover every
supported annotation experience before creating an experiment. The catalog is
driven by the same frontend annotation modules and media plugins used by the
experiment wizard and annotator runtime. Each working catalog entry includes
curated static media, metadata, gold-answer examples, scoring guidance, and a
fully interactive but non-persistent annotator preview.

The initial catalog also advertises explicitly marked coming-soon annotation
types. These entries describe intended use cases but cannot be previewed or
selected for experiment creation.

## Goals

- Help an authenticated designer choose an annotation type with confidence.
- Organize available types by media modality before showing annotation cards.
- Demonstrate the real annotator experience using production components.
- Explain the required dataset, metadata, and gold-answer structures.
- Provide downloadable, version-controlled example bundles.
- Let a designer start the existing experiment wizard with a catalog choice
  preselected.
- Make implemented catalog entries discoverable from annotation modules so
  catalog documentation cannot silently drift from runtime capabilities.
- Keep catalog browsing independent of PostgreSQL, S3, and the backend API.

## Non-goals

- Saving catalog-preview annotations.
- Uploading or editing catalog datasets through the application.
- Managing catalog content in the database or through an administrator UI.
- Creating experiments from coming-soon entries.
- Implementing the advertised LiDAR/3D annotation types.
- Replacing the existing experiment wizard or annotator application.

## Access and navigation

The catalog is protected by the existing Clerk authentication boundary.
Authenticated navigation gains an `Annotation Catalog` link.

Routes:

- `/catalog` — modality selection, search, working annotation cards, and a
  separated coming-soon section.
- `/catalog/:presetSlug` — a focused annotation-type detail page.

Unauthenticated access follows the same Clerk sign-in behavior as the dashboard
and experiment creation routes.

## Catalog browsing experience

The catalog landing page starts with prominent modality controls:

- All
- Audio
- Image
- Video

Selecting a modality filters the annotation cards below it. Each control shows
the number of compatible working presets. Text search further filters cards by
title, summary, category, and use case.

Each working card shows:

- Annotation title.
- Annotation family, such as classification, temporal, speech, or spatial.
- One-sentence purpose.
- Compatible modalities.
- A link to the preset detail route.

Coming-soon cards appear in a separate section. They show the intended modality
and purpose, have an unambiguous `Coming soon` state, and do not expose preview
or experiment-creation actions.

## Detail-page experience

The detail page contains:

1. Title, summary, supported modalities, and primary use cases.
2. A sample selector when the preset contains multiple curated samples.
3. A prominent interactive `What the annotator sees` preview.
4. Dataset bundle documentation and a joined sample table.
5. Raw and readable metadata examples.
6. Raw gold-answer JSON plus module-owned gold guidance.
7. An explanation of gold scoring and inter-annotator agreement behavior.
8. A downloadable example bundle.
9. A `Create experiment` action.

Dataset, metadata, gold-answer, and scoring documentation use tabs so the live
preview remains the visual focus without hiding any required structure.

## Module-owned catalog contract

Implemented entries are owned by the annotation modules, not by an independent
hardcoded catalog registry. `BaseAnnotationModule` gains a catalog-presets
contract that may return one or more presets. Multiple presets are necessary
for configurable modules such as categorical annotation, where single-select
and multi-select are distinct discovery experiences but share one runtime
module.

A working preset contains the following information:

```ts
interface AnnotationCatalogPreset<SchemaT extends BaseAnnotationSchema> {
  slug: string;
  title: string;
  summary: string;
  family: string;
  useCases: string[];
  modality: string;
  schema: SchemaT;
  samples: CatalogSample[];
  metadataDescription: string;
  scoringDescription: string;
  exampleBundlePath: string;
}
```

`CatalogSample` references a static media asset and carries the example
filename, typed metadata values, and optional gold answer. The answer remains
unknown at the catalog boundary and is validated by its owning annotation
module.

The catalog flattens presets from `listAnnotationModules()`. It then resolves
the declared modality through the media registry and validates compatibility
using the existing `supportsAnnotation` capability check.

Planned entries use a separate `ComingSoonCatalogEntry` manifest because no
runtime annotation module exists for them. The manifest cannot provide schema,
answer, preview, bundle-download, or creation fields.

## Static examples

Catalog content is version-controlled and deployed with the frontend. Curated
fixtures are initially derived from `sample/all_datasets` and stored as minimal
catalog-ready bundles under the frontend public assets. Each preset includes
two or three representative samples when suitable.

A bundle contains:

- Media files used by the preview.
- `metadata.csv`.
- `gold_answers.json`.
- A generated or maintained manifest connecting the static files to the typed
  catalog preset.

The static assets require no database, S3 bucket, presigned URL, or backend
request. Raw CSV and JSON remain available for display and download, while the
typed manifest supplies parsed values to the React page.

## Interactive preview

The preview composes the production annotation path:

1. Resolve the annotation module from the existing registry.
2. Validate and prepare the preset schema through that module.
3. Create an initial answer using `createInitialAnswer`.
4. Render the production annotation `Control`.
5. Derive the production `MediaInteraction` using `createInteraction`.
6. Render the selected production media plugin's `AnnotationRenderer`.

The page owns only an in-memory React answer state. It never calls annotation,
experiment, upload, session, or submission APIs and never writes to local
storage. Switching samples, changing presets, leaving the route, or selecting
`Reset preview` discards the current answer.

Where the annotator page currently duplicates the composition of controls and
media renderers, a focused shared presentation component may be extracted so
both the annotator runtime and catalog invoke the same component boundary. The
catalog must not copy annotation-specific rendering or interaction logic.

## Experiment-wizard handoff

Working detail pages link to the existing creation route with validated query
parameters:

```text
/experiments/new?modality=audio&annotation_type=speaker_diarization
```

The experiment wizard reads these parameters once when initializing a new
draft. It resolves both values through the registries, confirms capability
compatibility, and applies the preset schema. Invalid or stale parameters are
ignored safely and the normal wizard defaults remain available.

The handoff preselects the modality and annotation task only. Users must still
provide their own experiment name, instructions, dataset bundle,
qualifications, routing rules, access policy, and deployment choices.

## Validation and failure behavior

Catalog contract tests validate every implemented preset:

- Slugs are unique and non-empty.
- The owning annotation module exists.
- The media modality exists.
- The modality supports the module's required interaction.
- The schema type and version match the module.
- Module schema validation succeeds.
- Every sample has a unique filename and resolvable media asset.
- Every supplied gold answer passes the module's gold validation.
- Example bundle paths are present.

Invalid static catalog content fails tests and the production build rather than
shipping a broken page.

At runtime, an individual media-load failure produces a localized preview error
with a retry or sample-selection path. It does not crash the catalog shell.
Missing route slugs render the normal not-found experience. Preview reset always
returns to the module-created initial answer.

## Testing strategy

Frontend unit tests cover:

- Module catalog-preset discovery.
- Duplicate and malformed catalog preset rejection.
- Modality capability filtering.
- Search filtering and coming-soon separation.
- Static schema and gold-answer validation.
- In-memory preview answer updates and reset behavior.
- The guarantee that preview interaction makes no API submission.
- Experiment-wizard query initialization and invalid-query fallback.

Component tests confirm that the catalog preview renders through the registered
production annotation control and media renderer rather than catalog-specific
copies.

The normal frontend production build verifies that static assets resolve and
that lazy annotation/media components compile. No backend migration or API
change is required.

## Documentation

`project_summary.md`, `PRD.md`, `TECH_DESIGN.md`, and
`ANNOTATION_EXTENSION_GUIDE.md` will describe the catalog, the module-owned
preset contract, and the requirement for new annotation modules to provide at
least one implemented catalog preset when they should be user-discoverable.

## Future extensions

The static design can later support catalog localization, remotely managed
examples, analytics, or administrative publishing without changing the
annotation runtime contract. Those capabilities are intentionally outside the
initial implementation.
