# Deferred Annotation Systems

The current base/family architecture makes ordinary annotation children cheap:
they reuse an existing answer lifecycle and an existing media interaction. The
systems below are deliberately deferred because each introduces a new rendering,
storage, scoring, or operational boundary. They should not be forced into a
nominal child class merely to claim plugin compatibility.

## Boundary test

An addition is a normal child module when it can provide strict JSON config and
answers, implement a bounded deterministic score, and map to an already supported
typed interaction without changing coordinators. It is a framework project when
it needs a new interaction protocol, binary artifact lifecycle, persistent object
identity across samples/frames/cameras, specialist rendering, or asynchronous
compute.

## Pixel masks and semantic/instance segmentation

- **Renderer:** tiled canvas/WebGL brush, erase/fill, zoom/pan, class opacity,
  contour display, and large-image viewport management.
- **Storage:** compressed PNG/RLE/COCO masks in object storage; JSONB should hold
  references and dimensions, not millions of pixels.
- **Scoring:** pixel IoU/Dice per class and instance matching with ignore regions.
- **API:** artifact upload/finalization, content hashes, signed reads, and answer
  transactions that cannot reference incomplete uploads.
- **Operations:** thumbnail/pyramid generation, storage quotas, cleanup, and
  potentially background conversion jobs.
- **Tests:** brush rasterization, zoom invariance, encoding round trips, large
  artifacts, interrupted uploads, and scorer fixtures.
- **Why not a child:** the current JSON-only answer and SVG shape renderer are not
  suitable binary-mask infrastructure.

## Skeletons and pose annotation

- **Renderer:** joint graph, named keypoints, constrained edges, occlusion and
  visibility states, optional snapping.
- **Storage:** schema-versioned topology plus per-instance joints and attributes.
- **Scoring:** OKS/PCK-style metrics requiring scale, visibility, and missing-joint
  semantics rather than independent point distance.
- **API:** topology catalog/version validation and possibly reusable templates.
- **Operations:** template governance and migration when a skeleton changes.
- **Tests:** topology validity, symmetric limbs, hidden joints, scale invariance,
  and partial skeleton matching.
- **Why not a child:** it composes points into a constrained graph and needs a new
  interaction, even though individual coordinates resemble keypoints.

## 3D cuboids

- **Renderer:** calibrated perspective projection or a true 3D viewport, camera
  orbit, depth/rotation handles, and occlusion cues.
- **Storage:** center, dimensions, quaternion/yaw, coordinate frame, calibration
  reference, and units.
- **Scoring:** oriented 3D IoU and projection-aware alternatives.
- **API:** calibration assets, coordinate-frame validation, and unit metadata.
- **Operations:** GPU/browser capability fallbacks and large scene assets.
- **Tests:** transformations, handedness, calibration, projected handles, and
  exact oriented-IoU fixtures.
- **Why not a child:** normalized 2D coordinates cannot represent physical 3D
  space or calibration.

## OCR composition

- **Renderer:** region drawing plus transcription, reading order, language/script,
  and optional character/word links.
- **Storage:** nested region-text graphs and reading-order edges.
- **Scoring:** detection IoU combined with text edit distance and assignment;
  layout/order metrics may be separate.
- **API:** composite-schema validation and atomic updates across linked parts.
- **Operations:** font/script support and potentially OCR pre-annotation jobs.
- **Tests:** Unicode normalization, vertical/right-to-left text, split/merged
  regions, reading order, and composite scoring.
- **Why not a child:** it composes spatial and transcription interactions; the
  platform currently supports one interaction/answer family per experiment.

## Per-shape attributes and relation graphs

- **Renderer:** dynamic attribute forms tied to selected objects and edge/relation
  creation between stable object IDs.
- **Storage:** versioned attribute schemas, nullable/conditional fields, and graph
  references with referential integrity.
- **Scoring:** configurable attribute similarities and graph matching in addition
  to geometry.
- **API:** validate relation endpoints and schema-dependent fields atomically.
- **Operations:** schema migration and analytics for changing taxonomies.
- **Tests:** deleted endpoints, conditional attributes, graph cycles, migrations,
  and weighted score composition.
- **Why not a child:** the base supports labels and geometry but not reusable
  object-level form schemas or relations.

## Object tracking across video

- **Renderer:** timeline/keyframes, persistent tracks, interpolation, split/merge,
  occlusion, and track navigation.
- **Storage:** track entities separate from frame observations; potentially many
  frame records or compact interpolation segments.
- **Scoring:** MOT metrics, identity switches, fragmentation, trajectory
  IoU, and configurable interpolation semantics.
- **API:** track-level concurrency/versioning and partial saves for long jobs.
- **Operations:** autosave/recovery, long-session reservations, and precomputed
  proposals.
- **Tests:** seeks, keyframe interpolation, identity continuity, concurrent edits,
  and long-video recovery.
- **Why not a child:** current video spatial shapes are independent timestamped
  observations; IDs do not imply tracking or interpolation.

## Multi-camera synchronized annotation

- **Renderer:** synchronized players, drift correction, shared timeline, camera
  selection, and cross-view projection.
- **Storage:** grouped media units, clock offsets, calibration, and cross-view
  entity references.
- **Scoring:** synchronization-aware matching and possibly reconstructed 3D error.
- **API:** allocate a media bundle atomically rather than one raw URI.
- **Operations:** synchronized transcoding, bandwidth control, and bundle health.
- **Tests:** clock drift, missing cameras, seek synchronization, calibration, and
  degraded-network behavior.
- **Why not a child:** a `DataUnit` currently owns one media URI and one renderer.

## Specialized imagery

This includes medical DICOM, geospatial rasters, pathology slides, and scientific
multi-channel images.

- **Renderer:** modality-specific windowing, tiled pyramids, channels, coordinate
  readouts, measurements, and domain metadata.
- **Storage:** original assets plus pyramids/tiles, coordinate reference systems,
  study/series grouping, and potentially regulated metadata.
- **Scoring:** physical-unit distances, volumetric overlap, or domain metrics.
- **API:** asset manifests, access policy, de-identification state, and group-aware
  allocation.
- **Operations:** conversion pipelines, PHI/security controls, retention, audit,
  and much larger storage footprints.
- **Tests:** codecs, coordinate transforms, windowing, anonymization, and role
  restrictions.
- **Why not a child:** this is a media/storage/compliance platform expansion, not
  just another annotation answer.

## LiDAR and point clouds

- **Renderer:** WebGL point-cloud streaming, camera controls, filtering, 3D picks,
  cuboids/polylines, and level-of-detail loading.
- **Storage:** LAS/LAZ/PCD or tiled point-cloud assets plus coordinate frames and
  calibration.
- **Scoring:** oriented 3D geometry, point inclusion, and class/track metrics.
- **API:** ranged/tiled delivery, calibration references, and potentially binary
  annotation artifacts.
- **Operations:** preprocessing workers, GPU/browser limits, large-file quotas,
  and observability for tile generation.
- **Tests:** LOD consistency, coordinate precision, huge scenes, transformations,
  and cross-browser WebGL behavior.
- **Why not a child:** no existing media plugin or interaction can render or
  address a 3D point cloud.

## Recommended order

1. Per-shape attributes, because they extend stable shape IDs with the smallest
   new renderer surface.
2. Skeletons, as a constrained spatial graph with reusable topology.
3. OCR composition, after the platform supports multi-part answers.
4. Masks, after binary artifact transactions and tiled rendering exist.
5. Tracking, after durable reservations/autosave are available.
6. Cuboids, specialized imagery, multi-camera, and LiDAR only when a validated
   product use case justifies their infrastructure and operational cost.
