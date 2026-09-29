import { SpatialAnnotationModule } from "./SpatialAnnotationModule";
import type { SpatialSchema } from "./SpatialAnnotationModule";
import type { AnnotationCatalogPreset } from "../catalog/types";
import type { AnnotationModuleContext } from "../contracts";
import { catalogBundlePaths, catalogSamples, defineCatalogPreset } from "../catalog/fixtures";

interface SpatialCatalogDetails { slug: string; title: string; summary: string; useCases: string[]; choices: string[]; filenames: string[]; contentType: string; }

function spatialCatalog<KeyT extends string>(module: SpatialAnnotationModule<KeyT>, context: AnnotationModuleContext, details: SpatialCatalogDetails): AnnotationCatalogPreset<SpatialSchema<KeyT>>[] {
  const schema = { ...module.defaultSchema(context), choices: details.choices };
  return [defineCatalogPreset({
    slug: details.slug, title: details.title, summary: details.summary, family: "Spatial",
    useCases: details.useCases, modality: "image", schema,
    samples: catalogSamples(details.slug, details.filenames.map(filename => ({ filename, metadata: { language: "None", difficulty: 1, content_type: details.contentType } }))),
    metadataDescription: "Difficulty and content type describe each image and can support routing.",
    scoringDescription: "Gold and agreement scoring compare labels and normalized geometry overlap or distance.",
    ...catalogBundlePaths(details.slug),
  })];
}

class BoundingBoxModule extends SpatialAnnotationModule<"bounding_box"> {
  readonly key = "bounding_box" as const; readonly name = "Bounding boxes"; readonly tool = "bounding_box" as const; readonly collectionField = "boxes"; readonly defaultLabel = "Object";
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<SpatialSchema<typeof this.key>>[] { return spatialCatalog(this, context, { slug: "bounding-box", title: "Bounding boxes", summary: "Draw rectangular boxes around objects in an image.", useCases: ["Object detection", "Traffic scenes", "Inventory"], choices: ["Person", "Car"], filenames: ["street_001.jpg", "street_002.jpg"], contentType: "Street scene" }); }
}
class PolygonModule extends SpatialAnnotationModule<"polygon"> {
  readonly key = "polygon" as const; readonly name = "Polygons"; readonly tool = "polygon" as const; readonly collectionField = "polygons"; readonly defaultLabel = "Object";
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<SpatialSchema<typeof this.key>>[] { return spatialCatalog(this, context, { slug: "polygon", title: "Polygons", summary: "Trace precise multi-point outlines around irregular objects.", useCases: ["Semantic segmentation", "Buildings", "Land cover"], choices: ["Building", "Road"], filenames: ["city_001.jpg", "city_002.jpg"], contentType: "Cityscape" }); }
}
class PolylineModule extends SpatialAnnotationModule<"polyline"> {
  readonly key = "polyline" as const; readonly name = "Polylines"; readonly tool = "polyline" as const; readonly collectionField = "polylines"; readonly defaultLabel = "Path";
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<SpatialSchema<typeof this.key>>[] { return spatialCatalog(this, context, { slug: "polyline", title: "Polylines", summary: "Trace open paths such as lanes, roads, and boundaries.", useCases: ["Lane marking", "Road extraction", "Path tracing"], choices: ["Lane", "Path"], filenames: ["road_001.jpg", "road_002.jpg"], contentType: "Road" }); }
}
class EllipseModule extends SpatialAnnotationModule<"ellipse"> {
  readonly key = "ellipse" as const; readonly name = "Ellipses"; readonly tool = "ellipse" as const; readonly collectionField = "ellipses"; readonly defaultLabel = "Object";
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<SpatialSchema<typeof this.key>>[] { return spatialCatalog(this, context, { slug: "ellipse", title: "Ellipses", summary: "Fit elliptical regions around round or oval objects.", useCases: ["Faces", "Wheels", "Microscopy"], choices: ["Face", "Wheel"], filenames: ["portrait_001.jpg", "portrait_002.jpg"], contentType: "Portrait" }); }
}
class KeypointModule extends SpatialAnnotationModule<"keypoint"> {
  readonly key = "keypoint" as const; readonly name = "Keypoints"; readonly tool = "keypoint" as const; readonly collectionField = "keypoints"; readonly defaultLabel = "Point";
  catalogPresets(context: AnnotationModuleContext): AnnotationCatalogPreset<SpatialSchema<typeof this.key>>[] { return spatialCatalog(this, context, { slug: "keypoint", title: "Keypoints", summary: "Place labeled landmark points on an image.", useCases: ["Facial landmarks", "Pose landmarks", "Medical points"], choices: ["Left eye", "Right eye", "Nose"], filenames: ["face_001.jpg", "face_002.jpg"], contentType: "Face" }); }
}

export const spatialTaskModules = [
  new BoundingBoxModule(),
  new PolygonModule(),
  new PolylineModule(),
  new EllipseModule(),
  new KeypointModule(),
];
