from typing import List, Literal, Type
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .base_type import BaseAnnotationType

class CategoricalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["categorical"]
    schema_version: Literal[1] = 1
    choices: List[str] = Field(min_length=1)
    multi_select: bool = False

    @field_validator("choices")
    @classmethod
    def validate_choices(cls, choices: List[str]) -> List[str]:
        normalized = [choice.strip() for choice in choices]
        if any(not choice for choice in normalized):
            raise ValueError("choices cannot contain blank values")
        if len(set(normalized)) != len(normalized):
            raise ValueError("choices must be unique")
        return normalized

class SingleChoiceAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str

class MultiChoiceAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: List[str]

class CategoricalType(BaseAnnotationType[CategoricalConfig, BaseModel]):
    key = "categorical"
    name = "Categorical"
    schema_version = 1
    required_interaction = "none"
    configuration_kind = "choices"
    supports_choices = True
    supports_multi_select = True
    config_model = CategoricalConfig
    answer_model = SingleChoiceAnswer

    def _get_answer_model(self, config: CategoricalConfig) -> Type[BaseModel]:
        return MultiChoiceAnswer if config.multi_select else SingleChoiceAnswer

    def _validate_semantics(
        self, answer: BaseModel, config: CategoricalConfig
    ) -> None:
        selected = answer.values if config.multi_select else [answer.value]
        unknown = sorted(set(selected) - set(config.choices))
        if unknown:
            raise ValueError(f"unknown choices: {', '.join(unknown)}")
        if len(selected) != len(set(selected)):
            raise ValueError("selected choices must be unique")

    def _score_pair(
        self, left: BaseModel, right: BaseModel, config: CategoricalConfig
    ) -> float:
        if config.multi_select:
            set1 = set(left.values)
            set2 = set(right.values)
            if not set1 and not set2:
                return 1.0
            return len(set1.intersection(set2)) / len(set1.union(set2))
        return 1.0 if left.value == right.value else 0.0
