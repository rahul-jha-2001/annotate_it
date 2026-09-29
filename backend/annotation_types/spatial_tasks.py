from __future__ import annotations

from .scoring.geometry import (
    box_iou,
    ellipse_iou,
    keypoint_similarity,
    polygon_iou,
    polyline_similarity,
)
from .spatial import (
    BoundingBoxAnswer,
    EllipseAnswer,
    KeypointAnswer,
    PolygonAnswer,
    PolylineAnswer,
    SpatialAnnotationType,
    SpatialConfig,
    SpatialShape,
)


class BoundingBoxType(SpatialAnnotationType):
    key = "bounding_box"
    name = "Bounding boxes"
    answer_model = BoundingBoxAnswer
    collection_field = "boxes"

    def _score_shape(self, left: SpatialShape, right: SpatialShape, config: SpatialConfig) -> float:
        return box_iou(left, right)


class PolygonType(SpatialAnnotationType):
    key = "polygon"
    name = "Polygons"
    answer_model = PolygonAnswer
    collection_field = "polygons"

    def _score_shape(self, left: SpatialShape, right: SpatialShape, config: SpatialConfig) -> float:
        return polygon_iou(left, right)


class PolylineType(SpatialAnnotationType):
    key = "polyline"
    name = "Polylines"
    answer_model = PolylineAnswer
    collection_field = "polylines"

    def _score_shape(self, left: SpatialShape, right: SpatialShape, config: SpatialConfig) -> float:
        return polyline_similarity(
            left, right, distance_tolerance=config.distance_tolerance
        )


class EllipseType(SpatialAnnotationType):
    key = "ellipse"
    name = "Ellipses"
    answer_model = EllipseAnswer
    collection_field = "ellipses"

    def _score_shape(self, left: SpatialShape, right: SpatialShape, config: SpatialConfig) -> float:
        return ellipse_iou(left, right)


class KeypointType(SpatialAnnotationType):
    key = "keypoint"
    name = "Keypoints"
    answer_model = KeypointAnswer
    collection_field = "keypoints"

    def _score_shape(self, left: SpatialShape, right: SpatialShape, config: SpatialConfig) -> float:
        return keypoint_similarity(left, right)


SPATIAL_TASK_TYPES = (
    BoundingBoxType,
    PolygonType,
    PolylineType,
    EllipseType,
    KeypointType,
)
