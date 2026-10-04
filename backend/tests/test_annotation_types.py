import unittest

from pydantic import ValidationError

from annotation_types.categorical import CategoricalType
from annotation_types import get_compatible_modalities, get_valid_types_for_modality
from annotation_types.base_type import BaseAnnotationType
from annotation_types.segment import Region, SegmentType, compute_iou, greedy_match_iou
from modalities import get_modalities_for_interaction, get_modality
from schemas import AnnotationTypeResponse
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

    def test_type_inherits_lifecycle_and_accepts_schema_version(self):
        self.assertIsInstance(self.spec, BaseAnnotationType)
        self.assertEqual(
            self.spec.validate_config({**self.single_config, "schema_version": 1}),
            {**self.single_config, "schema_version": 1},
        )


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

    def test_type_inherits_lifecycle_and_accepts_schema_version(self):
        self.assertIsInstance(self.spec, BaseAnnotationType)
        self.assertEqual(
            self.spec.validate_config({**self.config, "schema_version": 1}),
            {**self.config, "schema_version": 1},
        )


class ModalityCapabilityTests(unittest.TestCase):
    def test_video_supports_categorical_and_temporal_segments(self):
        self.assertIn("categorical", get_valid_types_for_modality("video"))
        self.assertIn("segment", get_valid_types_for_modality("video"))
        self.assertIn("temporal-regions", get_modality("video").supported_interactions)

    def test_compatibility_is_derived_from_required_interaction(self):
        self.assertEqual(
            get_compatible_modalities(SegmentType()),
            ["audio", "video"],
        )
        self.assertEqual(get_valid_types_for_modality("unknown"), [])

    def test_unimplemented_modalities_are_not_advertised_as_compatible(self):
        self.assertFalse(get_modality("text").available)
        self.assertEqual(get_modalities_for_interaction("text-ranges"), [])

    def test_catalog_response_accepts_base_owned_metadata(self):
        entry = CategoricalType().catalog_entry()
        entry["compatible_modalities"] = get_compatible_modalities(CategoricalType())
        response = AnnotationTypeResponse.model_validate(entry)

        self.assertEqual(response.schema_version, 1)
        self.assertEqual(response.configuration_kind, "choices")


class LegacySchemaTests(unittest.TestCase):
    def test_list_schema_is_normalized(self):
        self.assertEqual(
            normalize_label_schema([
                {"name": "Category 1", "type": "categorical"},
                {"name": "Category 2", "type": "categorical"},
            ]),
            {
                "annotation_type": "categorical",
                "schema_version": 1,
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
            {"key": "experience", "label": "Experience", "type": "text", "required": True, "options": []},
        ]

    def test_metadata_and_answers_are_validated(self):
        self.assertEqual(
            validate_sample_metadata({"language": "Hindi", "difficulty": 3}, self.metadata_schema),
            {"language": "Hindi", "difficulty": 3},
        )
        # Arbitrary fields not defined in schema (or when schema is empty) are accepted as-is
        self.assertEqual(
            validate_sample_metadata({"content_type": "podcast", "custom_tag": "val"}, []),
            {"content_type": "podcast", "custom_tag": "val"},
        )
        self.assertEqual(
            validate_sample_metadata({"language": "Hindi", "extra_info": "123"}, self.metadata_schema),
            {"language": "Hindi", "extra_info": "123"},
        )
        with self.assertRaises(ValueError):
            validate_sample_metadata({"language": "French"}, self.metadata_schema)
        with self.assertRaises(ValueError):
            validate_qualification_answers({"languages": ["Hindi"], "proficiency": 7, "experience": "Audio review"}, self.form)

    def test_free_text_qualification_is_validated(self):
        answers = {"languages": ["Hindi"], "proficiency": 4, "experience": "Two years of transcription"}
        self.assertEqual(validate_qualification_answers(answers, self.form), answers)
        with self.assertRaises(ValueError):
            validate_qualification_answers({**answers, "experience": "   "}, self.form)

    def test_all_routing_rules_must_match(self):
        rules = [
            {"metadata_field": "language", "operator": "in", "question_key": "languages"},
            {"metadata_field": "difficulty", "operator": "gte", "question_key": "proficiency"},
        ]
        answers = {"languages": ["Hindi"], "proficiency": 4, "experience": "Audio review"}
        self.assertTrue(sample_matches_qualifications({"language": "Hindi", "difficulty": 3}, answers, rules))
        self.assertTrue(sample_matches_qualifications({"language": "Hindi", "difficulty": "3"}, answers, rules))
        self.assertFalse(sample_matches_qualifications({"language": "English", "difficulty": 3}, answers, rules))
        self.assertFalse(sample_matches_qualifications({"language": "Hindi", "difficulty": 5}, answers, rules))
        self.assertFalse(sample_matches_qualifications({"language": "Hindi", "difficulty": "5"}, answers, rules))
        self.assertFalse(sample_matches_qualifications({"language": "Hindi", "difficulty": "invalid"}, answers, rules))


if __name__ == "__main__":
    unittest.main()
