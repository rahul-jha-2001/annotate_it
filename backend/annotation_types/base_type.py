from __future__ import annotations

import math
from abc import ABC, abstractmethod
from typing import Any, ClassVar, Dict, Generic, List, Type, TypeVar, final

from pydantic import BaseModel

from .base import ConsensusDetails, ConsensusResult, WeightedAnswer


ConfigT = TypeVar("ConfigT", bound=BaseModel)
AnswerT = TypeVar("AnswerT", bound=BaseModel)


class BaseAnnotationType(ABC, Generic[ConfigT, AnswerT]):
    """Template lifecycle shared by every backend annotation type."""

    key: ClassVar[str]
    name: ClassVar[str]
    schema_version: ClassVar[int]
    required_interaction: ClassVar[str]
    required_media_capabilities: ClassVar[frozenset[str]] = frozenset()
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
            "consensus",
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
        if raw.get("annotation_type") != self.key:
            raise ValueError(
                f"annotation_type must match registered module key {self.key!r}"
            )
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
        return self._parse_answer(answer, parsed_config).model_dump(
            mode="json", exclude_none=True
        )

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
    def consensus(
        self,
        answers: List[WeightedAnswer | Dict[str, Any]],
        config: Dict[str, Any],
    ) -> ConsensusResult:
        parsed_config = self.config_model.model_validate(
            self._normalize_config_version(config)
        )
        normalized_answers: List[WeightedAnswer] = []
        parsed_answer_models: List[AnswerT] = []

        for item in answers:
            wa = item if isinstance(item, WeightedAnswer) else WeightedAnswer.model_validate(item)
            w = float(wa.weight)
            if not math.isfinite(w) or w < 0.0:
                raise ValueError(
                    f"Invalid weight {wa.weight}: weight must be a finite, non-negative number"
                )
            parsed_ans = self._parse_answer(wa.answer, parsed_config)
            normalized_answers.append(wa)
            parsed_answer_models.append(parsed_ans)

        if not normalized_answers:
            return ConsensusResult(
                answer=None,
                consensus=ConsensusDetails(
                    method="quality_weighted_medoid",
                    algorithm_version=1,
                    confidence=0.0,
                    agreement=0.0,
                    votes_total=0,
                    votes_used=0,
                    source_annotation_ids=[],
                    excluded_annotation_ids=[],
                    status="needs_review_no_eligible_annotations",
                    warnings=["No eligible annotations"],
                ),
            )

        if len(normalized_answers) == 1:
            winner_wa = normalized_answers[0]
            validated_winner = self.validate_answer(winner_wa.answer, config)
            return ConsensusResult(
                answer=validated_winner,
                consensus=ConsensusDetails(
                    method="quality_weighted_medoid",
                    algorithm_version=1,
                    confidence=1.0,
                    agreement=1.0,
                    votes_total=1,
                    votes_used=1,
                    source_annotation_ids=[winner_wa.annotation_id],
                    excluded_annotation_ids=[],
                    status="accepted",
                    warnings=[],
                ),
            )

        overall_agreement = self._checked_score(
            self._aggregate_agreement(parsed_answer_models, parsed_config)
        )

        winner_wa, confidence, status, source_ids, warnings = self._select_consensus_candidate(
            normalized_answers, parsed_answer_models, parsed_config
        )

        validated_winner = None
        if winner_wa is not None:
            validated_winner = self.validate_answer(winner_wa.answer, config)

        return ConsensusResult(
            answer=validated_winner,
            consensus=ConsensusDetails(
                method="quality_weighted_medoid",
                algorithm_version=1,
                confidence=round(confidence, 4),
                agreement=round(overall_agreement, 4),
                votes_total=len(normalized_answers),
                votes_used=len(normalized_answers),
                source_annotation_ids=source_ids,
                excluded_annotation_ids=[],
                status=status,
                warnings=warnings,
            ),
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

    def _select_consensus_candidate(
        self,
        answers: List[WeightedAnswer],
        parsed_answers: List[AnswerT],
        config: ConfigT,
    ) -> tuple[Optional[WeightedAnswer], float, str, List[str], List[str]]:
        n = len(answers)
        sim_matrix = [[0.0] * n for _ in range(n)]
        for i in range(n):
            sim_matrix[i][i] = 1.0
            for j in range(i + 1, n):
                s = self._checked_score(
                    self._score_pair(parsed_answers[i], parsed_answers[j], config)
                )
                sim_matrix[i][j] = s
                sim_matrix[j][i] = s

        scores: List[float] = []
        for i in range(n):
            other_weight_sum = sum(answers[j].weight for j in range(n) if j != i)
            if other_weight_sum > 0:
                weighted_sim = sum(
                    answers[j].weight * sim_matrix[i][j]
                    for j in range(n)
                    if j != i
                )
                s_i = weighted_sim / other_weight_sum
            else:
                s_i = sum(sim_matrix[i][j] for j in range(n) if j != i) / (n - 1)
            scores.append(s_i)

        max_score = max(scores)
        top_indices = [idx for idx, s in enumerate(scores) if abs(s - max_score) <= 1e-7]

        # Check if all top candidates are identical (pairwise similarity == 1.0)
        all_identical = True
        for a_idx in range(len(top_indices)):
            for b_idx in range(a_idx + 1, len(top_indices)):
                if abs(sim_matrix[top_indices[a_idx]][top_indices[b_idx]] - 1.0) > 1e-7:
                    all_identical = False
                    break
            if not all_identical:
                break

        if not all_identical:
            tied_candidates = sorted(
                [answers[idx] for idx in top_indices],
                key=lambda c: (
                    c.submitted_at.isoformat() if c.submitted_at else "",
                    str(c.annotation_id),
                ),
            )
            return (
                None,
                max_score,
                "needs_review_tie",
                [c.annotation_id for c in tied_candidates],
                ["Tie between non-identical candidates with equal score"],
            )

        top_candidates = [answers[idx] for idx in top_indices]
        top_candidates.sort(
            key=lambda c: (
                c.submitted_at.isoformat() if c.submitted_at else "",
                str(c.annotation_id),
            )
        )
        winner = top_candidates[0]
        all_ids = [a.annotation_id for a in answers]
        return (winner, max_score, "accepted", all_ids, [])

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
