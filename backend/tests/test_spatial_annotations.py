import unittest

from pydantic import ValidationError

from annotation_types import get_compatible_modalities, get_type, get_valid_types_for_modality
from annotation_types.spatial_tasks import SPATIAL_TASK_TYPES
from modalities import get_modality


CONFIGS = {
    "bounding_box": {
        "annotation_type": "bounding_box",
        "choices": ["Car", "Person"],
        "max_shapes": 2,
        "frame_aware": False,
        "time_tolerance": 0.1,
    },
    "polygon": {
        "annotation_type": "polygon",
        "choices": ["Car", "Person"],
        "max_shapes": 2,
        "frame_aware": False,
        "time_tolerance": 0.1,
    },
    "polyline": {
        "annotation_type": "polyline",
        "choices": ["Road"],
        "max_shapes": 2,
        "frame_aware": False,
        "time_tolerance": 0.1,
        "distance_tolerance": 0.1,
    },
    "ellipse": {
        "annotation_type": "ellipse",
        "choices": ["Cell"],
        "max_shapes": 2,
        "frame_aware": False,
        "time_tolerance": 0.1,
    },
    "keypoint": {
        "annotation_type": "keypoint",
        "choices": ["Nose"],
        "max_shapes": 2,
        "frame_aware": False,
        "time_tolerance": 0.1,
    },
}

ANSWERS = {
    "bounding_box": {
        "boxes": [{"id": "box-1", "label": "Car", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}]
    },
    "polygon": {
        "polygons": [{"id": "polygon-1", "label": "Car", "points": [
            {"x": 0.1, "y": 0.1}, {"x": 0.5, "y": 0.1}, {"x": 0.3, "y": 0.5}
        ]}]
    },
    "polyline": {
        "polylines": [{"id": "line-1", "label": "Road", "points": [
            {"x": 0.1, "y": 0.1}, {"x": 0.8, "y": 0.8}
        ]}]
    },
    "ellipse": {
        "ellipses": [{"id": "ellipse-1", "label": "Cell", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}]
    },
    "keypoint": {
        "keypoints": [{"id": "point-1", "label": "Nose", "x": 0.2, "y": 0.3}]
    },
}


class SpatialAnnotationTests(unittest.TestCase):
    def test_all_spatial_children_validate_strict_normalized_answers(self):
        for key, answer in ANSWERS.items():
            with self.subTest(key=key):
                module = get_type(key)
                self.assertEqual(module.validate_answer(answer, CONFIGS[key]), answer)
                bad = dict(answer)
                bad["unexpected"] = True
                with self.assertRaises(ValidationError):
                    module.validate_answer(bad, CONFIGS[key])

    def test_labels_ids_and_collection_limits_are_enforced_by_family(self):
        for key, answer in ANSWERS.items():
            with self.subTest(key=key):
                module = get_type(key)
                field = next(iter(answer))
                shape = answer[field][0]
                with self.assertRaises(ValueError):
                    module.validate_answer(
                        {field: [{**shape, "label": "Unknown"}]}, CONFIGS[key]
                    )
                with self.assertRaises((ValueError, ValidationError)):
                    module.validate_answer(
                        {field: [{**shape, "label": "  "}]}, CONFIGS[key]
                    )
                with self.assertRaises(ValueError):
                    module.validate_answer(
                        {field: [shape, {**shape}]}, CONFIGS[key]
                    )
                with self.assertRaises(ValueError):
                    module.validate_answer(
                        {field: [shape, {**shape, "id": "second"}, {**shape, "id": "third"}]},
                        CONFIGS[key],
                    )

    def test_each_shape_rejects_invalid_geometry(self):
        invalid = {
            "bounding_box": {"boxes": [{"id": "x", "label": "Car", "x": 0.9, "y": 0.2, "width": 0.3, "height": 0.4}]},
            "polygon": {"polygons": [{"id": "x", "label": "Car", "points": [
                {"x": 0.1, "y": 0.1}, {"x": 0.8, "y": 0.8},
                {"x": 0.1, "y": 0.8}, {"x": 0.8, "y": 0.1}
            ]}]},
            "polyline": {"polylines": [{"id": "x", "label": "Road", "points": [{"x": 0.1, "y": 0.1}]}]},
            "ellipse": {"ellipses": [{"id": "x", "label": "Cell", "x": 0.1, "y": 0.2, "width": 0.0, "height": 0.4}]},
            "keypoint": {"keypoints": [{"id": "x", "label": "Nose", "x": -0.1, "y": 0.3}]},
        }
        for key, answer in invalid.items():
            with self.subTest(key=key), self.assertRaises((ValueError, ValidationError)):
                get_type(key).validate_answer(answer, CONFIGS[key])

    def test_frame_aware_answers_require_time_and_image_answers_forbid_it(self):
        module = get_type("bounding_box")
        answer = ANSWERS["bounding_box"]
        shape = answer["boxes"][0]
        with self.assertRaises(ValueError):
            module.validate_answer(
                {"boxes": [{**shape, "time": 1.25}]}, CONFIGS["bounding_box"]
            )
        video_config = {**CONFIGS["bounding_box"], "frame_aware": True}
        with self.assertRaises(ValueError):
            module.validate_answer(answer, video_config)
        expected = {"boxes": [{**shape, "time": 1.25}]}
        self.assertEqual(module.validate_answer(expected, video_config), expected)

    def test_matching_uses_label_geometry_unmatched_penalties_and_time_tolerance(self):
        module = get_type("bounding_box")
        first = ANSWERS["bounding_box"]
        self.assertEqual(module.gold_match(first, first, CONFIGS["bounding_box"]), 1.0)
        wrong_label = {"boxes": [{**first["boxes"][0], "label": "Person"}]}
        self.assertEqual(module.gold_match(first, wrong_label, CONFIGS["bounding_box"]), 0.0)
        extra = {"boxes": [first["boxes"][0], {**first["boxes"][0], "id": "box-2"}]}
        self.assertEqual(module.gold_match(first, extra, CONFIGS["bounding_box"]), 0.5)

        video_config = {**CONFIGS["bounding_box"], "frame_aware": True, "time_tolerance": 0.1}
        at_one = {"boxes": [{**first["boxes"][0], "time": 1.0}]}
        at_nearby = {"boxes": [{**first["boxes"][0], "time": 1.05}]}
        at_later = {"boxes": [{**first["boxes"][0], "time": 1.2}]}
        self.assertEqual(module.gold_match(at_one, at_nearby, video_config), 1.0)
        self.assertEqual(module.gold_match(at_one, at_later, video_config), 0.0)

    def test_capabilities_resolve_spatial_types_for_image_and_video_but_not_audio(self):
        expected = {task.key for task in (task_type() for task_type in SPATIAL_TASK_TYPES)}
        self.assertTrue(expected.issubset(set(get_valid_types_for_modality("video"))))
        self.assertTrue(expected.isdisjoint(set(get_valid_types_for_modality("audio"))))
        self.assertTrue(expected.issubset(set(get_valid_types_for_modality("image"))))
        self.assertIn("spatial-shapes", get_modality("image").supported_interactions)
        for key in expected:
            self.assertEqual(get_compatible_modalities(get_type(key)), ["video", "image"])


if __name__ == "__main__":
    unittest.main()
