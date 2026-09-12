from __future__ import annotations

import math
from abc import ABC, abstractmethod
from typing import Any, ClassVar, Dict, Generic, List, Type, TypeVar, final

from pydantic import BaseModel


ConfigT = TypeVar("ConfigT", bound=BaseModel)
AnswerT = TypeVar("AnswerT", bound=BaseModel)


class BaseAnnotationType(ABC, Generic[ConfigT, AnswerT]):
    """Template lifecycle shared by every backend annotation type."""

    key: ClassVar[str]
    name: ClassVar[str]
    schema_version: ClassVar[int]
    required_interaction: ClassVar[str]
    configuration_kind: ClassVar[str] = "custom"
    supports_choices: ClassVar[bool] = False
    supports_multi_select: ClassVar[bool] = False
    config_model: ClassVar[Type[ConfigT]]
    answer_model: ClassVar[Type[AnswerT]]

    _PUBLIC_LIFECYCLE = frozenset(
        {
            "validate_config",
            "validate_answer",
            "validate_gold_answer",
            "gold_match",
            "agreement",
            "catalog_entry",
        }
    )

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        forbidden = BaseAnnotationType._PUBLIC_LIFECYCLE.intersection(cls.__dict__)
        if forbidden:
            names = ", ".join(sorted(forbidden))
            raise TypeError(
                f"{cls.__name__} cannot override base lifecycle method(s): {names}"
            )

    @final
    def validate_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        raw = self._normalize_config_version(config)
        return self.config_model.model_validate(raw).model_dump(mode="json")

    def _normalize_config_version(self, config: Dict[str, Any]) -> Dict[str, Any]:
        raw = dict(config)
        version = raw.get("schema_version", 1)
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise ValueError("schema_version must be a positive integer")
        if version > self.schema_version:
            raise ValueError(
                f"schema version {version} is newer than supported version {self.schema_version}"
            )
        while version < self.schema_version:
            raw = dict(self._upgrade_config(raw, version))
            version += 1
            raw["schema_version"] = version
        raw.setdefault("schema_version", self.schema_version)
        return raw

    def _upgrade_config(
        self, raw: Dict[str, Any], from_version: int
    ) -> Dict[str, Any]:
        raise ValueError(
            f"{self.key} does not provide an upgrade from schema version {from_version}"
        )

    def _get_answer_model(self, config: ConfigT) -> Type[AnswerT]:
        return self.answer_model

    def _parse_answer(self, answer: Dict[str, Any], config: ConfigT) -> AnswerT:
        parsed = self._get_answer_model(config).model_validate(answer)
        self._validate_semantics(parsed, config)
        return parsed

    @final
    def validate_answer(
        self, answer: Dict[str, Any], config: Dict[str, Any]
    ) -> Dict[str, Any]:
        parsed_config = self.config_model.model_validate(
            self._normalize_config_version(config)
        )
        return self._parse_answer(answer, parsed_config).model_dump(mode="json")

    @final
    def validate_gold_answer(
        self, answer: Dict[str, Any], config: Dict[str, Any]
    ) -> Dict[str, Any]:
        return self.validate_answer(answer, config)

    @final
    def gold_match(
        self,
        answer: Dict[str, Any],
        gold_answer: Dict[str, Any],
        config: Dict[str, Any],
    ) -> float:
        parsed_config = self.config_model.model_validate(
            self._normalize_config_version(config)
        )
        parsed_answer = self._parse_answer(answer, parsed_config)
        parsed_gold = self._parse_answer(gold_answer, parsed_config)
        return self._checked_score(
            self._score_gold(parsed_answer, parsed_gold, parsed_config)
        )

    @final
    def agreement(
        self, answers: List[Dict[str, Any]], config: Dict[str, Any]
    ) -> float:
        parsed_config = self.config_model.model_validate(
            self._normalize_config_version(config)
        )
        parsed_answers = [
            self._parse_answer(answer, parsed_config) for answer in answers
        ]
        return self._checked_score(
            self._aggregate_agreement(parsed_answers, parsed_config)
        )

    @final
    def catalog_entry(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "name": self.name,
            "schema_version": self.schema_version,
            "required_interaction": self.required_interaction,
            "configuration_kind": self.configuration_kind,
            "supports_choices": self.supports_choices,
            "supports_multi_select": self.supports_multi_select,
        }

    def _validate_semantics(self, answer: AnswerT, config: ConfigT) -> None:
        return None

    def _score_gold(
        self, answer: AnswerT, gold: AnswerT, config: ConfigT
    ) -> float:
        return self._score_pair(answer, gold, config)

    def _aggregate_agreement(
        self, answers: List[AnswerT], config: ConfigT
    ) -> float:
        if not answers:
            return 0.0
        if len(answers) == 1:
            return 1.0
        scores = [
            self._checked_score(self._score_pair(answers[i], answers[j], config))
            for i in range(len(answers))
            for j in range(i + 1, len(answers))
        ]
        return sum(scores) / len(scores)

    @abstractmethod
    def _score_pair(
        self, left: AnswerT, right: AnswerT, config: ConfigT
    ) -> float:
        raise NotImplementedError

    @staticmethod
    def _checked_score(score: float) -> float:
        value = float(score)
        if not math.isfinite(value):
            raise ValueError("annotation score must be finite")
        if value < 0.0 or value > 1.0:
            raise ValueError("annotation score must be between 0 and 1")
        return value
