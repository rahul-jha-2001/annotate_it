from __future__ import annotations

from abc import abstractmethod
from typing import Any, ClassVar, List

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .base_type import BaseAnnotationType
from .scoring.geometry import greedy_labeled_match, polygon_iou


class SpatialConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: str
    schema_version: int = Field(default=1, ge=1)
    choices: List[str]
    max_shapes: int = Field(default=500, ge=1, le=10_000)
    frame_aware: bool = False
    time_tolerance: float = Field(default=0.1, ge=0, le=60)
    distance_tolerance: float = Field(default=0.1, gt=0, le=2**0.5)

    @field_validator("choices")
    @classmethod
    def validate_choices(cls, choices: List[str]) -> List[str]:
        normalized = [choice.strip() for choice in choices]
        if not normalized or any(not choice for choice in normalized):
            raise ValueError("at least one non-blank label is required")
        if len(normalized) != len(set(normalized)):
            raise ValueError("choices must be unique")
        return normalized


class SpatialShape(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=500)
    time: float | None = Field(default=None, ge=0)

    @field_validator("id", "label")
    @classmethod
    def strip_non_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class RectangularShape(SpatialShape):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_bounds(self):
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("shape must remain inside normalized media bounds")
        return self


class BoundingBox(RectangularShape):
    pass


class Ellipse(RectangularShape):
    pass


class PolygonShape(SpatialShape):
    points: List[Point] = Field(min_length=3)

    @model_validator(mode="after")
    def validate_polygon(self):
        polygon_iou(self, self)
        return self


class PolylineShape(SpatialShape):
    points: List[Point] = Field(min_length=2)

    @model_validator(mode="after")
    def validate_unique_points(self):
        if len({(point.x, point.y) for point in self.points}) < 2:
            raise ValueError("polyline requires at least two unique points")
        return self


class Keypoint(SpatialShape):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class BoundingBoxAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    boxes: List[BoundingBox]


class PolygonAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    polygons: List[PolygonShape]


class PolylineAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    polylines: List[PolylineShape]


class EllipseAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ellipses: List[Ellipse]


class KeypointAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    keypoints: List[Keypoint]


class SpatialAnnotationType(BaseAnnotationType[SpatialConfig, BaseModel]):
    schema_version = 1
    required_interaction = "spatial-shapes"
    required_media_capabilities = frozenset({"visual-content"})
    configuration_kind = "spatial"
    supports_choices = True
    supports_multi_select = False
    config_model = SpatialConfig
    collection_field: ClassVar[str]

    def _items(self, answer: BaseModel) -> list[SpatialShape]:
        return getattr(answer, self.collection_field)

    def _validate_semantics(self, answer: BaseModel, config: SpatialConfig) -> None:
        items = self._items(answer)
        if len(items) > config.max_shapes:
            raise ValueError(f"answer exceeds max_shapes={config.max_shapes}")
        ids = [shape.id for shape in items]
        if len(ids) != len(set(ids)):
            raise ValueError("shape IDs must be unique within an answer")
        unknown = sorted({shape.label for shape in items} - set(config.choices))
        if unknown:
            raise ValueError(f"unknown choices: {', '.join(unknown)}")
        if config.frame_aware:
            if any(shape.time is None for shape in items):
                raise ValueError("time is required for frame-aware spatial answers")
        elif any(shape.time is not None for shape in items):
            raise ValueError("time is not allowed for non-frame-aware spatial answers")

    def _score_pair(
        self, left: BaseModel, right: BaseModel, config: SpatialConfig
    ) -> float:
        return greedy_labeled_match(
            self._items(left),
            self._items(right),
            lambda first, second: self._score_shape(first, second, config),
            time_tolerance=config.time_tolerance if config.frame_aware else None,
        )

    @abstractmethod
    def _score_shape(
        self, left: SpatialShape, right: SpatialShape, config: SpatialConfig
    ) -> float:
        raise NotImplementedError
