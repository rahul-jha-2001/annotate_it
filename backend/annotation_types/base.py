from typing import Any, Dict, List, Type
from pydantic import BaseModel
from typing import Protocol

class AnnotationTypeSpec(Protocol):
    key: str
    name: str
    compatible_modalities: List[str]
    supports_choices: bool
    supports_multi_select: bool
    
    def get_answer_model(self, config: Dict[str, Any]) -> Type[BaseModel]:
        """
        Returns the Pydantic model that validates an answer for THIS
        experiment's config (e.g. multi_select True/False picks a
        different shape). Must be called with the experiment's
        label_schema dict; never assume a single static shape.
        """
        ...
        
    def gold_match(
        self, answer: Dict[str, Any], gold_answer: Dict[str, Any], config: Dict[str, Any]
    ) -> float:
        """Returns 0.0 to 1.0 correctness against gold standard."""
        ...
        
    def agreement(
        self, answers: List[Dict[str, Any]], config: Dict[str, Any]
    ) -> float:
        """Returns 0.0 to 1.0 inter-annotator agreement score."""
        ...
