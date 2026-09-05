from typing import Any, Dict, List, Literal, Type
from pydantic import BaseModel, ConfigDict, Field, field_validator

class CategoricalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["categorical"]
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

class CategoricalType:
    key = "categorical"
    name = "Categorical"
    required_interaction = "none"
    supports_choices = True
    supports_multi_select = True

    def validate_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        return CategoricalConfig.model_validate(config).model_dump()
    
    def get_answer_model(self, config: Dict[str, Any]) -> Type[BaseModel]:
        return MultiChoiceAnswer if config.get("multi_select") else SingleChoiceAnswer

    def validate_answer(self, answer: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        validated_config = CategoricalConfig.model_validate(config)
        parsed = self.get_answer_model(config).model_validate(answer)
        selected = parsed.values if validated_config.multi_select else [parsed.value]
        unknown = sorted(set(selected) - set(validated_config.choices))
        if unknown:
            raise ValueError(f"unknown choices: {', '.join(unknown)}")
        if len(selected) != len(set(selected)):
            raise ValueError("selected choices must be unique")
        return parsed.model_dump()
    
    def gold_match(self, answer: Dict[str, Any], gold_answer: Dict[str, Any], config: Dict[str, Any]) -> float:
        AnswerModel = self.get_answer_model(config)
        ans = AnswerModel.model_validate(answer)
        gold = AnswerModel.model_validate(gold_answer)
        
        if config.get("multi_select"):
            set1 = set(ans.values)
            set2 = set(gold.values)
            if not set1 and not set2:
                return 1.0
            return len(set1.intersection(set2)) / len(set1.union(set2))
            
        return 1.0 if ans.value == gold.value else 0.0
        
    def agreement(self, answers: List[Dict[str, Any]], config: Dict[str, Any]) -> float:
        if not answers:
            return 0.0
        if len(answers) == 1:
            return 1.0
            
        AnswerModel = self.get_answer_model(config)
        parsed = [AnswerModel(**a) for a in answers]
        
        total_pairs = 0
        matching_score = 0.0
        
        for i in range(len(parsed)):
            for j in range(i + 1, len(parsed)):
                if config.get("multi_select"):
                    set1 = set(parsed[i].values)
                    set2 = set(parsed[j].values)
                    if not set1 and not set2:
                        matching_score += 1.0
                    else:
                        matching_score += len(set1.intersection(set2)) / len(set1.union(set2))
                else:
                    if parsed[i].value == parsed[j].value:
                        matching_score += 1.0
                total_pairs += 1
                
        return matching_score / total_pairs if total_pairs > 0 else 0.0
