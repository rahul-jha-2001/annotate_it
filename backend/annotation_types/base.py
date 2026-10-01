from datetime import datetime
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel, Field
from typing import Protocol


class WeightedAnswer(BaseModel):
    annotation_id: str
    annotator_id: str
    answer: Dict[str, Any]
    weight: float = 1.0
    submitted_at: Optional[datetime] = None


class ConsensusDetails(BaseModel):
    method: str = "quality_weighted_medoid"
    algorithm_version: int = 1
    confidence: float
    agreement: float
    votes_total: int
    votes_used: int
    source_annotation_ids: List[str] = Field(default_factory=list)
    excluded_annotation_ids: List[str] = Field(default_factory=list)
    status: str = "accepted"
    warnings: List[str] = Field(default_factory=list)


class ConsensusResult(BaseModel):
    answer: Optional[Dict[str, Any]] = None
    consensus: ConsensusDetails


class AnnotationTypeSpec(Protocol):
    key: str
    name: str
    required_interaction: str
    required_media_capabilities: frozenset[str]
    schema_version: int
    configuration_kind: str
    supports_choices: bool
    supports_multi_select: bool

    def validate_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and normalize an experiment's label schema."""
        ...
    
    def get_answer_model(self, config: Dict[str, Any]) -> Type[BaseModel]:
        """
        Returns the Pydantic model that validates an answer for THIS
        experiment's config (e.g. multi_select True/False picks a
        different shape). Must be called with the experiment's
        label_schema dict; never assume a single static shape.
        """
        ...

    def validate_answer(
        self, answer: Dict[str, Any], config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate an answer, including constraints imposed by the config."""
        ...

    def validate_gold_answer(
        self, answer: Dict[str, Any], config: Dict[str, Any]
    ) -> Dict[str, Any]:
        ...

    def catalog_entry(self) -> Dict[str, Any]:
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

    def consensus(
        self, answers: List[WeightedAnswer | Dict[str, Any]], config: Dict[str, Any]
    ) -> ConsensusResult:
        """Computes quality-weighted-medoid consensus over submitted answers."""
        ...
