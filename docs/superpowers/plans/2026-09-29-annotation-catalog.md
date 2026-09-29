# Annotation Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authenticated, static Annotation Catalog where designers can filter working annotation presets, inspect their real interactive annotator UI and example data, and open the experiment wizard with a compatible task preselected.

**Architecture:** Extend `BaseAnnotationModule` with module-owned catalog presets, then flatten and validate those presets against the existing annotation and media registries. Render catalog previews through a shared production `AnnotationExperience` component used by both the live annotator and catalog, while keeping preview state exclusively in React memory. Serve curated example bundles from Vite public assets and use pure helpers for catalog filtering and wizard query initialization.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Wouter, Clerk React, Vitest, existing annotation/media plugin registries, WaveSurfer, React Timeline Editor

**Spec:** `docs/superpowers/specs/2026-09-29-annotation-catalog-design.md`

## Global Constraints

- Both `/catalog` and `/catalog/:presetSlug` remain behind the existing Clerk `Protected` boundary.
- Working entries are declared by annotation modules; there is no second hand-maintained registry of implemented annotation types.
- Catalog previews use the exact registered production annotation control and media renderer.
- Preview answers remain in React memory only: no API request, submission, local storage, database, or object-storage write.
- Catalog data and media are version-controlled frontend assets and require no backend API, PostgreSQL, or S3/MinIO availability.
- A preset schema must match its owning module key/version and pass that module's schema and gold-answer validation.
- A preset modality must exist and support the module's required interaction.
- Coming-soon records cannot expose schema, sample, preview, bundle, or create-experiment fields.
- The wizard handoff initializes only modality and annotation task; all experiment-specific inputs remain empty/default.
- No backend route, model, migration, or dependency change is part of this feature.

## Review Focus

- A stale/unknown catalog slug must show the application not-found state without throwing.
- Duplicate slugs or duplicate sample filenames must fail catalog validation before a broken build ships.
- Invalid or incompatible wizard query parameters must fall back to audio + categorical defaults as one consistent pair.
- Changing the selected sample or pressing Reset must discard the prior answer and recreate the module's initial answer.
- A failed media load must stay inside the preview panel and leave sample selection, documentation, and navigation usable.

---

## File Structure

- `frontend/src/plugins/catalog/types.ts`: shared preset, sample, validated-entry, and coming-soon contracts.
- `frontend/src/plugins/catalog/registry.ts`: flatten module presets, validate them against both registries, resolve slugs, and expose working entries.
- `frontend/src/plugins/catalog/filter.ts`: pure modality/search filtering and modality counts.
- `frontend/src/plugins/catalog/comingSoon.ts`: intentionally separate non-runnable entries.
- `frontend/src/plugins/catalog/fixtures.ts`: typed sample/metadata/gold descriptors shared by module preset declarations.
- `frontend/src/components/annotator/AnnotationExperience.tsx`: shared production media + annotation-control composition with localized media failure handling.
- `frontend/src/components/catalog/AnnotationCatalog.tsx`: authenticated gallery page.
- `frontend/src/components/catalog/AnnotationCatalogDetail.tsx`: detail shell, sample selection, preview, tabs, and CTA.
- `frontend/src/components/catalog/CatalogPreview.tsx`: in-memory answer lifecycle around `AnnotationExperience`.
- `frontend/public/catalog/<preset>/`: curated media, metadata, gold JSON, and downloadable ZIP assets.
- Existing annotation modules: own their implemented catalog preset(s).
- Existing `CreateExperiment`, routing, styles, and documentation: consume the new catalog behavior without changing backend contracts.

### Task 1: Define and validate the module-owned catalog contract

**Files:**
- Create: `frontend/src/plugins/catalog/types.ts`
- Create: `frontend/src/plugins/catalog/registry.ts`
- Create: `frontend/src/plugins/catalog/registry.test.ts`
- Modify: `frontend/src/plugins/annotations/BaseAnnotationModule.ts`

**Interfaces:**
- Consumes: `BaseAnnotationSchema`, `AnnotationAnswer`, `listAnnotationModules()`, `getMediaPlugin()`, and `supportsAnnotation()`.
- Produces: `CatalogSample`, `AnnotationCatalogPreset`, `ValidatedCatalogPreset`, `BaseAnnotationModule.catalogPresets()`, `buildCatalog()`, `listCatalogPresets()`, and `getCatalogPreset(slug)`.

