import datetime
import os
import unittest
import uuid
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient


@unittest.skipUnless(os.getenv("RUN_INTEGRATION") == "1", "requires local PostgreSQL and S3/MinIO")
class ExportApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi import HTTPException
        from main import app
        from auth import get_current_user
        from database import SessionLocal
        from models import User

        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

        with SessionLocal() as db:
            cls.owner = User(
                clerk_user_id=f"user_export_{uuid.uuid4().hex}",
                email=f"export-{uuid.uuid4()}@example.test",
                display_name="Export Owner",
                is_platform_admin=False,
            )
            db.add(cls.owner)
            db.commit()
            db.refresh(cls.owner)
            cls.owner_id = cls.owner.id

        cls.auth_user = cls.owner

        def current_test_user():
            if cls.auth_user is None:
                raise HTTPException(status_code=401, detail="Authentication required")
            return cls.auth_user

        app.dependency_overrides[get_current_user] = current_test_user

    @classmethod
    def tearDownClass(cls):
        from main import app
        from auth import get_current_user
        from database import SessionLocal
        from models import User

        app.dependency_overrides.pop(get_current_user, None)
        cls.client_context.__exit__(None, None, None)
        with SessionLocal() as db:
            from models import Experiment
            db.query(Experiment).filter_by(owner_id=cls.owner_id).delete(synchronize_session=False)
            db.query(User).filter_by(id=cls.owner_id).delete(synchronize_session=False)
            db.commit()

    def test_export_lifecycle_preflight_and_worker(self):
        from export_worker import process_export_job
        from models import ExportJob
        from database import SessionLocal

        # 1. Create active experiment
        exp_resp = self.client.post(
            "/experiments",
            json={
                "name": "Export Test Experiment",
                "modality": "audio",
                "instructions": "Rate the quality",
                "label_schema": {
                    "annotation_type": "categorical",
                    "choices": ["clean", "noisy"],
                },
                "overlap_n": 2,
                "gold_ratio": 0.0,
            },
        )
        self.assertEqual(exp_resp.status_code, 200)
        exp_id = exp_resp.json()["id"]

        # Upload 2 data units
        units_resp = self.client.post(
            f"/experiments/{exp_id}/data-units",
            json={
                "items": [
                    {"raw_uri": "s3://annotate-it-data/test/sample1.wav", "is_gold": False, "metadata": {}},
                    {"raw_uri": "s3://annotate-it-data/test/sample2.wav", "is_gold": False, "metadata": {}},
                ]
            },
        )
        self.assertEqual(units_resp.status_code, 200)

        # Deploy experiment
        deploy_resp = self.client.post(f"/experiments/{exp_id}/deploy")
        self.assertEqual(deploy_resp.status_code, 200)
        share_token = exp_resp.json()["share_token"]

        # Annotate sample 1 with 2 matching annotations
        ann1_sess = self.client.post(f"/annotate/{share_token}/session", json={}).json()
        ann2_sess = self.client.post(f"/annotate/{share_token}/session", json={}).json()

        item_unit_id = units_resp.json()["data_units"][0]["id"]
        sub1 = self.client.post(
            f"/annotate/{share_token}/items/{item_unit_id}/annotations",
            params={"session_token": ann1_sess["session_token"]},
            json={"answer": {"value": "clean"}},
        )
        self.assertEqual(sub1.status_code, 200)
        sub2 = self.client.post(
            f"/annotate/{share_token}/items/{item_unit_id}/annotations",
            params={"session_token": ann2_sess["session_token"]},
            json={"answer": {"value": "clean"}},
        )
        self.assertEqual(sub2.status_code, 200)

        # 2. Preflight API
        preflight_resp = self.client.post(
            f"/experiments/{exp_id}/exports/preflight",
            json={"mode": "consensus", "policy": {"min_annotations_for_consensus": 2}},
        )
        self.assertEqual(preflight_resp.status_code, 200)
        preflight_data = preflight_resp.json()
        self.assertIn("source_fingerprint", preflight_data)
        self.assertIn("counts", preflight_data)
        self.assertEqual(preflight_data["counts"]["total_samples"], 2)
        fingerprint = preflight_data["source_fingerprint"]

        # 3. Create Export Job without acknowledging warnings (there are warnings because sample 2 is unannotated)
        blocked_create = self.client.post(
            f"/experiments/{exp_id}/exports",
            json={
                "mode": "consensus",
                "policy": {"min_annotations_for_consensus": 2},
                "source_fingerprint": fingerprint,
                "acknowledge_warnings": False,
            },
        )
        if preflight_data["warnings"]:
            self.assertEqual(blocked_create.status_code, 422)

        # Create with stale fingerprint should be rejected (409)
        stale_create = self.client.post(
            f"/experiments/{exp_id}/exports",
            json={
                "mode": "consensus",
                "source_fingerprint": "stale_hash_12345",
                "acknowledge_warnings": True,
            },
        )
        self.assertEqual(stale_create.status_code, 409)

        # Create with valid fingerprint and acknowledge_warnings=True -> 202
        valid_create = self.client.post(
            f"/experiments/{exp_id}/exports",
            json={
                "mode": "consensus",
                "policy": {"min_annotations_for_consensus": 2, "include_low_evidence": True},
                "source_fingerprint": fingerprint,
                "acknowledge_warnings": True,
            },
        )
        self.assertEqual(valid_create.status_code, 202)
        job_data = valid_create.json()
        job_id = job_data["id"]
        self.assertEqual(job_data["status"], "queued")

        # 4. List jobs endpoint
        list_resp = self.client.get(f"/experiments/{exp_id}/exports")
        self.assertEqual(list_resp.status_code, 200)
        self.assertTrue(any(j["id"] == job_id for j in list_resp.json()))

        # 5. Process job with worker
        with SessionLocal() as db:
            job_obj = db.query(ExportJob).filter_by(id=job_id).one()
            job_obj.status = "running"
            db.commit()

        success = process_export_job(uuid.UUID(job_id))
        self.assertTrue(success)

        # 6. Check job detail
        job_detail = self.client.get(f"/experiments/{exp_id}/exports/{job_id}")
        self.assertEqual(job_detail.status_code, 200)
        self.assertEqual(job_detail.json()["status"], "ready")
        self.assertIsNotNone(job_detail.json()["sha256"])
        self.assertIsNotNone(job_detail.json()["size_bytes"])

        # 7. Download endpoint
        download_resp = self.client.post(f"/experiments/{exp_id}/exports/{job_id}/download")
        self.assertEqual(download_resp.status_code, 200)
        down_data = download_resp.json()
        self.assertIn("download_url", down_data)
        self.assertTrue(down_data["download_url"].startswith("http"))
        self.assertIn("taskglass-", down_data["filename"])
