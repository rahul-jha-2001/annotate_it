import datetime
import pytest

from annotation_types import REGISTRY, get_type
from annotation_types.base import WeightedAnswer, ConsensusResult
from annotation_types.base_type import BaseAnnotationType


def test_public_lifecycle_cannot_be_overridden():
    with pytest.raises(TypeError, match="cannot override base lifecycle method"):
        class BadType(BaseAnnotationType):
            key = "bad"
            name = "Bad"
            schema_version = 1
            required_interaction = "none"

            def consensus(self, answers, config):
                pass


def test_categorical_weighted_consensus():
    cat = get_type("categorical")
    config = {
        "annotation_type": "categorical",
        "schema_version": 1,
        "choices": ["cat", "dog", "bird"],
    }

    t0 = datetime.datetime(2026, 9, 30, 10, 0, 0, tzinfo=datetime.timezone.utc)
    t1 = datetime.datetime(2026, 9, 30, 10, 1, 0, tzinfo=datetime.timezone.utc)
    t2 = datetime.datetime(2026, 9, 30, 10, 2, 0, tzinfo=datetime.timezone.utc)

    # 1 says dog (weight 0.4), 2 say cat (weights 0.9, 0.8)
    answers = [
        WeightedAnswer(
            annotation_id="ann-1",
            annotator_id="user-1",
            answer={"value": "dog"},
            weight=0.4,
            submitted_at=t0,
        ),
        WeightedAnswer(
            annotation_id="ann-2",
            annotator_id="user-2",
            answer={"value": "cat"},
            weight=0.9,
            submitted_at=t1,
        ),
        WeightedAnswer(
            annotation_id="ann-3",
            annotator_id="user-3",
            answer={"value": "cat"},
            weight=0.8,
            submitted_at=t2,
        ),
    ]

    res = cat.consensus(answers, config)
    assert isinstance(res, ConsensusResult)
    assert res.consensus.status == "accepted"
    assert res.answer == {"value": "cat"}
    assert res.consensus.votes_total == 3
    assert res.consensus.votes_used == 3
    assert res.consensus.confidence > 0.0


def test_tie_between_different_answers_is_unresolved():
    cat = get_type("categorical")
    config = {
        "annotation_type": "categorical",
        "schema_version": 1,
        "choices": ["cat", "dog"],
    }
    t0 = datetime.datetime(2026, 9, 30, 10, 0, 0, tzinfo=datetime.timezone.utc)
    t1 = datetime.datetime(2026, 9, 30, 10, 1, 0, tzinfo=datetime.timezone.utc)

    answers = [
        WeightedAnswer(
            annotation_id="ann-1",
            annotator_id="user-1",
            answer={"value": "dog"},
            weight=1.0,
            submitted_at=t0,
        ),
        WeightedAnswer(
            annotation_id="ann-2",
            annotator_id="user-2",
            answer={"value": "cat"},
            weight=1.0,
            submitted_at=t1,
        ),
    ]

    res = cat.consensus(answers, config)
    assert res.consensus.status == "needs_review_tie"
    assert res.answer is None
    assert "Tie" in res.consensus.warnings[0]
    assert len(res.consensus.source_annotation_ids) == 2


def test_tie_between_identical_answers_is_broken_deterministically():
    cat = get_type("categorical")
    config = {
        "annotation_type": "categorical",
        "schema_version": 1,
        "choices": ["cat", "dog"],
    }
    t0 = datetime.datetime(2026, 9, 30, 10, 0, 0, tzinfo=datetime.timezone.utc)
    t1 = datetime.datetime(2026, 9, 30, 10, 1, 0, tzinfo=datetime.timezone.utc)

    answers = [
        WeightedAnswer(
            annotation_id="ann-b",
            annotator_id="user-2",
            answer={"value": "cat"},
            weight=1.0,
            submitted_at=t1,
        ),
        WeightedAnswer(
            annotation_id="ann-a",
            annotator_id="user-1",
            answer={"value": "cat"},
            weight=1.0,
            submitted_at=t0,
        ),
    ]

    res = cat.consensus(answers, config)
    assert res.consensus.status == "accepted"
    assert res.answer == {"value": "cat"}
    assert res.consensus.confidence == 1.0
    assert res.consensus.agreement == 1.0


def test_invalid_weights_raise_value_error():
    cat = get_type("categorical")
    config = {
        "annotation_type": "categorical",
        "schema_version": 1,
        "choices": ["cat"],
    }
    with pytest.raises(ValueError, match="finite"):
        cat.consensus(
            [
                WeightedAnswer(
                    annotation_id="1",
                    annotator_id="u1",
                    answer={"value": "cat"},
                    weight=float("nan"),
                )
            ],
            config,
        )

    with pytest.raises(ValueError, match="non-negative"):
        cat.consensus(
            [
                WeightedAnswer(
                    annotation_id="1",
                    annotator_id="u1",
                    answer={"value": "cat"},
                    weight=-0.5,
                )
            ],
            config,
        )


def test_single_and_empty_answers():
    cat = get_type("categorical")
    config = {
        "annotation_type": "categorical",
        "schema_version": 1,
        "choices": ["cat"],
    }

    # Empty
    empty_res = cat.consensus([], config)
    assert empty_res.consensus.status == "needs_review_no_eligible_annotations"
    assert empty_res.answer is None

    # Single
    single_res = cat.consensus(
        [
            WeightedAnswer(
                annotation_id="1",
                annotator_id="u1",
                answer={"value": "cat"},
                weight=1.0,
            )
        ],
        config,
    )
    assert single_res.consensus.status == "accepted"
    assert single_res.answer == {"value": "cat"}
    assert single_res.consensus.confidence == 1.0


def test_every_registered_module_supports_consensus():
    """Contract test: every registered annotation module must compute consensus successfully."""
    configs_and_samples = {
        "categorical": (
            {
                "annotation_type": "categorical",
                "schema_version": 1,
                "choices": ["yes", "no"],
            },
            {"value": "yes"},
        ),
        "transcription": (
            {
                "annotation_type": "transcription",
                "schema_version": 1,
            },
            {"text": "Hello world from audio."},
        ),
        "bounding_box": (
            {
                "annotation_type": "bounding_box",
                "schema_version": 1,
                "choices": ["Car"],
            },
            {
                "boxes": [
                    {"id": "box-1", "label": "Car", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
                ]
            },
        ),
        "segment": (
            {
                "annotation_type": "segment",
                "schema_version": 1,
                "choices": ["Speech"],
            },
            {
                "label": "Speech",
                "regions": [
                    {"start": 1.0, "end": 4.5}
                ]
            },
        ),
        "sound_event": (
            {
                "annotation_type": "sound_event",
                "schema_version": 1,
                "choices": ["Speech"],
            },
            {
                "regions": [
                    {"start": 0.5, "end": 2.5, "label": "Speech"}
                ]
            },
        ),
    }

    for key, (config, sample_answer) in configs_and_samples.items():
        module = REGISTRY[key]
        validated_config = module.validate_config(config)
        validated_ans = module.validate_answer(sample_answer, validated_config)

        answers = [
            WeightedAnswer(
                annotation_id="ann-1",
                annotator_id="u1",
                answer=validated_ans,
                weight=1.0,
            ),
            WeightedAnswer(
                annotation_id="ann-2",
                annotator_id="u2",
                answer=validated_ans,
                weight=1.2,
            ),
        ]
        res = module.consensus(answers, validated_config)
        assert isinstance(res, ConsensusResult)
        assert res.consensus.status == "accepted"
        assert res.answer is not None
        assert res.consensus.confidence == 1.0