- [ ] **Step 1: Write failing contract and validation tests**

Add tests that construct a dummy module with `catalogPresets()` and assert successful discovery, then assert failures for blank/duplicate slugs, missing modality, incompatible modality, mismatched schema type/version, invalid schema, duplicate filenames, invalid gold answers, blank asset paths, and blank bundle paths.

```ts
expect(buildCatalog([validModule], [audioPlugin])).toHaveLength(1);
expect(() => buildCatalog([withSlug(""), validModule], [audioPlugin]))
  .toThrow(/slug cannot be blank/);
expect(() => buildCatalog([withSlug("same"), withSlug("same")], [audioPlugin]))
  .toThrow(/duplicate catalog slug/);
expect(() => buildCatalog([videoSpatialPreset], [audioPlugin]))
  .toThrow(/does not support spatial-shapes/);
expect(() => buildCatalog([withGold({ value: "Unknown" })], [audioPlugin]))
  .toThrow(/Unknown gold label/);
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `cd frontend && npm test -- src/plugins/catalog/registry.test.ts`

Expected: FAIL because catalog contracts and `buildCatalog` do not exist.

- [ ] **Step 3: Add exact catalog types and the base hook**

Define the catalog boundary as:

```ts
export interface CatalogSample {
  filename: string;
  mediaPath: string;
  metadata: Record<string, string | number | boolean>;
  goldAnswer?: unknown;
}

export interface AnnotationCatalogPreset<SchemaT extends BaseAnnotationSchema> {
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
  metadataPath: string;
  goldAnswersPath: string;
  exampleBundlePath: string;
}

export interface ValidatedCatalogPreset extends AnnotationCatalogPreset<BaseAnnotationSchema> {
  annotationType: string;
  annotationName: string;
  modalityName: string;
}
```

Add this default to `BaseAnnotationModule` so modules opt in without forcing hidden/internal modules to create content:

```ts
catalogPresets(_context: AnnotationModuleContext): AnnotationCatalogPreset<SchemaT>[] {
  return [];
}
```

- [ ] **Step 4: Implement strict catalog aggregation**

Implement:

```ts
export function buildCatalog(
  modules: BaseAnnotationModule<any, any>[],
  media: MediaPlugin[],
): ValidatedCatalogPreset[];

