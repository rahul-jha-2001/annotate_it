import os
import unittest
import uuid

from fastapi.testclient import TestClient


@unittest.skipUnless(os.getenv("RUN_INTEGRATION") == "1", "requires local PostgreSQL and MinIO")
class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi import HTTPException
        from main import app
        from auth import get_current_user, get_optional_user
        from database import SessionLocal
        from models import User

        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()
        cls.experiment_ids = []
        with SessionLocal() as db:
            cls.owner = User(
                clerk_user_id=f"user_integration_{uuid.uuid4().hex}",
                email=f"integration-{uuid.uuid4()}@example.test",
                display_name="Integration Owner",
                is_platform_admin=False,
            )
            db.add(cls.owner)
            db.commit()
            db.refresh(cls.owner)
            cls.owner_id = cls.owner.id
            cls.owner_email = cls.owner.email
            cls.owner_clerk_id = cls.owner.clerk_user_id
        cls.auth_user = cls.owner

        def current_test_user():
            if cls.auth_user is None:
                raise HTTPException(status_code=401, detail="Authentication required")
            return cls.auth_user

        app.dependency_overrides[get_current_user] = current_test_user
        app.dependency_overrides[get_optional_user] = lambda: None
        cls.app = app

    @classmethod
    def tearDownClass(cls):
        from database import SessionLocal
        from models import Experiment, User

        with SessionLocal() as db:
            db.query(Experiment).filter(Experiment.id.in_(cls.experiment_ids)).delete(
                synchronize_session=False
            )
            db.query(User).filter_by(id=cls.owner_id).delete()
            db.commit()
        cls.app.dependency_overrides.clear()
        cls.client_context.__exit__(None, None, None)

    def create_experiment(self, name, gold_ratio=0):
        response = self.client.post(
            "/experiments",
            json={
                "name": name,
                "modality": "audio",
                "instructions": "Choose the correct class",
                "label_schema": {
                    "annotation_type": "categorical",
                    "choices": ["Good", "Bad"],
                    "multi_select": False,
                },
                "overlap_n": 2,
                "gold_ratio": gold_ratio,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        experiment = response.json()
        self.experiment_ids.append(experiment["id"])
        return experiment

    def create_session(self, experiment):
        response = self.client.get(f"/annotate/{experiment['share_token']}/session")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["session_token"]

    def test_designer_routes_require_authentication_and_ownership(self):
        from database import SessionLocal
        from models import User

        experiment = self.create_experiment("Private integration test")
        self.__class__.auth_user = None
        unauthenticated = self.client.get("/experiments")
        self.assertEqual(unauthenticated.status_code, 401)

        with SessionLocal() as db:
            outsider = User(
                clerk_user_id=f"user_outsider_{uuid.uuid4().hex}",
                email=f"outsider-{uuid.uuid4()}@example.test",
                display_name="Outsider",
            )
            db.add(outsider)
            db.commit()
            db.refresh(outsider)
            outsider_id = outsider.id

        self.__class__.auth_user = outsider
        denied = self.client.get(f"/experiments/{experiment['id']}/dashboard")
        self.assertEqual(denied.status_code, 404)

        self.__class__.auth_user = self.owner
        with SessionLocal() as db:
            db.query(User).filter_by(id=outsider_id).delete()
            db.commit()

    def test_local_profile_is_resolved_from_authenticated_user(self):
        me = self.client.get("/auth/me")
        self.assertEqual(me.status_code, 200, me.text)
        self.assertTrue(me.headers.get("X-Request-ID"))
        self.assertEqual(me.json()["email"], self.owner_email)
        self.assertEqual(me.json()["clerk_user_id"], self.owner_clerk_id)

    def test_signed_in_annotator_profile_links_to_local_user(self):
        from auth import get_optional_user
        from database import SessionLocal
        from models import Annotator

        experiment = self.create_experiment("Signed-in annotator linkage")
        self.app.dependency_overrides[get_optional_user] = lambda: self.owner
        try:
            session_token = self.create_session(experiment)
        finally:
            self.app.dependency_overrides[get_optional_user] = lambda: None

        with SessionLocal() as db:
            annotator = db.query(Annotator).filter_by(session_token=session_token).one()
            self.assertEqual(annotator.user_id, self.owner_id)

    def test_end_to_end_overlap_dashboard_export_and_ownership(self):
        experiment = self.create_experiment("Integration test")
        response = self.client.post(
            f"/experiments/{experiment['id']}/data-units",
            json={"items": [{"raw_uri": "s3://annotate-it-data/test/audio.wav"}]},
        )
        self.assertEqual(response.status_code, 200, response.text)

        sessions = [self.create_session(experiment), self.create_session(experiment)]
        next_items = [
            self.client.get(
                f"/annotate/{experiment['share_token']}/next",
                params={"session_token": token},
            ).json()
            for token in sessions
        ]
        self.assertEqual(next_items[0]["data_unit_id"], next_items[1]["data_unit_id"])
        item_id = next_items[0]["data_unit_id"]

        invalid = self.client.post(
            f"/annotate/{experiment['share_token']}/items/{item_id}/annotations",
            params={"session_token": sessions[0]},
            json={"answer": {"value": "Unknown"}},
        )
        self.assertEqual(invalid.status_code, 422)

        for token in sessions:
            response = self.client.post(
                f"/annotate/{experiment['share_token']}/items/{item_id}/annotations",
                params={"session_token": token},
                json={"answer": {"value": "Good"}},
            )
            self.assertEqual(response.status_code, 200, response.text)

        dashboard = self.client.get(f"/experiments/{experiment['id']}/dashboard")
        self.assertEqual(dashboard.status_code, 200, dashboard.text)
        dashboard_data = dashboard.json()
        self.assertEqual(dashboard_data["completion"]["percent"], 100)
        self.assertEqual(dashboard_data["items"][0]["agreement_score"], 1)
        self.assertEqual(len(dashboard_data["annotators"]), 2)

        exported = self.client.get(f"/experiments/{experiment['id']}/export")
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual(len(exported.json()["data_units"][0]["annotations"]), 2)

        review = self.client.get(f"/experiments/{experiment['id']}/review")
        self.assertEqual(review.status_code, 200, review.text)
        review_sample = review.json()["samples"][0]
        self.assertEqual(review_sample["filename"], "audio.wav")
        self.assertEqual(review_sample["n_annotations"], 2)
        self.assertEqual(len(review_sample["annotations"]), 2)
        self.assertIn("media_url", review_sample)

        participants = self.client.get(
            f"/experiments/{experiment['id']}/annotators"
        )
        self.assertEqual(participants.status_code, 200, participants.text)
        participant_rows = participants.json()["annotators"]
        self.assertEqual(len(participant_rows), 2)
        self.assertTrue(all(row["items_completed"] == 1 for row in participant_rows))
        self.assertTrue(
            all(row["rolling_agreement_score"] == 1 for row in participant_rows),
            participant_rows,
        )

        participant_detail = self.client.get(
            f"/experiments/{experiment['id']}/annotators/{participant_rows[0]['id']}"
        )
        self.assertEqual(participant_detail.status_code, 200, participant_detail.text)
        detail_body = participant_detail.json()
        self.assertEqual(len(detail_body["annotations"]), 1)
        self.assertEqual(detail_body["annotations"][0]["filename"], "audio.wav")
        self.assertEqual(detail_body["annotations"][0]["answer"], {"value": "Good"})
        self.assertEqual(detail_body["annotations"][0]["agreement_score"], 1)
        self.assertIsNone(detail_body["annotations"][0]["gold_score"])

        other = self.create_experiment("Other integration test")
        response = self.client.post(
            f"/experiments/{other['id']}/data-units",
            json={"items": [{"raw_uri": "s3://annotate-it-data/test/other.wav"}]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        other_item = self.client.get(
            f"/annotate/{other['share_token']}/next",
            params={"session_token": self.create_session(other)},
        ).json()["data_unit_id"]
        cross_experiment = self.client.post(
            f"/annotate/{other['share_token']}/items/{other_item}/annotations",
            params={"session_token": sessions[0]},
            json={"answer": {"value": "Good"}},
        )
        self.assertEqual(cross_experiment.status_code, 401)

    def test_gold_allocation_and_scoring(self):
        from database import SessionLocal
        from models import DataUnit

        experiment = self.create_experiment("Gold integration test", gold_ratio=1)
        response = self.client.post(
            f"/experiments/{experiment['id']}/data-units",
            json={
                "items": [
                    {"raw_uri": "s3://annotate-it-data/test/regular.wav"},
                    {
                        "raw_uri": "s3://annotate-it-data/test/gold.wav",
                        "is_gold": True,
                        "gold_answer": {"value": "Good"},
                    },
                ]
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        with SessionLocal() as db:
            expected_gold_id = str(
                db.query(DataUnit).filter(
                    DataUnit.experiment_id == uuid.UUID(experiment["id"]),
                    DataUnit.raw_uri.endswith("/gold.wav"),
                ).one().id
            )

        session = self.create_session(experiment)
        next_item = self.client.get(
            f"/annotate/{experiment['share_token']}/next",
            params={"session_token": session},
        ).json()
        self.assertEqual(next_item["data_unit_id"], expected_gold_id)
        response = self.client.post(
            f"/annotate/{experiment['share_token']}/items/{expected_gold_id}/annotations",
            params={"session_token": session},
            json={"answer": {"value": "Bad"}},
        )
        self.assertEqual(response.status_code, 200, response.text)
        dashboard = self.client.get(f"/experiments/{experiment['id']}/dashboard").json()
        self.assertEqual(dashboard["annotators"][0]["rolling_gold_accuracy"], 0)
        self.assertEqual(dashboard["annotators"][0]["gold_items_seen"], 1)
        participants = self.client.get(
            f"/experiments/{experiment['id']}/annotators"
        ).json()["annotators"]
        self.assertEqual(len(participants), 1)
        detail = self.client.get(
            f"/experiments/{experiment['id']}/annotators/{participants[0]['id']}"
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["annotations"][0]["gold_score"], 0)
        self.assertEqual(
            detail.json()["annotations"][0]["gold_answer"], {"value": "Good"}
        )

    def test_legacy_schema_session_is_normalized(self):
        from database import SessionLocal
        from models import Experiment

        with SessionLocal() as db:
            experiment = Experiment(
                name="Legacy integration test",
                modality="audio",
                instructions="Legacy schema",
                label_schema=[
                    {"name": "Category 1", "type": "categorical"},
                    {"name": "Category 2", "type": "categorical"},
                ],
                overlap_n=1,
                gold_ratio=0,
                share_token="legacy-test-token",
            )
            db.add(experiment)
            db.commit()
            db.refresh(experiment)
            self.experiment_ids.append(str(experiment.id))

        response = self.client.get("/annotate/legacy-test-token/session")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json()["label_schema"],
            {
                "annotation_type": "categorical",
                "choices": ["Category 1", "Category 2"],
                "multi_select": False,
            },
        )

    def test_qualification_form_routes_samples_by_metadata(self):
        from database import SessionLocal
        from models import DataUnit

        response = self.client.post(
            "/experiments",
            json={
                "name": "Qualification routing test",
                "modality": "audio",
                "instructions": "Only matching languages",
                "label_schema": {"annotation_type": "categorical", "choices": ["Good"], "multi_select": False},
                "overlap_n": 1,
                "gold_ratio": 0,
                "metadata_schema": [
                    {"key": "language", "label": "Language", "type": "choice", "options": ["Hindi", "English"]}
                ],
                "qualification_form": [
                    {"key": "languages", "label": "Languages understood", "type": "multi_choice", "options": ["Hindi", "English"]}
                ],
                "routing_rules": [
                    {"metadata_field": "language", "operator": "in", "question_key": "languages"}
                ],
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        experiment = response.json()
        self.experiment_ids.append(experiment["id"])
        response = self.client.post(
            f"/experiments/{experiment['id']}/data-units",
            json={"items": [
                {"raw_uri": "s3://annotate-it-data/test/hindi.wav", "metadata": {"language": "Hindi"}},
                {"raw_uri": "s3://annotate-it-data/test/english.wav", "metadata": {"language": "English"}},
            ]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        session_response = self.client.get(f"/annotate/{experiment['share_token']}/session")
        self.assertTrue(session_response.json()["requires_qualification"])
        session = session_response.json()["session_token"]
        blocked = self.client.get(
            f"/annotate/{experiment['share_token']}/next", params={"session_token": session}
        )
        self.assertEqual(blocked.status_code, 403)
        qualified = self.client.post(
            f"/annotate/{experiment['share_token']}/qualifications",
            params={"session_token": session},
            json={"answers": {"languages": ["Hindi"]}},
        )
        self.assertEqual(qualified.status_code, 200, qualified.text)
        next_item = self.client.get(
            f"/annotate/{experiment['share_token']}/next", params={"session_token": session}
        ).json()
        with SessionLocal() as db:
            hindi_id = str(db.query(DataUnit).filter(
                DataUnit.experiment_id == uuid.UUID(experiment["id"]),
                DataUnit.raw_uri.endswith("/hindi.wav"),
            ).one().id)
        self.assertEqual(next_item["data_unit_id"], hindi_id)
        submitted = self.client.post(
            f"/annotate/{experiment['share_token']}/items/{hindi_id}/annotations",
            params={"session_token": session},
            json={"answer": {"value": "Good"}},
        )
        self.assertEqual(submitted.status_code, 200, submitted.text)
        dashboard = self.client.get(f"/experiments/{experiment['id']}/dashboard")
        self.assertEqual(dashboard.status_code, 200, dashboard.text)
        dashboard_body = dashboard.json()
        self.assertEqual(
            dashboard_body["experiment"]["qualification_form"][0]["label"],
            "Languages understood",
        )
        self.assertEqual(
            dashboard_body["annotators"][0]["qualification_answers"],
            {"languages": ["Hindi"]},
        )
        self.assertIsNotNone(dashboard_body["annotators"][0]["last_activity_at"])
        no_match = self.client.get(
            f"/annotate/{experiment['share_token']}/next", params={"session_token": session}
        ).json()
        self.assertEqual(no_match["message"], "No remaining samples match your qualifications.")

    def test_draft_experiment_must_be_deployed(self):
        response = self.client.post(
            "/experiments",
            json={
                "name": "Draft deployment test",
                "modality": "audio",
                "instructions": "Draft",
                "label_schema": {"annotation_type": "categorical", "choices": ["Good"], "multi_select": False},
                "status": "draft",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        experiment = response.json()
        self.experiment_ids.append(experiment["id"])
        blocked = self.client.get(f"/annotate/{experiment['share_token']}/session")
        self.assertEqual(blocked.status_code, 403)
        response = self.client.post(
            f"/experiments/{experiment['id']}/data-units",
            json={"items": [{"raw_uri": "s3://annotate-it-data/test/draft.wav"}]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        deployed = self.client.post(f"/experiments/{experiment['id']}/deploy")
        self.assertEqual(deployed.status_code, 200, deployed.text)
        session = self.client.get(f"/annotate/{experiment['share_token']}/session")
        self.assertEqual(session.status_code, 200, session.text)
