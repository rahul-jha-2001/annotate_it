from typing import Dict, List
from .base import AnnotationTypeSpec
from .segment import SegmentType
from .categorical import CategoricalType

REGISTRY: Dict[str, AnnotationTypeSpec] = {
    "segment": SegmentType(),
    "categorical": CategoricalType(),
}

def get_type(key: str) -> AnnotationTypeSpec:
    if key not in REGISTRY:
        raise ValueError(f"Unknown annotation type: {key}")
    return REGISTRY[key]

def get_valid_types_for_modality(modality: str) -> List[str]:
    return [key for key, spec in REGISTRY.items() if modality in spec.compatible_modalities]