export function listCatalogPresets(): ValidatedCatalogPreset[];
export function getCatalogPreset(slug: string): ValidatedCatalogPreset | undefined;
```

`buildCatalog` calls each module's `catalogPresets(mediaPlugin.moduleContext)`, validates every invariant from the spec, freezes each result, and includes the owning annotation key/name and resolved modality name. Throw messages must name the preset and offending field.

- [ ] **Step 5: Run focused and existing registry tests**

Run: `cd frontend && npm test -- src/plugins/catalog/registry.test.ts src/plugins/annotations/moduleContract.test.tsx src/plugins/registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add frontend/src/plugins/catalog frontend/src/plugins/annotations/BaseAnnotationModule.ts
git commit -m "feat: add annotation catalog contract"
```

### Task 2: Add curated assets and module-owned working presets

**Files:**
- Create: `frontend/src/plugins/catalog/fixtures.ts`
- Create: `frontend/src/plugins/catalog/fixtures.test.ts`
- Modify: `frontend/src/plugins/annotations/categorical.tsx`
- Modify: `frontend/src/plugins/annotations/segment.tsx`
- Modify: `frontend/src/plugins/annotations/transcription.tsx`
- Modify: `frontend/src/plugins/annotations/temporalTasks.ts`
- Modify: `frontend/src/plugins/annotations/spatialTasks.ts`
- Create: `frontend/public/catalog/<slug>/media/*`
- Create: `frontend/public/catalog/<slug>/metadata.csv`
- Create: `frontend/public/catalog/<slug>/gold_answers.json`
- Create: `frontend/public/catalog/<slug>/<slug>-example.zip`

**Interfaces:**
- Consumes: `AnnotationCatalogPreset`, each module's `defaultSchema`, and `buildCatalog` validation.
- Produces: 15 runnable presets: categorical single/multi, segment, transcription, six labeled-temporal tasks, and five spatial tasks.

- [ ] **Step 1: Write failing discovery and fixture tests**

Assert the exact slugs and modality coverage:

```ts
expect(listCatalogPresets().map(item => item.slug).sort()).toEqual([
  "action-recognition", "audio-classification-multi", "audio-classification-single",
  "bounding-box", "ellipse", "keypoint", "polygon", "polyline", "segment",
  "sound-event", "speaker-diarization", "speaker-identification",
  "speech-segmentation", "transcription", "video-event",
].sort());
expect(listCatalogPresets().every(item => item.samples.length >= 2)).toBe(true);
```

Also read every declared public path with Node `fs`, assert it exists and is non-empty, parse each gold JSON file, and verify its matching typed sample answer validates through the owning module.

- [ ] **Step 2: Run the fixture test and verify red**

Run: `cd frontend && npm test -- src/plugins/catalog/fixtures.test.ts`

Expected: FAIL because no modules expose presets and no public fixtures exist.

- [ ] **Step 3: Curate two representative samples per preset**

For each source directory under `/home/rahul/annotate_it/sample/all_datasets`, copy the first two browser-compatible media files into the matching `frontend/public/catalog/<slug>/media/` directory. Create a two-row `metadata.csv`, a gold JSON containing only matching filenames, and a ZIP containing those three bundle parts. Preserve UTF-8 filenames and content; do not transcode or synthesize replacements.

Use these source-to-slug mappings:

```text
categorical_single -> audio-classification-single
categorical_multi -> audio-classification-multi
segment -> segment
transcription -> transcription
speaker_diarization -> speaker-diarization
speaker_identification -> speaker-identification
sound_event -> sound-event
speech_segmentation -> speech-segmentation
video_event -> video-event
action_recognition -> action-recognition
bounding_box -> bounding-box
polygon -> polygon
polyline -> polyline
ellipse -> ellipse
keypoint -> keypoint
```

- [ ] **Step 4: Add typed fixture builders**

In `fixtures.ts`, export focused helpers such as:

```ts
export const catalogAsset = (slug: string, file: string) =>
  `/catalog/${slug}/${file}`;

export function defineCatalogPreset<SchemaT extends BaseAnnotationSchema>(
  preset: AnnotationCatalogPreset<SchemaT>,
): AnnotationCatalogPreset<SchemaT> {
  return preset;
}
```

Declare metadata and gold answer objects beside their owning module preset definitions; keep `fixtures.ts` limited to reusable path/building helpers rather than a parallel list of working types.

- [ ] **Step 5: Implement each module's `catalogPresets()`**

Categorical returns two audio presets using distinct schemas (`multi_select: false/true`). Segment and transcription return one audio preset. Each temporal subclass returns its appropriate audio or video preset. Each spatial subclass returns one image preset. Every preset includes purpose, family, use cases, static paths, scoring text, two typed samples, and a schema produced from that module's runtime defaults.

- [ ] **Step 6: Run fixture, registry, and full plugin tests**

Run: `cd frontend && npm test -- src/plugins/catalog/fixtures.test.ts src/plugins/catalog/registry.test.ts src/plugins/registry.test.ts src/plugins/annotations`

Expected: PASS with 15 validated working presets.

- [ ] **Step 7: Commit presets and assets**

```bash
git add frontend/src/plugins frontend/public/catalog
git commit -m "feat: add catalog presets and examples"
```

### Task 3: Add filtering, coming-soon content, gallery route, and navigation

**Files:**
- Create: `frontend/src/plugins/catalog/filter.ts`
- Create: `frontend/src/plugins/catalog/filter.test.ts`
- Create: `frontend/src/plugins/catalog/comingSoon.ts`
- Create: `frontend/src/components/catalog/AnnotationCatalog.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `listCatalogPresets()` and `ComingSoonCatalogEntry`.
- Produces: `filterCatalog(entries, modality, query)`, `catalogModalityCounts(entries)`, `/catalog`, nav link, working cards, and a separate disabled coming-soon section.

- [ ] **Step 1: Write failing filter and separation tests**

Cover case-insensitive search across title, summary, family, and use cases; exact modality filtering; All behavior; counts; and the guarantee that coming-soon entries cannot be returned as working presets.

```ts
expect(filterCatalog(entries, "audio", "speaker").map(x => x.slug))
  .toEqual(["speaker-diarization"]);
expect(catalogModalityCounts(entries)).toEqual({ all: 15, audio: 8, image: 5, video: 2 });
expect(COMING_SOON.every(item => !("schema" in item) && !("exampleBundlePath" in item)))
  .toBe(true);
```

- [ ] **Step 2: Run the filter test and verify red**

Run: `cd frontend && npm test -- src/plugins/catalog/filter.test.ts`

Expected: FAIL because filtering and coming-soon content do not exist.

- [ ] **Step 3: Implement pure filtering and coming-soon records**

Normalize search with `trim().toLocaleLowerCase()` and search the joined title/summary/family/useCases string. Define LiDAR/3D examples only with `slug`, `title`, `summary`, `family`, `modalities`, and `useCases`; do not add runnable fields.

- [ ] **Step 4: Build the gallery UI**

Render the page in this order: title/intro, modality buttons (`All`, `Audio`, `Image`, `Video`) with counts, search input, working card grid, empty-filter message, then a visually separated coming-soon grid. Working cards link to `/catalog/:slug`; coming-soon cards are non-interactive and marked `Coming soon`.

- [ ] **Step 5: Register protected routing and navigation**

Add `BookOpen` navigation for signed-in users and route before the experiment dynamic routes:

```tsx
<Route path="/catalog"><Protected><AnnotationCatalog /></Protected></Route>
```

Add catalog styles using existing Aqua Lab variables, focus states, responsive card grids, and no new styling dependency.

- [ ] **Step 6: Run tests and production type/build check**

Run: `cd frontend && npm test -- src/plugins/catalog/filter.test.ts && npm run build`

Expected: PASS; Vite emits the catalog page without TypeScript errors.

- [ ] **Step 7: Commit gallery navigation**

```bash
git add frontend/src/plugins/catalog frontend/src/components/catalog/AnnotationCatalog.tsx frontend/src/App.tsx frontend/src/index.css
git commit -m "feat: add annotation catalog gallery"
```

### Task 4: Extract and reuse the production annotation experience

**Files:**
- Create: `frontend/src/components/annotator/AnnotationExperience.tsx`
- Create: `frontend/src/components/annotator/AnnotationExperience.test.tsx`
- Modify: `frontend/src/components/Annotator.tsx`

**Interfaces:**
- Consumes: modality, `LabelSchema`, `AnnotationAnswer`, `setAnswer`, registered `Control`, registered `AnnotationRenderer`, and capability checks.
- Produces: one shared `AnnotationExperience` component used by runtime and catalog, plus a localized retryable media-error boundary.

- [ ] **Step 1: Write the failing shared-composition tests**

Use injectable registry resolvers in the test to assert the registered annotation control receives a prepared answer, its `createInteraction` result reaches the registered media renderer, unsupported pairs render a readable message, and a thrown renderer error exposes `Retry preview` rather than escaping the component.

```tsx
renderToStaticMarkup(<AnnotationExperience
  modality="audio" schema={schema} answer={{}}
  onChange={onChange} mediaUrl="/sample.wav"
/>);
expect(annotationModule.createInteraction).toHaveBeenCalled();
expect(mediaRenderer).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "/sample.wav" }));
```

- [ ] **Step 2: Run the shared-component test and verify red**

Run: `cd frontend && npm test -- src/components/annotator/AnnotationExperience.test.tsx`

Expected: FAIL because `AnnotationExperience` does not exist.

- [ ] **Step 3: Implement the shared production composer**

Resolve both plugins, prepare the answer, derive the interaction, lazy-render the media tool in `Suspense`, then render the existing `AnnotationControl`. Add a small class error boundary keyed by `mediaUrl` and a retry counter so media rendering failures reset locally.

```ts
interface AnnotationExperienceProps {
  modality: string;
  schema: LabelSchema;
  answer: AnnotationAnswer;
  onChange: (answer: AnnotationAnswer) => void;
  mediaUrl: string;
  mediaKey?: string;
  controlHeading?: string;
}
```

- [ ] **Step 4: Replace duplicated runtime composition**

In `Annotator.tsx`, retain loading/session/submission logic but replace direct plugin/media composition with `AnnotationExperience`. Keep the submit button and `isAnswerComplete` behavior outside the shared component.

- [ ] **Step 5: Run annotator, component, and build verification**

Run: `cd frontend && npm test -- src/components/annotator/AnnotationExperience.test.tsx src/components/annotator/AnnotationControl.test.tsx && npm run build`

Expected: PASS; the live annotator still compiles through the same registries.

- [ ] **Step 6: Commit shared production UI**

```bash
git add frontend/src/components/annotator frontend/src/components/Annotator.tsx
git commit -m "refactor: share annotation experience renderer"
```

### Task 5: Build the interactive catalog detail page

**Files:**
- Create: `frontend/src/components/catalog/CatalogPreview.tsx`
- Create: `frontend/src/components/catalog/CatalogPreview.test.tsx`
- Create: `frontend/src/components/catalog/AnnotationCatalogDetail.tsx`
- Create: `frontend/src/components/catalog/catalogDetail.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `getCatalogPreset`, `AnnotationExperience`, module gold guidance, sample metadata, and static asset paths.
- Produces: `/catalog/:presetSlug`, resettable in-memory preview, sample selector, documentation tabs, raw examples, bundle download, scoring explanation, and normal not-found state.

- [ ] **Step 1: Write failing preview lifecycle tests**

Extract and test a pure reducer with `answer-changed`, `sample-selected`, and `reset` events. Assert answer changes remain local, selection/reset calls the module's `createInitialAnswer`, and no API/local-storage function is imported or invoked.

```ts
expect(reducePreview(stateWithAnswer, { type: "sample-selected", index: 1 }, initial))
  .toEqual({ selectedSample: 1, answer: initial });
expect(reducePreview(stateWithAnswer, { type: "reset" }, initial).answer).toEqual(initial);
```

- [ ] **Step 2: Write failing detail-model tests**

Test that a known slug returns joined samples and valid raw-data paths, while an unknown slug yields `{ kind: "not-found" }`. Include the review-focus case for stale slugs.

- [ ] **Step 3: Run detail tests and verify red**

Run: `cd frontend && npm test -- src/components/catalog/CatalogPreview.test.tsx src/components/catalog/catalogDetail.test.ts`

Expected: FAIL because preview lifecycle and detail model do not exist.

- [ ] **Step 4: Implement `CatalogPreview`**

Initialize with `module.createInitialAnswer(preset.schema)`, key/reset state by both preset slug and sample filename, and render only `AnnotationExperience` plus `Reset preview`. Never import `apiFetch` and never use browser storage.

- [ ] **Step 5: Implement the detail page and tabs**

Render title, summary, modality/use-case chips, sample selector, large `What the annotator sees` section, then tabs:

```text
Dataset bundle | Metadata | Gold answers | Scoring
```

Dataset shows a joined sample table. Metadata shows readable values and links raw CSV. Gold shows formatted JSON, `goldAnswerShape`, and `goldInstructions`. Scoring shows preset scoring text plus gold/agreement distinction. Add a download link with `download` and a CTA to `/experiments/new?modality=<modality>&annotation_type=<annotationType>`.

- [ ] **Step 6: Add detail routing and not-found rendering**

Register `/catalog/:presetSlug` before `/catalog`. Unknown slugs render the same compact `404 - Not Found` treatment used by the app shell, with a link back to `/catalog`.

- [ ] **Step 7: Run detail tests and build**

Run: `cd frontend && npm test -- src/components/catalog && npm run build`

Expected: PASS; production components are reused and static assets appear in `dist/catalog`.

- [ ] **Step 8: Commit the detail experience**

```bash
git add frontend/src/components/catalog frontend/src/App.tsx frontend/src/index.css
git commit -m "feat: add interactive catalog details"
```

### Task 6: Initialize the experiment wizard from a validated catalog handoff

**Files:**
- Modify: `frontend/src/components/experimentDraft.ts`
- Modify: `frontend/src/components/experimentDraft.test.ts`
- Modify: `frontend/src/components/CreateExperiment.tsx`

**Interfaces:**
- Consumes: URL query string, annotation/media registries, and capability checks.
- Produces: `resolveExperimentPreset(search): { modality: string; schema: LabelSchema }` and one-time wizard initialization.

- [ ] **Step 1: Write failing query-resolution tests**

Cover a valid speaker-diarization handoff, unknown modality, unknown annotation type, incompatible pair, one missing parameter, and URL-encoded values. Every invalid case returns the normal audio/categorical pair, never a partially applied selection.

```ts
expect(resolveExperimentPreset("?modality=audio&annotation_type=speaker_diarization"))
  .toMatchObject({ modality: "audio", schema: { annotation_type: "speaker_diarization" } });
expect(resolveExperimentPreset("?modality=image&annotation_type=segment"))
  .toEqual(defaultExperimentPreset());
```

- [ ] **Step 2: Run the draft test and verify red**

Run: `cd frontend && npm test -- src/components/experimentDraft.test.ts`

Expected: FAIL because query resolution does not exist.

- [ ] **Step 3: Implement atomic query validation**

Parse with `URLSearchParams`, require both values, resolve both plugins, verify `supportsAnnotation`, and call `annotationModule.defaultSchema(media.moduleContext)`. Export `defaultExperimentPreset()` so defaults and fallback cannot diverge.

- [ ] **Step 4: Initialize `CreateExperiment` once**

Use a lazy initializer derived from `window.location.search` for the initial form modality and annotation schema. Do not react to later query-string changes and do not prefill name, instructions, files, qualification questions, access mode, overlap, or gold cadence.

- [ ] **Step 5: Run draft and full frontend tests**

Run: `cd frontend && npm test -- src/components/experimentDraft.test.ts && npm test && npm run build`

Expected: all tests and the production build pass.

- [ ] **Step 6: Commit wizard handoff**

```bash
git add frontend/src/components/experimentDraft.ts frontend/src/components/experimentDraft.test.ts frontend/src/components/CreateExperiment.tsx
git commit -m "feat: preselect experiments from catalog"
```

### Task 7: Document the catalog extension contract and verify the branch

**Files:**
- Modify: `project_summary.md`
- Modify: `PRD.md`
- Modify: `TECH_DESIGN.md`
- Modify: `ANNOTATION_EXTENSION_GUIDE.md`

**Interfaces:**
- Consumes: the completed catalog contract and UI.
- Produces: developer and product documentation that keeps future annotation modules discoverable.

- [ ] **Step 1: Update product-facing documentation**

Add the authenticated gallery/detail flow, modality/search browsing, interactive non-persistent previews, static bundle download, coming-soon behavior, and wizard handoff to `project_summary.md` and `PRD.md`.

- [ ] **Step 2: Update architecture documentation**

In `TECH_DESIGN.md`, document module-owned `catalogPresets()`, catalog aggregation/validation, static public assets, shared `AnnotationExperience`, no-backend boundary, protected routes, and atomic query validation.

- [ ] **Step 3: Extend the annotation developer guide**

In `ANNOTATION_EXTENSION_GUIDE.md`, add the exact checklist for a discoverable module: return at least one preset, add two curated static samples, raw metadata/gold files, ZIP bundle, valid schema/gold answers, and pass `fixtures.test.ts` plus `registry.test.ts`.

- [ ] **Step 4: Run complete verification**

```bash
cd frontend
npm test
npm run build
cd ..
git diff --check
git status --short
```

Expected: all frontend tests pass; production build succeeds; no whitespace errors; only intended catalog/doc changes remain.

- [ ] **Step 5: Manually smoke-test authenticated behavior**

With Clerk configured, verify `/catalog` redirects unauthenticated users, signed-in users can filter all three modalities, every working card opens, at least one audio temporal and one image spatial preview is editable/resettable, media failure remains localized, a coming-soon card has no action, bundle download works, and the CTA preselects the correct wizard pair.

- [ ] **Step 6: Commit documentation and final verification state**

```bash
git add project_summary.md PRD.md TECH_DESIGN.md ANNOTATION_EXTENSION_GUIDE.md
git commit -m "docs: document annotation catalog"
```

### Task 8: Final whole-branch review

**Files:**
- Review: all changes from `dev...codex/annotation-catalog`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: a review-ready feature branch with any correctness issues fixed and reverified.

- [ ] **Step 1: Inspect the complete diff**

Run: `git diff --stat dev...HEAD && git diff --check dev...HEAD`

Expected: only catalog, shared preview, wizard initialization, static fixtures, tests, and planned docs are present.

- [ ] **Step 2: Review high-risk boundaries**

Confirm no catalog preview imports `apiFetch`, no preview writes storage, no coming-soon entry can produce a CTA, module schemas remain strongly versioned, all public asset paths exist, and `Annotator.tsx` retains submission/completion behavior.

- [ ] **Step 3: Re-run verification after review fixes**

Run: `cd frontend && npm test && npm run build && cd .. && git diff --check`

Expected: PASS with no warnings attributable to the feature.

- [ ] **Step 4: Record final status**

Run: `git status --short --branch && git log --oneline dev..HEAD`

Expected: a clean feature branch containing the design, implementation commits, and documentation commit, ready for user review before merge.
