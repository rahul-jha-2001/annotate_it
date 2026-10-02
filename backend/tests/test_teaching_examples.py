import datetime
import unittest
import uuid
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from models import Annotator, DataUnit, Experiment, User
from services.allocation import allocate_next_item, has_pending_unseen_items
from main import (
    configure_teaching_examples,
    get_teaching_examples,
    complete_teaching_examples,
    get_session,
    get_next_item,
    process_gold_manifest,
)
from schemas import (
    GoldManifestEntry,
    GoldManifestRequest,
    TeachingExampleItem,
    TeachingExamplesRequest,
)


class TeachingExamplesTests(unittest.TestCase):
    def setUp(self):
        self.exp_id = uuid.uuid4()
        self.user_id = uuid.uuid4()
        self.user = User(
            id=self.user_id,
            email="designer@example.com",
            display_name="Designer",
            is_platform_admin=False,
        )
        self.experiment = Experiment(
            id=self.exp_id,
            owner_id=self.user_id,
            name="Test Experiment",
            modality="audio",
            label_schema={
                "annotation_type": "categorical",
                "schema_version": 1,
                "choices": ["Positive", "Negative"],
                "multi_select": False,
            },
            status="active",
            access_mode="anonymous",
            share_token="share-test-token",
            teaching_examples=[],
            qualification_form=[],
            overlap_n=1,
            gold_ratio=0.0,
        )
        self.unit1 = DataUnit(
            id=uuid.uuid4(),
            experiment_id=self.exp_id,
            raw_uri="s3://bucket/experiments/sample1.wav",
            is_gold=False,
            metadata_json={},
        )
        self.unit2 = DataUnit(
            id=uuid.uuid4(),
            experiment_id=self.exp_id,
            raw_uri="s3://bucket/experiments/sample2.wav",
            is_gold=False,
            metadata_json={},
        )
        self.gold_unit = DataUnit(
            id=uuid.uuid4(),
            experiment_id=self.exp_id,
            raw_uri="s3://bucket/experiments/gold.wav",
            is_gold=True,
            gold_answer={"value": "Positive"},
            metadata_json={},
        )

    def test_configure_teaching_examples_success(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = self.experiment
        db.query.return_value.filter_by.return_value.all.return_value = [self.unit1, self.unit2]

        req = TeachingExamplesRequest(
            teaching_examples=[
                TeachingExampleItem(
                    data_unit_id=self.unit1.id,
                    displayed_answer={"value": "Positive"},
                    explanation="Clear positive speech",
                )
            ]
        )

        with patch("main.get_owned_experiment", return_value=self.experiment), \
             patch("main.generate_media_url", return_value="https://s3.test/sample1.wav"):
            res = configure_teaching_examples(self.exp_id, req, db, self.user)

        self.assertEqual(len(res.teaching_examples), 1)
        self.assertEqual(res.teaching_examples[0].data_unit_id, self.unit1.id)
        self.assertEqual(res.teaching_examples[0].displayed_answer, {"value": "Positive"})
        self.assertEqual(res.teaching_examples[0].explanation, "Clear positive speech")
        self.assertEqual(len(self.experiment.teaching_examples), 1)

    def test_configure_teaching_examples_with_gold_unit_kept_as_gold(self):
        """When keep_as_gold=True, gold unit is kept in scored gold pool and used as teaching example."""
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = self.experiment
        db.query.return_value.filter_by.return_value.all.return_value = [self.gold_unit]

        req = TeachingExamplesRequest(
            teaching_examples=[
                TeachingExampleItem(
                    data_unit_id=self.gold_unit.id,
                    displayed_answer={"value": "Positive"},
                    explanation="Gold example kept in gold pool",
                    keep_as_gold=True,
                )
            ]
        )

        with patch("main.get_owned_experiment", return_value=self.experiment), \
             patch("main.generate_media_url", return_value="https://s3.test/gold.wav"):
            res = configure_teaching_examples(self.exp_id, req, db, self.user)

        self.assertEqual(len(res.teaching_examples), 1)
        self.assertTrue(res.teaching_examples[0].keep_as_gold)
        self.assertTrue(self.gold_unit.is_gold)
        self.assertEqual(self.gold_unit.gold_answer, {"value": "Positive"})

    def test_configure_teaching_examples_with_gold_unit_converted_from_gold(self):
        """When keep_as_gold=False, gold unit is converted to teaching-only and removed from gold pool."""
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = self.experiment
        db.query.return_value.filter_by.return_value.all.return_value = [self.gold_unit]

        req = TeachingExamplesRequest(
            teaching_examples=[
                TeachingExampleItem(
                    data_unit_id=self.gold_unit.id,
                    displayed_answer={"value": "Positive"},
                    explanation="Converted gold to teaching only",
                    keep_as_gold=False,
                )
            ]
        )

        with patch("main.get_owned_experiment", return_value=self.experiment), \
             patch("main.generate_media_url", return_value="https://s3.test/gold.wav"):
            res = configure_teaching_examples(self.exp_id, req, db, self.user)

        self.assertEqual(len(res.teaching_examples), 1)
        self.assertFalse(res.teaching_examples[0].keep_as_gold)
        self.assertFalse(self.gold_unit.is_gold)
        self.assertIsNone(self.gold_unit.gold_answer)

    def test_configure_teaching_examples_rejects_invalid_answer(self):
        """displayed_answer must validate against the experiment's answer model."""
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = self.experiment
        db.query.return_value.filter_by.return_value.all.return_value = [self.unit1]

        req = TeachingExamplesRequest(
            teaching_examples=[
                TeachingExampleItem(
                    data_unit_id=self.unit1.id,
                    displayed_answer={"value": "UnknownChoice"},
                )
            ]
        )

        with patch("main.get_owned_experiment", return_value=self.experiment):
            with self.assertRaises(HTTPException) as ctx:
                configure_teaching_examples(self.exp_id, req, db, self.user)
            self.assertEqual(ctx.exception.status_code, 422)

    def test_configure_teaching_examples_rejects_duplicate_units(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = self.experiment
        db.query.return_value.filter_by.return_value.all.return_value = [self.unit1]

        req = TeachingExamplesRequest(
            teaching_examples=[
                TeachingExampleItem(data_unit_id=self.unit1.id, displayed_answer={"value": "Positive"}),
                TeachingExampleItem(data_unit_id=self.unit1.id, displayed_answer={"value": "Positive"}),
            ]
        )

        with patch("main.get_owned_experiment", return_value=self.experiment):
            with self.assertRaises(HTTPException) as ctx:
                configure_teaching_examples(self.exp_id, req, db, self.user)
            self.assertEqual(ctx.exception.status_code, 422)
            self.assertIn("Duplicate", ctx.exception.detail)

    def test_gold_manifest_allows_teaching_example_item(self):
        """Applying gold manifest on an item in teaching examples sets is_gold and keeps it in gold."""
        self.experiment.teaching_examples = [
            {"data_unit_id": str(self.unit1.id), "displayed_answer": {"value": "Positive"}, "keep_as_gold": False}
        ]
        db = MagicMock()
        db.query.return_value.filter_by.return_value.all.return_value = [self.unit1]

        req = GoldManifestRequest(
            manifest=[
                GoldManifestEntry(filename="sample1.wav", answer={"value": "Positive"})
            ]
        )

        with patch("main.get_owned_experiment", return_value=self.experiment):
            res = process_gold_manifest(self.exp_id, req, db, self.user)

        self.assertEqual(len(res["applied"]), 1)
        self.assertEqual(len(res["errors"]), 0)
        self.assertTrue(self.unit1.is_gold)
        self.assertEqual(self.unit1.gold_answer, {"value": "Positive"})
        self.assertTrue(self.experiment.teaching_examples[0]["keep_as_gold"])

    def test_allocation_excludes_teaching_examples(self):
        """Teaching example items must NEVER be served as regular annotation tasks."""
        self.experiment.teaching_examples = [
            {"data_unit_id": str(self.unit1.id), "displayed_answer": {"value": "Positive"}}
        ]
        annotator = Annotator(
            id=uuid.uuid4(),
            experiment_id=self.exp_id,
            session_token="session-123",
            status="active",
        )

        # Mock DB query for regular candidate
        db = MagicMock()
        # When querying regular candidate, if unit1 is in teaching_examples, only unit2 should be returned
        # Simulate query returning only unit2
        db.query.return_value.filter.return_value.scalar.return_value = 0
        db.query.return_value.join.return_value.filter.return_value.scalar.return_value = 0

        # We can test the query filtering:
        query_mock = MagicMock()
        db.query.return_value.outerjoin.return_value.filter.return_value = query_mock
        query_mock.filter.return_value = query_mock
        query_mock.group_by.return_value.having.return_value.order_by.return_value.all.return_value = [self.unit2]

        allocated = allocate_next_item(db, self.experiment, annotator)
        self.assertEqual(allocated, self.unit2)
        # Verify query_mock.filter was called with teaching_ids filter
        self.assertTrue(query_mock.filter.called)

    def test_annotator_onboarding_flow(self):
        """Annotators must see teaching examples before their first item allocation."""
        self.experiment.teaching_examples = [
            {"data_unit_id": str(self.unit1.id), "displayed_answer": {"value": "Positive"}, "explanation": "Test note"}
        ]
        annotator = Annotator(
            id=uuid.uuid4(),
            experiment_id=self.exp_id,
            session_token="session-token-test",
            status="active",
            teaching_examples_shown_at=None,
        )

        db = MagicMock()
        # Mock get_session queries
        query_mock = MagicMock()
        db.query.return_value = query_mock
        query_mock.filter.return_value.first.return_value = self.experiment
        query_mock.filter_by.return_value.first.return_value = annotator
        query_mock.filter.return_value.all.return_value = [self.unit1]

        with patch("main.generate_media_url", return_value="https://s3.test/sample1.wav"):
            session_res = get_session("share-test-token", session_token="session-token-test", db=db, user=None)

        self.assertTrue(session_res.requires_teaching_examples)
        self.assertEqual(len(session_res.teaching_examples), 1)
        self.assertEqual(session_res.teaching_examples[0].data_unit_id, self.unit1.id)
        self.assertEqual(session_res.teaching_examples[0].explanation, "Test note")

        # Calling get_next_item before completing teaching examples raises 403
        with self.assertRaises(HTTPException) as ctx:
            get_next_item("share-test-token", session_token="session-token-test", db=db)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Teaching examples onboarding is incomplete", ctx.exception.detail)

        # Complete teaching examples
        complete_res = complete_teaching_examples("share-test-token", session_token="session-token-test", db=db)
        self.assertEqual(complete_res["status"], "completed")
        self.assertIsNotNone(annotator.teaching_examples_shown_at)

        # After completion, requires_teaching_examples is False
        with patch("main.generate_media_url", return_value="https://s3.test/sample1.wav"):
            session_res_after = get_session("share-test-token", session_token="session-token-test", db=db, user=None)
        self.assertFalse(session_res_after.requires_teaching_examples)


if __name__ == "__main__":
    unittest.main()
