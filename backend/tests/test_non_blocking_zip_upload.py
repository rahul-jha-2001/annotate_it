import unittest
import uuid
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from auth import get_current_user
from config import S3_BUCKET
from database import SessionLocal
from main import app
from models import BundleUploadJob, DataUnit, Experiment, User
from services.experiment_validation import validate_experiment_for_deploy, reconcile_pending_experiment_data


class NonBlockingZipUploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

        with SessionLocal() as db:
            cls.user = User(
                clerk_user_id=f"user_nb_{uuid.uuid4().hex}",
                email=f"nb-{uuid.uuid4()}@example.test",
                display_name="NB User",
                is_platform_admin=False,
            )
            db.add(cls.user)
            db.commit()
            db.refresh(cls.user)

    @classmethod
    def tearDownClass(cls):
        with SessionLocal() as db:
            db.query(Experiment).filter(Experiment.owner_id == cls.user.id).delete()
            db.query(User).filter(User.id == cls.user.id).delete()
            db.commit()
        cls.client_context.__exit__(None, None, None)

    def setUp(self):
        app.dependency_overrides[get_current_user] = lambda: self.user
        with SessionLocal() as db:
            self.experiment = Experiment(
                owner_id=self.user.id,
                name="Non-Blocking Test Experiment",
                modality="audio",
                instructions="Test instructions",
                label_schema={
                    "annotation_type": "categorical",
                    "schema_version": 1,
                    "choices": ["Positive", "Negative"],
                    "multi_select": False,
                },
                overlap_n=1,
                gold_ratio=0.1,
                access_mode="anonymous",
                share_token=f"token-{uuid.uuid4().hex[:8]}",
                status="draft_media_processing",
                metadata_schema=[{"key": "genre", "label": "Genre", "type": "text", "options": []}],
                qualification_form=[],
                routing_rules=[],
                teaching_examples=[],
                pending_metadata=[],
                pending_gold_manifest=[],
            )
            db.add(self.experiment)
            db.commit()
            db.refresh(self.experiment)
            self.exp_id = self.experiment.id

    def tearDown(self):
        app.dependency_overrides.pop(get_current_user, None)
        with SessionLocal() as db:
            db.query(DataUnit).filter_by(experiment_id=self.exp_id).delete()
            db.query(BundleUploadJob).filter_by(experiment_id=self.exp_id).delete()
            db.query(Experiment).filter_by(id=self.exp_id).delete()
            db.commit()

    def test_validation_blocks_while_media_processing(self):
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            exp.status = "draft_media_processing"
            db.commit()

            result = validate_experiment_for_deploy(exp, db)
            self.assertFalse(result.can_deploy)
            self.assertIn("processing", result.blocker_reason.lower())

    def test_validation_blocks_on_orphaned_gold_entries(self):
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            exp.status = "draft"
            # Add 2 units
            u1 = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u1/file1.wav")
            u2 = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u2/file2.wav")
            db.add_all([u1, u2])
            # Pending gold mentions file1 and file_ghost (not in units)
            exp.pending_gold_manifest = [
                {"filename": "file1.wav", "answer": {"value": "Positive"}},
                {"filename": "file_ghost.wav", "answer": {"value": "Negative"}},
            ]
            db.commit()

            result = validate_experiment_for_deploy(exp, db)
            self.assertFalse(result.can_deploy)
            self.assertEqual(result.orphaned_gold_entries, ["file_ghost.wav"])
            self.assertIn("gold entries reference files", result.blocker_reason)

    def test_validation_warns_on_missing_from_extraction_without_blocking(self):
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            exp.status = "draft"
            u1 = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u1/file1.wav", is_gold=True, gold_answer={"value": "Positive"})
            db.add(u1)
            # Metadata mentions file1 and file_not_in_zip
            exp.pending_metadata = [
                {"filename": "file1.wav", "attributes": {"genre": "rock"}},
                {"filename": "file_not_in_zip.wav", "attributes": {"genre": "jazz"}},
            ]
            exp.pending_gold_manifest = [{"filename": "file1.wav", "answer": {"value": "Positive"}}]
            db.commit()

            result = validate_experiment_for_deploy(exp, db)
            self.assertTrue(result.can_deploy)
            self.assertEqual(result.missing_from_extraction, ["file_not_in_zip.wav"])
            self.assertEqual(result.orphaned_gold_entries, [])

    def test_metadata_preview_and_reupload_endpoint(self):
        payload = {
            "rows": [
                {"filename": "track1.wav", "attributes": {"genre": "ambient"}},
                {"filename": "track2.wav", "attributes": {"genre": "techno"}},
            ]
        }
        res = self.client.post(f"/experiments/{self.exp_id}/metadata-preview", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_rows"], 2)
        self.assertIn("genre", data["sample_keys"])

        # Check DB
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            self.assertEqual(len(exp.pending_metadata), 2)
            self.assertEqual(exp.pending_metadata[0]["filename"], "track1.wav")

    def test_gold_manifest_allows_pending_during_media_processing(self):
        payload = {
            "manifest": [
                {"filename": "track1.wav", "answer": {"value": "Positive"}},
                {"filename": "track2.wav", "answer": {"value": "Negative"}},
            ]
        }
        res = self.client.post(f"/experiments/{self.exp_id}/gold-manifest", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["errors"], [])
        self.assertEqual(len(data["applied"]), 2)

        # Check pending_gold_manifest stored in DB
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            self.assertEqual(len(exp.pending_gold_manifest), 2)

    def test_reconcile_pending_data_on_units(self):
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            u1 = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u1/track1.wav")
            u2 = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u2/track2.wav")
            db.add_all([u1, u2])
            exp.pending_metadata = [
                {"filename": "track1.wav", "attributes": {"genre": "rock"}},
                {"filename": "track2.wav", "attributes": {"genre": "pop"}},
            ]
            exp.pending_gold_manifest = [
                {"filename": "track1.wav", "answer": {"value": "Positive"}},
            ]
            db.commit()

            summary = reconcile_pending_experiment_data(exp, db)
            self.assertEqual(summary["applied_metadata"], 2)
            self.assertEqual(summary["applied_gold"], 1)

            # Verify DataUnits updated
            u1_refreshed = db.query(DataUnit).filter_by(id=u1.id).first()
            self.assertTrue(u1_refreshed.is_gold)
            self.assertEqual(u1_refreshed.gold_answer, {"value": "Positive"})
            self.assertEqual(u1_refreshed.metadata_json.get("genre"), "rock")

    @patch("main.delete_s3_prefix")
    @patch("main.s3_client")
    def test_reupload_media_full_reset(self, mock_s3, mock_del_s3):
        mock_s3.create_multipart_upload.return_value = {"UploadId": "fresh_upload_123"}

        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            exp.status = "draft_media_failed"
            u1 = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u1/old.wav")
            db.add(u1)
            exp.pending_metadata = [{"filename": "old.wav", "attributes": {}}]
            exp.pending_gold_manifest = [{"filename": "old.wav", "answer": {"value": "Positive"}}]
            db.commit()

        res = self.client.post(f"/experiments/{self.exp_id}/reupload-media")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["upload_id"], "fresh_upload_123")
        self.assertEqual(data["status"], "draft_media_processing")

        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            self.assertEqual(exp.status, "draft_media_processing")
            self.assertEqual(exp.pending_metadata, [])
            self.assertEqual(exp.pending_gold_manifest, [])
            units_count = db.query(DataUnit).filter_by(experiment_id=exp.id).count()
            self.assertEqual(units_count, 0)

        # Verify S3 cleanup was called
        mock_del_s3.assert_any_call(S3_BUCKET, f"experiments/{self.exp_id}/")
        mock_del_s3.assert_any_call(S3_BUCKET, f"zip-uploads/{self.exp_id}/")

    def test_pre_deploy_validation_endpoint(self):
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            exp.status = "draft"
            u = DataUnit(experiment_id=exp.id, raw_uri="s3://bucket/experiments/u1/track1.wav", is_gold=True, gold_answer={"value": "Positive"})
            db.add(u)
            exp.pending_gold_manifest = [{"filename": "track1.wav", "answer": {"value": "Positive"}}]
            db.commit()

        res = self.client.get(f"/experiments/{self.exp_id}/pre-deploy-validation")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["can_deploy"])
        self.assertEqual(data["registered_count"], 1)
        self.assertEqual(data["orphaned_gold_entries"], [])
