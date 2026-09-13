import { SpatialAnnotationModule } from "./SpatialAnnotationModule";

class BoundingBoxModule extends SpatialAnnotationModule<"bounding_box"> {
  readonly key = "bounding_box" as const; readonly name = "Bounding boxes"; readonly tool = "bounding_box" as const; readonly collectionField = "boxes"; readonly defaultLabel = "Object";
}
class PolygonModule extends SpatialAnnotationModule<"polygon"> {
  readonly key = "polygon" as const; readonly name = "Polygons"; readonly tool = "polygon" as const; readonly collectionField = "polygons"; readonly defaultLabel = "Object";
}
class PolylineModule extends SpatialAnnotationModule<"polyline"> {
  readonly key = "polyline" as const; readonly name = "Polylines"; readonly tool = "polyline" as const; readonly collectionField = "polylines"; readonly defaultLabel = "Path";
}
class EllipseModule extends SpatialAnnotationModule<"ellipse"> {
  readonly key = "ellipse" as const; readonly name = "Ellipses"; readonly tool = "ellipse" as const; readonly collectionField = "ellipses"; readonly defaultLabel = "Object";
}
class KeypointModule extends SpatialAnnotationModule<"keypoint"> {
  readonly key = "keypoint" as const; readonly name = "Keypoints"; readonly tool = "keypoint" as const; readonly collectionField = "keypoints"; readonly defaultLabel = "Point";
}

export const spatialTaskModules = [
  new BoundingBoxModule(),
  new PolygonModule(),
  new PolylineModule(),
  new EllipseModule(),
  new KeypointModule(),
];
