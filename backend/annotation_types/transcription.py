from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .base_type import BaseAnnotationType
from .scoring.text import normalize_text, word_edit_similarity


class TranscriptionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["transcription"]
    schema_version: Literal[1] = 1
    case_sensitive: bool = False
    collapse_whitespace: bool = True
    strip_punctuation: bool = False
    minimum_length: int = Field(default=1, ge=0, le=100_000)


class TranscriptionAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str


class TranscriptionType(
    BaseAnnotationType[TranscriptionConfig, TranscriptionAnswer]
):
    key = "transcription"
    name = "Transcription"
    schema_version = 1
    required_interaction = "none"
    configuration_kind = "text"
    config_model = TranscriptionConfig
    answer_model = TranscriptionAnswer

    @staticmethod
    def _normalize(answer: TranscriptionAnswer, config: TranscriptionConfig) -> str:
        return normalize_text(
            answer.text,
            case_sensitive=config.case_sensitive,
            collapse_whitespace=config.collapse_whitespace,
            strip_punctuation=config.strip_punctuation,
        )

    def _validate_semantics(
        self, answer: TranscriptionAnswer, config: TranscriptionConfig
    ) -> None:
        answer.text = self._normalize(answer, config)
        if len(answer.text) < config.minimum_length:
            raise ValueError(
                f"transcription minimum length is {config.minimum_length} characters"
            )

    def _score_pair(
        self,
        left: TranscriptionAnswer,
        right: TranscriptionAnswer,
        config: TranscriptionConfig,
    ) -> float:
        return word_edit_similarity(left.text, right.text)
