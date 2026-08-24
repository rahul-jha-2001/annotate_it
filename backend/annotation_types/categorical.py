from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel

class SingleChoiceAnswer(BaseModel):
    value: str

class MultiChoiceAnswer(BaseModel):
    values: List[str]

class CategoricalType:
    key = "categorical"
    name = "Categorical"
    compatible_modalities = ["audio", "video", "image", "text"]
    supports_choices = True
    supports_multi_select = True
    
    def get_answer_model(self, config: Dict[str, Any]) -> Type[BaseModel]:
        return MultiChoiceAnswer if config.get("multi_select") else SingleChoiceAnswer
    
    def gold_match(self, answer: Dict[str, Any], gold_answer: Dict[str, Any], config: Dict[str, Any]) -> float:
        AnswerModel = self.get_answer_model(config)
        ans = AnswerModel(**answer)
        gold = AnswerModel(**gold_answer)
        
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
