import math
import unittest

from annotation_types.scoring.geometry import (
    box_iou,
    ellipse_iou,
    greedy_labeled_match,
    keypoint_similarity,
    polygon_iou,
    polyline_similarity,
)


class SpatialGeometryTests(unittest.TestCase):
    def test_box_iou_handles_identical_partial_disjoint_and_touching_boxes(self):
        box = {"x": 0.0, "y": 0.0, "width": 0.5, "height": 0.5}
        self.assertEqual(box_iou(box, box), 1.0)
        self.assertAlmostEqual(
            box_iou(box, {"x": 0.25, "y": 0.0, "width": 0.5, "height": 0.5}),
            1 / 3,
        )
        self.assertEqual(
            box_iou(box, {"x": 0.75, "y": 0.75, "width": 0.2, "height": 0.2}),
            0.0,
        )
        self.assertEqual(
            box_iou(box, {"x": 0.5, "y": 0.0, "width": 0.5, "height": 0.5}),
            0.0,
        )

    def test_polygon_iou_supports_concave_shapes_and_rejects_invalid_geometry(self):
        concave = {
            "points": [
                {"x": 0.0, "y": 0.0},
                {"x": 1.0, "y": 0.0},
                {"x": 0.5, "y": 0.5},
                {"x": 1.0, "y": 1.0},
                {"x": 0.0, "y": 1.0},
            ]
        }
        self.assertEqual(polygon_iou(concave, concave), 1.0)
        self.assertEqual(
            polygon_iou(
                concave,
                {"points": [
                    {"x": 0.0, "y": 0.0},
                    {"x": 0.1, "y": 0.0},
                    {"x": 0.0, "y": 0.1},
                ]},
            ) > 0,
            True,
        )
        self.assertEqual(
            polygon_iou(
                {"points": [
                    {"x": 0.0, "y": 0.0},
                    {"x": 0.2, "y": 0.0},
                    {"x": 0.0, "y": 0.2},
                ]},
                {"points": [
                    {"x": 0.8, "y": 0.8},
                    {"x": 1.0, "y": 0.8},
                    {"x": 1.0, "y": 1.0},
                ]},
            ),
            0.0,
        )
        with self.assertRaises(ValueError):
            polygon_iou(
                {"points": [
                    {"x": 0.0, "y": 0.0},
                    {"x": 1.0, "y": 1.0},
                    {"x": 0.0, "y": 1.0},
                    {"x": 1.0, "y": 0.0},
                ]},
                concave,
            )

    def test_polyline_ellipse_and_keypoint_scores_are_bounded(self):
        line = {"points": [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 1.0}]}
        nearby = {"points": [{"x": 0.0, "y": 0.05}, {"x": 1.0, "y": 1.0}]}
        self.assertEqual(polyline_similarity(line, line), 1.0)
        self.assertGreater(polyline_similarity(line, nearby), 0.9)
        self.assertEqual(
            polyline_similarity(
                line,
                {"points": [{"x": 0.0, "y": 1.0}, {"x": 1.0, "y": 0.0}]},
                distance_tolerance=0.01,
            ),
            0.0,
        )

        ellipse = {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.3}
        self.assertAlmostEqual(ellipse_iou(ellipse, ellipse), 1.0)
        self.assertEqual(
            ellipse_iou(ellipse, {"x": 0.7, "y": 0.7, "width": 0.2, "height": 0.2}),
            0.0,
        )

        self.assertEqual(
            keypoint_similarity({"x": 0.2, "y": 0.3}, {"x": 0.2, "y": 0.3}),
            1.0,
        )
        self.assertEqual(
            keypoint_similarity({"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 1.0}),
            0.0,
        )
        for score in (
            polyline_similarity(line, nearby),
            ellipse_iou(ellipse, ellipse),
            keypoint_similarity({"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.9}),
        ):
            self.assertTrue(math.isfinite(score))
            self.assertGreaterEqual(score, 0.0)
            self.assertLessEqual(score, 1.0)

    def test_geometry_rejects_out_of_range_coordinates(self):
        with self.assertRaises(ValueError):
            box_iou(
                {"x": -0.1, "y": 0.0, "width": 0.5, "height": 0.5},
                {"x": 0.0, "y": 0.0, "width": 0.5, "height": 0.5},
            )
        with self.assertRaises(ValueError):
            keypoint_similarity({"x": 2.0, "y": 0.0}, {"x": 0.0, "y": 0.0})

    def test_greedy_matching_respects_labels_unmatched_items_and_time(self):
        left = [
            {"id": "left-1", "label": "Car", "time": 1.0, "score": 0.9},
            {"id": "left-2", "label": "Person", "time": 4.0, "score": 0.8},
        ]
        right = [
            {"id": "right-1", "label": "Car", "time": 1.1, "score": 0.7},
        ]
        scorer = lambda a, b: min(a["score"], b["score"])

        self.assertAlmostEqual(
            greedy_labeled_match(left, right, scorer, time_tolerance=0.2),
            0.35,
        )
        self.assertEqual(
            greedy_labeled_match(left, right, scorer, time_tolerance=0.05),
            0.0,
        )
        self.assertEqual(
            greedy_labeled_match(
                [{"label": "Car", "score": 1.0}],
                [{"label": "Truck", "score": 1.0}],
                scorer,
            ),
            0.0,
        )
        self.assertEqual(greedy_labeled_match([], [], scorer), 1.0)

    def test_greedy_matching_rejects_invalid_scorer_results(self):
        item = {"label": "Car"}
        with self.assertRaises(ValueError):
            greedy_labeled_match([item], [item], lambda _a, _b: float("nan"))
        with self.assertRaises(ValueError):
            greedy_labeled_match([item], [item], lambda _a, _b: 1.1)


if __name__ == "__main__":
    unittest.main()
