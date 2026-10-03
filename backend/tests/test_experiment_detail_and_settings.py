import unittest
import uuid
from fastapi.testclient import TestClient

from auth import get_current_user
from database import SessionLocal
from main import app
from models import Experiment, User


class ExperimentDetailAndSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

        with SessionLocal() as db:
            cls.user = User(
                clerk_user_id=f"user_exp_{uuid.uuid4().hex}",
                email=f"exp-{uuid.uuid4()}@example.test",
                display_name="Exp User",
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
                name="Detail Test Experiment",
                modality="audio",
                instructions="Test instructions",
                label_schema={
                    "annotation_type": "categorical",
                    "schema_version": 1,
                    "choices": ["Good", "Bad"],
                    "multi_select": False,
                },
                overlap_n=2,
                gold_ratio=0.1,
                access_mode="anonymous",
                share_token=f"token-{uuid.uuid4().hex[:8]}",
                status="draft",
                metadata_schema=[{"key": "language", "label": "Language", "type": "text", "options": []}],
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
            db.query(Experiment).filter_by(id=self.exp_id).delete()
            db.commit()

    def test_get_experiment_detail(self):
        res = self.client.get(f"/experiments/{self.exp_id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["id"], str(self.exp_id))
        self.assertEqual(data["name"], "Detail Test Experiment")
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["modality"], "audio")
        self.assertEqual(data["overlap_n"], 2)
        self.assertFalse(data["configuration_locked"])
        self.assertEqual(len(data["metadata_schema"]), 1)

    def test_update_qualifications_and_rules_via_settings(self):
        payload = {
            "qualification_form": [
                {
                    "key": "fluency",
                    "label": "Language Fluency",
                    "type": "single_choice",
                    "options": ["Native", "Fluent", "Basic"],
                    "required": True,
                }
            ],
            "routing_rules": [
                {
                    "metadata_field": "language",
                    "question_key": "fluency",
                    "operator": "equals",
                }
            ],
        }
        res = self.client.patch(f"/experiments/{self.exp_id}/settings", json=payload)
        self.assertEqual(res.status_code, 200)

        # Check detail endpoint reflects updated qualifications
        res_detail = self.client.get(f"/experiments/{self.exp_id}")
        self.assertEqual(res_detail.status_code, 200)
        detail = res_detail.json()
        self.assertEqual(len(detail["qualification_form"]), 1)
        self.assertEqual(detail["qualification_form"][0]["key"], "fluency")
        self.assertEqual(len(detail["routing_rules"]), 1)
        self.assertEqual(detail["routing_rules"][0]["question_key"], "fluency")

    def test_active_experiment_blocks_editing_and_locks_configuration(self):
        # Set experiment to active
        with SessionLocal() as db:
            exp = db.query(Experiment).filter_by(id=self.exp_id).first()
            exp.status = "active"
            db.commit()

        # Check detail reflects configuration_locked = True
        res_detail = self.client.get(f"/experiments/{self.exp_id}")
        self.assertEqual(res_detail.status_code, 200)
        self.assertTrue(res_detail.json()["configuration_locked"])

        # Check settings endpoint reflects configuration_locked = True
        res_settings = self.client.get(f"/experiments/{self.exp_id}/settings")
        self.assertEqual(res_settings.status_code, 200)
        self.assertTrue(res_settings.json()["configuration_locked"])

        # Check patch settings is rejected with 409
        res_patch = self.client.patch(
            f"/experiments/{self.exp_id}/settings",
            json={"name": "New name while active"},
        )
        self.assertEqual(res_patch.status_code, 409)
        self.assertIn("active", res_patch.json()["detail"].lower())

        # Check data units creation is rejected with 409
        res_units = self.client.post(
            f"/experiments/{self.exp_id}/data-units",
            json={"items": [{"raw_uri": "s3://annotate-it-data/test/extra.wav"}]},
        )
        self.assertEqual(res_units.status_code, 409)

        # Check metadata reupload is rejected with 409
        res_meta = self.client.post(
            f"/experiments/{self.exp_id}/reupload-metadata",
            json={"rows": [{"filename": "extra.wav", "attributes": {"k": "v"}}]},
        )
        self.assertEqual(res_meta.status_code, 409)

