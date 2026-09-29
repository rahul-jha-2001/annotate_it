import unittest

from pydantic import ValidationError

from annotation_types import get_type, get_valid_types_for_modality
from annotation_types.temporal_tasks import (
    SoundEventType,
    SpeakerDiarizationType,
)


class LabeledTemporalAnnotationTests(unittest.TestCase):
    def test_each_region_owns_a_label_and_invalid_boundaries_are_rejected(self):
        module = SoundEventType()
        config = {
            "annotation_type": "sound_event",
            "schema_version": 1,
            "choices": ["Speech", "Music"],
            "allow_custom_labels": False,
            "max_regions": 100,
        }
        answer = {
            "regions": [
                {"start": 0, "end": 1, "label": "Speech"},
                {"start": 1, "end": 2, "label": "Music"},
            ]
        }
        self.assertEqual(module.validate_answer(answer, config), answer)
        with self.assertRaises(ValueError):
            module.validate_answer(
                {"regions": [{"start": 0, "end": 1, "label": "Unknown"}]},
                config,
            )
        with self.assertRaises(ValidationError):
            module.validate_answer(
                {"regions": [{"start": 2, "end": 1, "label": "Speech"}]},
                config,
            )

    def test_labeled_matching_penalizes_wrong_and_unmatched_regions(self):
        module = SoundEventType()
        config = {
            "annotation_type": "sound_event",
            "choices": ["Speech", "Music"],
            "allow_custom_labels": False,
            "max_regions": 100,
        }
        self.assertEqual(
            module.gold_match(
                {"regions": [{"start": 0, "end": 2, "label": "Speech"}]},
                {"regions": [{"start": 0, "end": 2, "label": "Music"}]},
                config,
            ),
            0.0,
        )
        self.assertEqual(
            module.gold_match(
                {"regions": [
                    {"start": 0, "end": 1, "label": "Speech"},
                    {"start": 2, "end": 3, "label": "Music"},
                ]},
                {"regions": [{"start": 0, "end": 1, "label": "Speech"}]},
                config,
            ),
            0.5,
        )

    def test_diarization_aligns_consistently_renamed_speaker_clusters(self):
        module = SpeakerDiarizationType()
        config = {
            "annotation_type": "speaker_diarization",
            "choices": [],
            "allow_custom_labels": True,
            "max_regions": 100,
        }
        self.assertEqual(
            module.agreement(
                [
                    {"regions": [
                        {"start": 0, "end": 1, "label": "Speaker 1"},
                        {"start": 1, "end": 2, "label": "Speaker 2"},
                    ]},
                    {"regions": [
                        {"start": 0, "end": 1, "label": "A"},
                        {"start": 1, "end": 2, "label": "B"},
                    ]},
                ],
                config,
            ),
            1.0,
        )

    def test_task_children_register_through_capabilities(self):
        expected = {
            "speaker_diarization",
            "speaker_identification",
            "sound_event",
            "speech_segmentation",
            "video_event",
            "action_recognition",
        }
        self.assertTrue(expected.issubset(set(get_valid_types_for_modality("video"))))
        self.assertIn("sound_event", get_valid_types_for_modality("audio"))
        self.assertNotIn("video_event", get_valid_types_for_modality("audio"))
        self.assertNotIn("action_recognition", get_valid_types_for_modality("audio"))
        self.assertIsInstance(get_type("speaker_diarization"), SpeakerDiarizationType)


if __name__ == "__main__":
    unittest.main()
