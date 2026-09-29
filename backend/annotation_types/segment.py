from typing import List, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .base_type import BaseAnnotationType

class SegmentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["segment"]
    schema_version: Literal[1] = 1
    choices: List[str] = Field(min_length=1)
    multi_select: Literal[False] = False

    @field_validator("choices")
    @classmethod
    def validate_choices(cls, choices: List[str]) -> List[str]:
        normalized = [choice.strip() for choice in choices]
        if any(not choice for choice in normalized):
            raise ValueError("choices cannot contain blank values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("choices must be unique")
        return normalized

class Region(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def end_must_follow_start(self):
        if self.end <= self.start:
            raise ValueError("region end must be greater than start")
        return self

class SegmentAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    regions: List[Region]

def compute_iou(r1: Region, r2: Region) -> float:
    intersection = max(0.0, min(r1.end, r2.end) - max(r1.start, r2.start))
    union = (r1.end - r1.start) + (r2.end - r2.start) - intersection
    if union <= 0:
        return 0.0
    return intersection / union

def greedy_match_iou(regions_a: List[Region], regions_b: List[Region]) -> float:
    if not regions_a and not regions_b:
        return 1.0 # Both empty -> perfect match
    if not regions_a or not regions_b:
        return 0.0
        
    pairs = []
    for i, ra in enumerate(regions_a):
        for j, rb in enumerate(regions_b):
            iou = compute_iou(ra, rb)
            if iou > 0:
                pairs.append((iou, i, j))
                
    # Sort pairs by highest IoU first
    pairs.sort(key=lambda x: x[0], reverse=True)
    
    matched_a = set()
    matched_b = set()
    total_iou = 0.0
    
    for iou, i, j in pairs:
        if i not in matched_a and j not in matched_b:
            matched_a.add(i)
            matched_b.add(j)
            total_iou += iou
            
    max_len = max(len(regions_a), len(regions_b))
    return total_iou / max_len if max_len > 0 else 0.0

class SegmentType(BaseAnnotationType[SegmentConfig, SegmentAnswer]):
    key = "segment"
    name = "Segment / Region"
    schema_version = 1
    required_interaction = "temporal-regions"
    configuration_kind = "choices"
    supports_choices = True
    supports_multi_select = False
    config_model = SegmentConfig
    answer_model = SegmentAnswer

    def _validate_semantics(
        self, answer: SegmentAnswer, config: SegmentConfig
    ) -> None:
        if answer.label not in config.choices:
            raise ValueError(f"unknown choice: {answer.label}")

    def _score_pair(
        self, left: SegmentAnswer, right: SegmentAnswer, config: SegmentConfig
    ) -> float:
        if left.label != right.label:
            return 0.0
        return greedy_match_iou(left.regions, right.regions)
