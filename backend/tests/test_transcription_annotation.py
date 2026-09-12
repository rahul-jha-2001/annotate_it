import unittest

from pydantic import ValidationError

from annotation_types import get_type, get_valid_types_for_modality
from annotation_types.transcription import TranscriptionType


class TranscriptionAnnotationTests(unittest.TestCase):
    def setUp(self):
        self.module = TranscriptionType()
        self.config = {
            "annotation_type": "transcription",
            "schema_version": 1,
            "case_sensitive": False,
            "collapse_whitespace": True,
            "strip_punctuation": False,
            "minimum_length": 1,
        }

    def test_validates_and_normalizes_text(self):
        self.assertEqual(
            self.module.validate_answer({"text": "  Hello   WORLD  "}, self.config),
            {"text": "hello world"},
        )
        with self.assertRaises(ValidationError):
            self.module.validate_answer({"text": "hello", "extra": True}, self.config)

    def test_minimum_length_applies_after_normalization(self):
        with self.assertRaisesRegex(ValueError, "minimum"):
            self.module.validate_answer({"text": "   "}, self.config)

    def test_word_edit_similarity(self):
        self.assertAlmostEqual(
            self.module.gold_match(
                {"text": "hello brave world"},
                {"text": "hello world"},
                self.config,
            ),
            2 / 3,
        )
        self.assertAlmostEqual(
            self.module.agreement(
                [{"text": "Hello, world!"}, {"text": "hello world"}],
                {**self.config, "strip_punctuation": True},
            ),
            1.0,
        )

    def test_registration_uses_existing_none_interaction(self):
        self.assertIsInstance(get_type("transcription"), TranscriptionType)
        self.assertIn("transcription", get_valid_types_for_modality("audio"))
        self.assertIn("transcription", get_valid_types_for_modality("video"))


if __name__ == "__main__":
    unittest.main()
