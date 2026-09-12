from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any, TypeVar

from shapely.geometry import Polygon


ShapeT = TypeVar("ShapeT")
EPSILON = 1e-12
MAX_NORMALIZED_DISTANCE = math.sqrt(2.0)


def _value(item: Any, name: str) -> Any:
    if isinstance(item, Mapping):
        return item[name]
    return getattr(item, name)


def _optional_value(item: Any, name: str) -> Any | None:
    if isinstance(item, Mapping):
        return item.get(name)
    return getattr(item, name, None)


def _number(value: Any, name: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _coordinate(value: Any, name: str) -> float:
    result = _number(value, name)
    if result < 0.0 or result > 1.0:
        raise ValueError(f"{name} must be between 0 and 1")
    return result


def _point(item: Any) -> tuple[float, float]:
    return (
        _coordinate(_value(item, "x"), "x"),
        _coordinate(_value(item, "y"), "y"),
    )


def _box(item: Any) -> tuple[float, float, float, float]:
    x, y = _point(item)
    width = _number(_value(item, "width"), "width")
    height = _number(_value(item, "height"), "height")
    if width <= 0.0 or height <= 0.0:
        raise ValueError("width and height must be positive")
    if x + width > 1.0 + EPSILON or y + height > 1.0 + EPSILON:
        raise ValueError("geometry must remain inside normalized media bounds")
    return x, y, width, height


def _points(item: Any, *, minimum: int) -> list[tuple[float, float]]:
    points = [_point(point) for point in _value(item, "points")]
    if len(points) < minimum:
        raise ValueError(f"geometry requires at least {minimum} points")
    if len(set(points)) < minimum:
        raise ValueError(f"geometry requires at least {minimum} unique points")
    return points


def _polygon(item: Any) -> Polygon:
    polygon = Polygon(_points(item, minimum=3))
    if polygon.is_empty or polygon.area <= EPSILON or not polygon.is_valid:
        raise ValueError("polygon must be non-self-intersecting with positive area")
    return polygon


def _polygon_iou(left: Polygon, right: Polygon) -> float:
    union = left.union(right).area
    if union <= EPSILON:
        return 0.0
    return max(0.0, min(1.0, left.intersection(right).area / union))


def box_iou(left: Any, right: Any) -> float:
    left_x, left_y, left_width, left_height = _box(left)
    right_x, right_y, right_width, right_height = _box(right)
    intersection_width = max(
        0.0,
        min(left_x + left_width, right_x + right_width) - max(left_x, right_x),
    )
    intersection_height = max(
        0.0,
        min(left_y + left_height, right_y + right_height) - max(left_y, right_y),
    )
    intersection = intersection_width * intersection_height
    union = left_width * left_height + right_width * right_height - intersection
    return 0.0 if union <= EPSILON else intersection / union


def polygon_iou(left: Any, right: Any) -> float:
    return _polygon_iou(_polygon(left), _polygon(right))


def _point_segment_distance(
    point: tuple[float, float],
    segment_start: tuple[float, float],
    segment_end: tuple[float, float],
) -> float:
    px, py = point
    ax, ay = segment_start
    bx, by = segment_end
    dx = bx - ax
    dy = by - ay
    length_squared = dx * dx + dy * dy
    if length_squared <= EPSILON:
        return math.hypot(px - ax, py - ay)
    projection = max(
        0.0,
        min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_squared),
    )
    return math.hypot(px - (ax + projection * dx), py - (ay + projection * dy))


def _directed_polyline_distance(
    source: Sequence[tuple[float, float]], target: Sequence[tuple[float, float]]
) -> float:
    segments = list(zip(target, target[1:]))
    return sum(
        min(_point_segment_distance(point, start, end) for start, end in segments)
        for point in source
    ) / len(source)


def polyline_similarity(
    left: Any,
    right: Any,
    *,
    distance_tolerance: float = MAX_NORMALIZED_DISTANCE,
) -> float:
    tolerance = _number(distance_tolerance, "distance_tolerance")
    if tolerance <= 0.0:
        raise ValueError("distance_tolerance must be positive")
    left_points = _points(left, minimum=2)
    right_points = _points(right, minimum=2)
    distance = (
        _directed_polyline_distance(left_points, right_points)
        + _directed_polyline_distance(right_points, left_points)
    ) / 2.0
    return max(0.0, min(1.0, 1.0 - distance / tolerance))


def _ellipse_polygon(item: Any, resolution: int) -> Polygon:
    x, y, width, height = _box(item)
    if resolution < 16:
        raise ValueError("ellipse resolution must be at least 16")
    center_x = x + width / 2.0
    center_y = y + height / 2.0
    radius_x = width / 2.0
    radius_y = height / 2.0
    return Polygon(
        [
            (
                center_x + radius_x * math.cos(2.0 * math.pi * index / resolution),
                center_y + radius_y * math.sin(2.0 * math.pi * index / resolution),
            )
            for index in range(resolution)
        ]
    )


def ellipse_iou(left: Any, right: Any, *, resolution: int = 96) -> float:
    return _polygon_iou(
        _ellipse_polygon(left, resolution),
        _ellipse_polygon(right, resolution),
    )


def keypoint_similarity(left: Any, right: Any) -> float:
    left_x, left_y = _point(left)
    right_x, right_y = _point(right)
    distance = math.hypot(left_x - right_x, left_y - right_y)
    return max(0.0, min(1.0, 1.0 - distance / MAX_NORMALIZED_DISTANCE))


def greedy_labeled_match(
    left: Sequence[ShapeT],
    right: Sequence[ShapeT],
    scorer: Callable[[ShapeT, ShapeT], float],
    *,
    time_tolerance: float | None = None,
) -> float:
    """Greedily match same-label shapes and penalize every unmatched shape.

    Candidate ordering includes stable source indexes, making tied matches
    deterministic across runs and Python versions.
    """
    if not left and not right:
        return 1.0
    tolerance = None
    if time_tolerance is not None:
        tolerance = _number(time_tolerance, "time_tolerance")
        if tolerance < 0.0:
            raise ValueError("time_tolerance cannot be negative")

    candidates: list[tuple[float, int, int]] = []
    for left_index, left_item in enumerate(left):
        for right_index, right_item in enumerate(right):
            if _value(left_item, "label") != _value(right_item, "label"):
                continue
            if tolerance is not None:
                left_time = _optional_value(left_item, "time")
                right_time = _optional_value(right_item, "time")
                if left_time is None or right_time is None:
                    raise ValueError("time is required when time_tolerance is used")
                if abs(_number(left_time, "time") - _number(right_time, "time")) > tolerance:
                    continue
            score = float(scorer(left_item, right_item))
            if not math.isfinite(score) or score < 0.0 or score > 1.0:
                raise ValueError("shape scorer must return a finite value between 0 and 1")
            candidates.append((score, left_index, right_index))

    matched_left: set[int] = set()
    matched_right: set[int] = set()
    matched_score = 0.0
    for score, left_index, right_index in sorted(
        candidates, key=lambda candidate: (-candidate[0], candidate[1], candidate[2])
    ):
        if left_index in matched_left or right_index in matched_right:
            continue
        matched_left.add(left_index)
        matched_right.add(right_index)
        matched_score += score
    return matched_score / max(len(left), len(right))
