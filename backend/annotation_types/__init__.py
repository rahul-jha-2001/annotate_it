from typing import Dict, List
from .base import AnnotationTypeSpec
from .segment import SegmentType
from .categorical import CategoricalType
from modalities import get_modalities_for_interaction, get_modality

REGISTRY: Dict[str, AnnotationTypeSpec] = {
    "segment": SegmentType(),
    "categorical": CategoricalType(),
}

def get_type(key: str) -> AnnotationTypeSpec:
    if key not in REGISTRY:
        raise ValueError(f"Unknown annotation type: {key}")
    return REGISTRY[key]

def get_valid_types_for_modality(modality: str) -> List[str]:
    try:
        supported = get_modality(modality).supported_interactions
    except ValueError:
        return []
    return [key for key, spec in REGISTRY.items() if spec.required_interaction in supported]

def get_compatible_modalities(annotation_type: AnnotationTypeSpec) -> List[str]:
    return get_modalities_for_interaction(annotation_type.required_interaction)
