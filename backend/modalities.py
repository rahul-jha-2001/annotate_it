from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class ModalitySpec:
    key: str
    name: str
    supported_interactions: List[str]
    available: bool = True
    capabilities: frozenset[str] = frozenset()


REGISTRY: Dict[str, ModalitySpec] = {
    "audio": ModalitySpec("audio", "Audio", ["none", "temporal-regions", "labeled-temporal-regions"], True, frozenset({"audio-content"})),
    "video": ModalitySpec("video", "Video", ["none", "temporal-regions", "labeled-temporal-regions", "spatial-shapes"], True, frozenset({"audio-content", "visual-content"})),
    "image": ModalitySpec("image", "Image", ["none", "spatial-shapes"], True, frozenset({"visual-content"})),
    "text": ModalitySpec("text", "Text", ["none", "text-ranges"], False, frozenset({"text-content"})),
}


def get_modality(key: str) -> ModalitySpec:
    if key not in REGISTRY:
        raise ValueError(f"Unknown modality: {key}")
    return REGISTRY[key]


def get_modalities_for_interaction(interaction: str) -> List[str]:
    return [
        key for key, spec in REGISTRY.items()
        if spec.available and interaction in spec.supported_interactions
    ]
