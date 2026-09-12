from typing import Dict, List
from .base import AnnotationTypeSpec
from .base_type import BaseAnnotationType
from .registry import AnnotationTypeRegistry
from .segment import SegmentType
from .categorical import CategoricalType
from .transcription import TranscriptionType
from modalities import get_modalities_for_interaction, get_modality

_registry = AnnotationTypeRegistry()
_registry.register(SegmentType())
_registry.register(CategoricalType())
_registry.register(TranscriptionType())
REGISTRY: Dict[str, BaseAnnotationType] = _registry.as_dict()

def get_type(key: str) -> AnnotationTypeSpec:
    return _registry.get(key)

def list_types() -> List[BaseAnnotationType]:
    return list(_registry.values())

def get_valid_types_for_modality(modality: str) -> List[str]:
    try:
        modality_spec = get_modality(modality)
    except ValueError:
        return []
    if not modality_spec.available:
        return []
    supported = modality_spec.supported_interactions
    return [key for key, spec in REGISTRY.items() if spec.required_interaction in supported]

def get_compatible_modalities(annotation_type: AnnotationTypeSpec) -> List[str]:
    return get_modalities_for_interaction(annotation_type.required_interaction)
