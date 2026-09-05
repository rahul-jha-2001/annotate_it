from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class ModalitySpec:
    key: str
    name: str
    supported_interactions: List[str]


REGISTRY: Dict[str, ModalitySpec] = {
    "audio": ModalitySpec("audio", "Audio", ["none", "temporal-regions"]),
    "video": ModalitySpec("video", "Video", ["none", "temporal-regions", "spatial-shapes"]),
    "image": ModalitySpec("image", "Image", ["none", "spatial-shapes"]),
    "text": ModalitySpec("text", "Text", ["none", "text-ranges"]),
}


def get_modality(key: str) -> ModalitySpec:
    if key not in REGISTRY:
        raise ValueError(f"Unknown modality: {key}")
    return REGISTRY[key]


def get_modalities_for_interaction(interaction: str) -> List[str]:
    return [
        key for key, spec in REGISTRY.items()
        if interaction in spec.supported_interactions
    ]
