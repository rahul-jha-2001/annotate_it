from typing import Any, Dict, List, Literal, Type
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

class SegmentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["segment"]
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

class SegmentType:
    key = "segment"
    name = "Segment / Region"
    compatible_modalities = ["audio", "video"]
    supports_choices = True
    supports_multi_select = False

    def validate_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return SegmentConfig.model_validate(config).model_dump()
    
    def get_answer_model(self, config: Dict[str, Any]) -> Type[BaseModel]:
        return SegmentAnswer

    def validate_answer(self, answer: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        validated_config = SegmentConfig.model_validate(config)
        parsed = SegmentAnswer.model_validate(answer)
        if parsed.label not in validated_config.choices:
            raise ValueError(f"unknown choice: {parsed.label}")
        return parsed.model_dump()
    
    def gold_match(self, answer: Dict[str, Any], gold_answer: Dict[str, Any], config: Dict[str, Any]) -> float:
        AnswerModel = self.get_answer_model(config)
        ans = AnswerModel(**answer)
        gold = AnswerModel(**gold_answer)
        
        if ans.label != gold.label:
            return 0.0
            
        return greedy_match_iou(ans.regions, gold.regions)
        
    def agreement(self, answers: List[Dict[str, Any]], config: Dict[str, Any]) -> float:
        if not answers:
            return 0.0
        if len(answers) == 1:
            return 1.0
            
        AnswerModel = self.get_answer_model(config)
        parsed = [AnswerModel(**a) for a in answers]
        total_score = 0.0
        pairs_count = 0
        
        for i in range(len(parsed)):
            for j in range(i + 1, len(parsed)):
                ans1 = parsed[i]
                ans2 = parsed[j]
                
                if ans1.label != ans2.label:
                    score = 0.0
                else:
                    score = greedy_match_iou(ans1.regions, ans2.regions)
                
                total_score += score
                pairs_count += 1
                
        return total_score / pairs_count if pairs_count > 0 else 0.0
