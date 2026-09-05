import unittest

from pydantic import ValidationError

from annotation_types.categorical import CategoricalType
from annotation_types.segment import Region, SegmentType, compute_iou, greedy_match_iou
from schema_compat import normalize_label_schema
from services.qualifications import (
    sample_matches_qualifications,
    validate_qualification_answers,
    validate_sample_metadata,
)


class CategoricalTypeTests(unittest.TestCase):
    def setUp(self):
        self.spec = CategoricalType()
        self.single_config = {
            "annotation_type": "categorical",
            "choices": ["Good", "Bad"],
            "multi_select": False,
        }

    def test_single_and_multi_answers_have_distinct_shapes(self):
        self.assertEqual(
            self.spec.validate_answer({"value": "Good"}, self.single_config),
            {"value": "Good"},
        )
        with self.assertRaises(ValidationError):
            self.spec.validate_answer({"values": ["Good"]}, self.single_config)

    def test_unknown_and_duplicate_choices_are_rejected(self):
        with self.assertRaises(ValueError):
            self.spec.validate_answer({"value": "Unknown"}, self.single_config)
        multi_config = {**self.single_config, "multi_select": True}
        with self.assertRaises(ValueError):
            self.spec.validate_answer({"values": ["Good", "Good"]}, multi_config)

    def test_multi_choice_uses_jaccard_similarity(self):
        config = {**self.single_config, "multi_select": True}
        score = self.spec.gold_match(
            {"values": ["Good"]}, {"values": ["Good", "Bad"]}, config
        )
        self.assertEqual(score, 0.5)


class SegmentTypeTests(unittest.TestCase):
    def setUp(self):
        self.spec = SegmentType()
        self.config = {
            "annotation_type": "segment",
            "choices": ["Speech"],
            "multi_select": False,
        }

    def test_invalid_boundaries_and_labels_are_rejected(self):
        with self.assertRaises(ValidationError):
            self.spec.validate_answer(
                {"label": "Speech", "regions": [{"start": 2, "end": 1}]},
                self.config,
            )
        with self.assertRaises(ValueError):
            self.spec.validate_answer(
                {"label": "Music", "regions": [{"start": 0, "end": 1}]},
                self.config,
            )

    def test_iou_and_unmatched_regions(self):
        self.assertAlmostEqual(compute_iou(Region(start=0, end=2), Region(start=1, end=3)), 1 / 3)
        score = greedy_match_iou(
            [Region(start=0, end=1), Region(start=2, end=3)],
            [Region(start=0, end=1)],
        )
        self.assertEqual(score, 0.5)


class LegacySchemaTests(unittest.TestCase):
    def test_list_schema_is_normalized(self):
        self.assertEqual(
            normalize_label_schema([
                {"name": "Category 1", "type": "categorical"},
                {"name": "Category 2", "type": "categorical"},
            ]),
            {
                "annotation_type": "categorical",
                "choices": ["Category 1", "Category 2"],
                "multi_select": False,
            },
        )

    def test_mixed_legacy_types_are_rejected(self):
        with self.assertRaises(ValueError):
            normalize_label_schema([
                {"name": "One", "type": "categorical"},
                {"name": "Two", "type": "segment"},
            ])


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.metadata_schema = [
            {"key": "language", "label": "Language", "type": "choice", "options": ["Hindi", "English"]},
            {"key": "difficulty", "label": "Difficulty", "type": "number", "options": []},
        ]
        self.form = [
            {"key": "languages", "label": "Languages", "type": "multi_choice", "required": True, "options": ["Hindi", "English"]},
            {"key": "proficiency", "label": "Proficiency", "type": "number", "required": True, "options": [], "minimum": 1, "maximum": 5},
        ]

    def test_metadata_and_answers_are_validated(self):
        self.assertEqual(
            validate_sample_metadata({"language": "Hindi", "difficulty": 3}, self.metadata_schema),
            {"language": "Hindi", "difficulty": 3},
        )
        with self.assertRaises(ValueError):
            validate_sample_metadata({"language": "French"}, self.metadata_schema)
        with self.assertRaises(ValueError):
            validate_qualification_answers({"languages": ["Hindi"], "proficiency": 7}, self.form)

    def test_all_routing_rules_must_match(self):
        rules = [
            {"metadata_field": "language", "operator": "in", "question_key": "languages"},
            {"metadata_field": "difficulty", "operator": "gte", "question_key": "proficiency"},
        ]
        answers = {"languages": ["Hindi"], "proficiency": 4}
        self.assertTrue(sample_matches_qualifications({"language": "Hindi", "difficulty": 3}, answers, rules))
        self.assertFalse(sample_matches_qualifications({"language": "English", "difficulty": 3}, answers, rules))
        self.assertFalse(sample_matches_qualifications({"language": "Hindi", "difficulty": 5}, answers, rules))


if __name__ == "__main__":
    unittest.main()
