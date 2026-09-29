from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .base_type import BaseAnnotationType
from .scoring.temporal import greedy_region_match, interval_iou, interval_overlap


class LabeledTemporalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: str
    schema_version: int = Field(default=1, ge=1)
    choices: List[str] = Field(default_factory=list)
    allow_custom_labels: bool = False
    max_regions: int = Field(default=500, ge=1, le=10_000)

    @field_validator("choices")
    @classmethod
    def validate_choices(cls, choices: List[str]) -> List[str]:
        normalized = [choice.strip() for choice in choices]
        if any(not choice for choice in normalized):
            raise ValueError("choices cannot contain blank values")
        if len(normalized) != len(set(normalized)):
            raise ValueError("choices must be unique")
        return normalized


class LabeledTemporalRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)
    label: str = Field(min_length=1)

    @field_validator("label")
    @classmethod
    def normalize_label(cls, label: str) -> str:
        normalized = label.strip()
        if not normalized:
            raise ValueError("region label cannot be blank")
        return normalized

    @model_validator(mode="after")
    def validate_boundary(self):
        if self.end <= self.start:
            raise ValueError("region end must be greater than start")
        return self


class LabeledTemporalAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regions: List[LabeledTemporalRegion]


class LabeledTemporalType(
    BaseAnnotationType[LabeledTemporalConfig, LabeledTemporalAnswer]
):
    schema_version = 1
    required_interaction = "labeled-temporal-regions"
    configuration_kind = "labeled-temporal"
    supports_choices = True
    supports_multi_select = False
    config_model = LabeledTemporalConfig
    answer_model = LabeledTemporalAnswer

    def _validate_semantics(
        self, answer: LabeledTemporalAnswer, config: LabeledTemporalConfig
    ) -> None:
        if len(answer.regions) > config.max_regions:
            raise ValueError(f"answer exceeds max_regions={config.max_regions}")
        if not config.allow_custom_labels:
            if not config.choices:
                raise ValueError("at least one configured label is required")
            unknown = sorted(
                {region.label for region in answer.regions} - set(config.choices)
            )
            if unknown:
                raise ValueError(f"unknown choices: {', '.join(unknown)}")

    def _score_pair(
        self,
        left: LabeledTemporalAnswer,
        right: LabeledTemporalAnswer,
        config: LabeledTemporalConfig,
    ) -> float:
        return greedy_region_match(
            left.regions,
            right.regions,
            lambda a, b: interval_iou(a.start, a.end, b.start, b.end)
            if a.label == b.label
            else 0.0,
        )


class ClusterAlignedTemporalType(LabeledTemporalType):
    def _score_pair(
        self,
        left: LabeledTemporalAnswer,
        right: LabeledTemporalAnswer,
        config: LabeledTemporalConfig,
    ) -> float:
        left_labels = sorted({region.label for region in left.regions})
        right_labels = sorted({region.label for region in right.regions})
        candidates = []
        for left_label in left_labels:
            for right_label in right_labels:
                overlap = sum(
                    interval_overlap(a.start, a.end, b.start, b.end)
                    for a in left.regions
                    if a.label == left_label
                    for b in right.regions
                    if b.label == right_label
                )
                candidates.append((overlap, left_label, right_label))
        candidates.sort(key=lambda value: (-value[0], value[1], value[2]))
        mapping: dict[str, str] = {}
        used_left: set[str] = set()
        for overlap, left_label, right_label in candidates:
            if overlap <= 0 or left_label in used_left or right_label in mapping:
                continue
            used_left.add(left_label)
            mapping[right_label] = left_label
        return greedy_region_match(
            left.regions,
            right.regions,
            lambda a, b: interval_iou(a.start, a.end, b.start, b.end)
            if mapping.get(b.label) == a.label
            else 0.0,
        )
