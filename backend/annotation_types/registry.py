from __future__ import annotations

from typing import Dict, Iterable

from modalities import REGISTRY as MODALITY_REGISTRY

from .base_type import BaseAnnotationType


class AnnotationTypeRegistry:
    def __init__(self) -> None:
        self._modules: Dict[str, BaseAnnotationType] = {}

    def register(self, module: BaseAnnotationType) -> BaseAnnotationType:
        if not isinstance(module, BaseAnnotationType):
            raise TypeError("annotation modules must inherit BaseAnnotationType")
        if not module.key or not module.key.strip():
            raise ValueError("annotation type key cannot be blank")
        if module.key in self._modules:
            raise ValueError(f"annotation type already registered: {module.key}")
        known_interactions = {
            interaction
            for modality in MODALITY_REGISTRY.values()
            for interaction in modality.supported_interactions
        }
        if module.required_interaction not in known_interactions:
            raise ValueError(
                f"unknown media interaction: {module.required_interaction}"
            )
        module.catalog_entry()
        self._modules[module.key] = module
        return module

    def get(self, key: str) -> BaseAnnotationType:
        try:
            return self._modules[key]
        except KeyError as exc:
            raise ValueError(f"Unknown annotation type: {key}") from exc

    def values(self) -> Iterable[BaseAnnotationType]:
        return self._modules.values()

    def as_dict(self) -> Dict[str, BaseAnnotationType]:
        return dict(self._modules)
