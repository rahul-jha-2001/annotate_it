import math
import unittest
from typing import Literal

from pydantic import BaseModel, ConfigDict

from annotation_types.base_type import BaseAnnotationType
from annotation_types.registry import AnnotationTypeRegistry


class DummyConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["dummy"]
    schema_version: Literal[1] = 1


class DummyAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str


class DummyType(BaseAnnotationType[DummyConfig, DummyAnswer]):
    key = "dummy"
    name = "Dummy"
    schema_version = 1
    required_interaction = "none"
    configuration_kind = "none"
    config_model = DummyConfig
    answer_model = DummyAnswer

    def _score_pair(self, left, right, config):
        return 1.0 if left.value == right.value else 0.0


class DifferentScoringType(DummyType):
    def _score_gold(self, answer, gold, config):
        return 0.25

    def _aggregate_agreement(self, answers, config):
        return 0.75


class VersionTwoConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotation_type: Literal["versioned"]
    schema_version: Literal[2]
    renamed: str


class VersionedType(BaseAnnotationType[VersionTwoConfig, DummyAnswer]):
    key = "versioned"
    name = "Versioned"
    schema_version = 2
    required_interaction = "none"
    configuration_kind = "none"
    config_model = VersionTwoConfig
    answer_model = DummyAnswer

    def _upgrade_config(self, raw, from_version):
        if from_version != 1:
            return raw
        upgraded = dict(raw)
        upgraded["renamed"] = upgraded.pop("old_name")
        return upgraded

    def _score_pair(self, left, right, config):
        return 1.0


class LooseConfig(BaseModel):
    annotation_type: str
    schema_version: int = 1


class LooseType(BaseAnnotationType[LooseConfig, DummyAnswer]):
    key = "loose"
    name = "Loose"
    schema_version = 1
    required_interaction = "none"
    config_model = LooseConfig
    answer_model = DummyAnswer

    def _score_pair(self, left, right, config):
        return 1.0


class AnnotationBaseTests(unittest.TestCase):
    def test_base_owns_validation_gold_agreement_and_catalog(self):
        module = DummyType()

        self.assertEqual(
            module.validate_config({"annotation_type": "dummy"}),
            {"annotation_type": "dummy", "schema_version": 1},
        )
        self.assertEqual(module.validate_answer({"value": "a"}, {"annotation_type": "dummy"}), {"value": "a"})
        self.assertEqual(module.validate_gold_answer({"value": "a"}, {"annotation_type": "dummy"}), {"value": "a"})
        self.assertEqual(module.gold_match({"value": "a"}, {"value": "a"}, {"annotation_type": "dummy"}), 1.0)
        self.assertAlmostEqual(
            module.agreement(
                [{"value": "a"}, {"value": "a"}, {"value": "b"}],
                {"annotation_type": "dummy"},
            ),
            1 / 3,
        )
        self.assertEqual(
            module.catalog_entry(),
            {
                "key": "dummy",
                "name": "Dummy",
                "schema_version": 1,
                "required_interaction": "none",
                "configuration_kind": "none",
                "supports_choices": False,
                "supports_multi_select": False,
            },
        )

    def test_gold_and_agreement_have_separate_strategy_hooks(self):
        module = DifferentScoringType()
        config = {"annotation_type": "dummy"}

        self.assertEqual(module.gold_match({"value": "a"}, {"value": "a"}, config), 0.25)
        self.assertEqual(module.agreement([{"value": "a"}, {"value": "b"}], config), 0.75)

    def test_schema_upgrade_runs_before_current_model_validation(self):
        self.assertEqual(
            VersionedType().validate_config(
                {"annotation_type": "versioned", "old_name": "kept"}
            ),
            {"annotation_type": "versioned", "schema_version": 2, "renamed": "kept"},
        )

    def test_base_rejects_a_schema_for_a_different_registered_key(self):
        with self.assertRaisesRegex(ValueError, "annotation_type"):
            LooseType().validate_config({"annotation_type": "someone-else"})

    def test_scores_must_be_finite_and_bounded(self):
        class InvalidScoreType(DummyType):
            def _score_pair(self, left, right, config):
                return math.nan

        with self.assertRaisesRegex(ValueError, "finite"):
            InvalidScoreType().gold_match(
                {"value": "a"}, {"value": "a"}, {"annotation_type": "dummy"}
            )

    def test_children_cannot_replace_public_lifecycle(self):
        with self.assertRaisesRegex(TypeError, "validate_answer"):
            class InvalidLifecycleType(DummyType):
                key = "invalid-lifecycle"

                def validate_answer(self, answer, config):
                    return answer

    def test_registry_rejects_duplicates_and_non_modules(self):
        registry = AnnotationTypeRegistry()
        registry.register(DummyType())

        with self.assertRaisesRegex(ValueError, "already registered"):
            registry.register(DummyType())
        with self.assertRaisesRegex(TypeError, "BaseAnnotationType"):
            registry.register(object())


if __name__ == "__main__":
    unittest.main()
