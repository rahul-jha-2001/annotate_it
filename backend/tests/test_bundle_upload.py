import datetime
import io
import os
import unittest
import uuid
import zipfile
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from auth import get_current_user
from config import BUNDLE_UPLOAD_TIMEOUT_MINUTES, INTERNAL_SERVICE_KEY, S3_BUCKET
from database import SessionLocal
from main import app
from models import BundleUploadJob, DataUnit, Experiment, MediaUpload, User
from services.bundle_worker import process_bundle_upload
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "lambda", "bundle_extractor")))
from lambda_function import lambda_handler


class BundleUploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

        with SessionLocal() as db:
            cls.owner = User(
                clerk_user_id=f"user_bundle_{uuid.uuid4().hex}",
                email=f"bundle-{uuid.uuid4()}@example.test",
                display_name="Bundle Owner",
                is_platform_admin=False,
            )
            cls.other_user = User(
                clerk_user_id=f"user_other_{uuid.uuid4().hex}",
                email=f"other-{uuid.uuid4()}@example.test",
                display_name="Other User",
                is_platform_admin=False,
            )
            db.add_all([cls.owner, cls.other_user])
            db.commit()
            db.refresh(cls.owner)
            db.refresh(cls.other_user)

    @classmethod
    def tearDownClass(cls):
        with SessionLocal() as db:
            db.query(BundleUploadJob).filter(
                BundleUploadJob.user_id.in_([cls.owner.id, cls.other_user.id])
            ).delete(synchronize_session=False)
            db.query(MediaUpload).filter(
                MediaUpload.user_id.in_([cls.owner.id, cls.other_user.id])
            ).delete(synchronize_session=False)
            db.query(Experiment).filter(
                Experiment.owner_id.in_([cls.owner.id, cls.other_user.id])
            ).delete(synchronize_session=False)
            db.query(User).filter(
                User.id.in_([cls.owner.id, cls.other_user.id])
            ).delete(synchronize_session=False)
            db.commit()
        cls.client_context.__exit__(None, None, None)

    def setUp(self):
        self.app_dependency_overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_current_user] = lambda: self.owner

    def tearDown(self):
        app.dependency_overrides = self.app_dependency_overrides

    def _create_experiment(self, modality="image", status="draft") -> Experiment:
        with SessionLocal() as db:
            exp = Experiment(
                name=f"Exp {uuid.uuid4().hex[:6]}",
                owner_id=self.owner.id,
                modality=modality,
                status=status,
                share_token=f"token_{uuid.uuid4().hex[:8]}",
                label_schema={
                    "annotation_type": "categorical",
                    "schema_version": 1,
                    "choices": ["cat", "dog"],
                },
            )
            db.add(exp)
            db.commit()
            db.refresh(exp)
            return exp

    # --- 1. Multipart Upload Endpoints ---

    @patch("main.s3_client")
    def test_presign_multipart(self, mock_s3):
        mock_s3.create_multipart_upload.return_value = {"UploadId": "test-mp-upload-123"}
        exp = self._create_experiment()

        res = self.client.post("/uploads/presign-multipart", json={
            "filename": "dataset.zip",
            "content_type": "application/zip",
            "experiment_id": str(exp.id),
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["upload_id"], "test-mp-upload-123")
        self.assertTrue(data["s3_key"].startswith(f"zip-uploads/{exp.id}/"))
        self.assertTrue(data["s3_key"].endswith("dataset.zip"))

    @patch("main.s3_client")
    def test_presign_multipart_part(self, mock_s3):
        mock_s3.generate_presigned_url.return_value = "https://s3.example.com/part1"
        exp = self._create_experiment()
        s3_key = f"zip-uploads/{exp.id}/abc/dataset.zip"

        with SessionLocal() as db:
            db.add(MediaUpload(
                user_id=self.owner.id,
                experiment_id=exp.id,
                bucket=S3_BUCKET,
                key=s3_key,
            ))
            db.commit()

        # Success as owner
        res = self.client.post("/uploads/presign-multipart-part", json={
            "s3_key": s3_key,
            "upload_id": "test-mp-upload-123",
            "part_number": 1,
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["presigned_url"], "https://s3.example.com/part1")
        self.assertEqual(res.json()["part_number"], 1)

        # Forbidden as other user
        app.dependency_overrides[get_current_user] = lambda: self.other_user
        res_other = self.client.post("/uploads/presign-multipart-part", json={
            "s3_key": s3_key,
            "upload_id": "test-mp-upload-123",
            "part_number": 1,
        })
        self.assertEqual(res_other.status_code, 403)

    @patch("main.s3_client")
    def test_complete_multipart(self, mock_s3):
        mock_s3.complete_multipart_upload.return_value = {}
        exp = self._create_experiment()
        s3_key = f"zip-uploads/{exp.id}/xyz/dataset.zip"

        with SessionLocal() as db:
            db.add(MediaUpload(
                user_id=self.owner.id,
                experiment_id=exp.id,
                bucket=S3_BUCKET,
                key=s3_key,
            ))
            db.commit()

        res = self.client.post("/uploads/complete-multipart", json={
            "s3_key": s3_key,
            "upload_id": "test-mp-upload-123",
            "parts": [{"PartNumber": 1, "ETag": '"etag1"'}],
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["s3_key"], s3_key)
        self.assertEqual(data["s3_uri"], f"s3://{S3_BUCKET}/{s3_key}")

    # --- 2. Bundle Upload Job Endpoints ---

    def test_bundle_upload_lifecycle(self):
        exp = self._create_experiment()
        s3_key = f"zip-uploads/{exp.id}/job1/dataset.zip"

        # Create job
        res_create = self.client.post(f"/experiments/{exp.id}/bundle-upload", json={"s3_key": s3_key})
        self.assertEqual(res_create.status_code, 200)
        job_id = res_create.json()["job_id"]
        self.assertEqual(res_create.json()["status"], "queued")

        with SessionLocal() as db:
            refreshed_exp = db.query(Experiment).filter_by(id=exp.id).first()
            self.assertEqual(refreshed_exp.status, "draft_media_processing")

        # Conflict if already draft_media_processing
        res_conflict = self.client.post(f"/experiments/{exp.id}/bundle-upload", json={"s3_key": s3_key})
        self.assertEqual(res_conflict.status_code, 409)

        # GET status as owner
        res_get = self.client.get(f"/experiments/{exp.id}/bundle-upload/{job_id}")
        self.assertEqual(res_get.status_code, 200)
        self.assertEqual(res_get.json()["status"], "queued")

        # GET status as non-owner (must fail 403)
        app.dependency_overrides[get_current_user] = lambda: self.other_user
        res_unauth = self.client.get(f"/experiments/{exp.id}/bundle-upload/{job_id}")
        self.assertEqual(res_unauth.status_code, 404)
        app.dependency_overrides[get_current_user] = lambda: self.owner

        # PATCH requires X-Internal-Service-Key
        res_patch_no_key = self.client.patch(
            f"/experiments/{exp.id}/bundle-upload/{job_id}",
            json={"files_processed": 5, "files_total": 10},
        )
        self.assertEqual(res_patch_no_key.status_code, 403)

        res_patch_wrong_key = self.client.patch(
            f"/experiments/{exp.id}/bundle-upload/{job_id}",
            json={"files_processed": 5, "files_total": 10},
            headers={"X-Internal-Service-Key": "wrong-key"},
        )
        self.assertEqual(res_patch_wrong_key.status_code, 403)

        # Valid PATCH
        res_patch_ok = self.client.patch(
            f"/experiments/{exp.id}/bundle-upload/{job_id}",
            json={
                "status": "processing",
                "files_processed": 5,
                "files_total": 10,
                "applied": ["file1.png"],
                "errors": [],
            },
            headers={"X-Internal-Service-Key": INTERNAL_SERVICE_KEY},
        )
        self.assertEqual(res_patch_ok.status_code, 200)
        data = res_patch_ok.json()
        self.assertEqual(data["status"], "processing")
        self.assertEqual(data["progress"]["files_processed"], 5)
        self.assertEqual(data["progress"]["files_total"], 10)

        # Complete job via PATCH: experiment status must flip to 'draft'
        res_patch_complete = self.client.patch(
            f"/experiments/{exp.id}/bundle-upload/{job_id}",
            json={"status": "completed", "files_processed": 10},
            headers={"X-Internal-Service-Key": INTERNAL_SERVICE_KEY},
        )
        self.assertEqual(res_patch_complete.status_code, 200)
        with SessionLocal() as db:
            refreshed_exp = db.query(Experiment).filter_by(id=exp.id).first()
            self.assertEqual(refreshed_exp.status, "draft")

        # Modifying a terminal job returns 409
        res_patch_terminal = self.client.patch(
            f"/experiments/{exp.id}/bundle-upload/{job_id}",
            json={"status": "processing"},
            headers={"X-Internal-Service-Key": INTERNAL_SERVICE_KEY},
        )
        self.assertEqual(res_patch_terminal.status_code, 409)

    def test_watchdog_timeout_on_get(self):
        exp = self._create_experiment(status="draft_media_processing")
        with SessionLocal() as db:
            stale_job = BundleUploadJob(
                experiment_id=exp.id,
                user_id=self.owner.id,
                s3_key=f"zip-uploads/{exp.id}/stale/dataset.zip",
                status="processing",
                files_total=10,
                files_processed=2,
                updated_at=datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=25),
            )
            db.add(stale_job)
            db.commit()
            db.refresh(stale_job)
            stale_job_id = stale_job.id

        # GET request triggers watchdog fail
        res = self.client.get(f"/experiments/{exp.id}/bundle-upload/{stale_job_id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "failed")
        self.assertTrue(any("timed out after" in e["error"] for e in data["result"]["errors"]))

        with SessionLocal() as db:
            refreshed_exp = db.query(Experiment).filter_by(id=exp.id).first()
            self.assertEqual(refreshed_exp.status, "draft_media_failed")

    # --- 3. Dual Auth on POST /experiments/{id}/data-units ---

    def test_data_units_dual_auth(self):
        exp = self._create_experiment(status="draft_media_processing")
        with SessionLocal() as db:
            job = BundleUploadJob(
                experiment_id=exp.id,
                user_id=self.owner.id,
                s3_key=f"zip-uploads/{exp.id}/test/data.zip",
                status="processing",
            )
            db.add(job)
            db.commit()

        s3_uri = f"s3://{S3_BUCKET}/experiments/{exp.id}/{uuid.uuid4()}/sample.png"

        # Service key succeeds when draft_media_processing and active job exists
        res = self.client.post(
            f"/experiments/{exp.id}/data-units",
            json={"items": [{"raw_uri": s3_uri}]},
            headers={"X-Internal-Service-Key": INTERNAL_SERVICE_KEY},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()["data_units"]), 1)

        # Service key rejected if S3 uri is outside experiment prefix
        outsider_uri = f"s3://{S3_BUCKET}/uploads/other_prefix/sample.png"
        res_bad_uri = self.client.post(
            f"/experiments/{exp.id}/data-units",
            json={"items": [{"raw_uri": outsider_uri}]},
            headers={"X-Internal-Service-Key": INTERNAL_SERVICE_KEY},
        )
        self.assertEqual(res_bad_uri.status_code, 403)

        # Service key rejected if experiment is not in draft_media_processing
        with SessionLocal() as db:
            exp_draft = db.query(Experiment).filter_by(id=exp.id).first()
            exp_draft.status = "draft"
            db.commit()

        res_bad_status = self.client.post(
            f"/experiments/{exp.id}/data-units",
            json={"items": [{"raw_uri": s3_uri}]},
            headers={"X-Internal-Service-Key": INTERNAL_SERVICE_KEY},
        )
        self.assertEqual(res_bad_status.status_code, 403)

    # --- 4. Guardrails & Extraction Tests ---

    def test_worker_zip_bomb_guardrail(self):
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("media/large.txt", b"x" * 2000)
        zip_bytes = zip_buffer.getvalue()

        mock_s3 = MagicMock()
        def download_file(bucket, key, target):
            with open(target, "wb") as f:
                f.write(zip_bytes)
        mock_s3.download_file.side_effect = download_file

        exp = self._create_experiment(status="draft_media_processing")
        with SessionLocal() as db:
            job = BundleUploadJob(
                experiment_id=exp.id,
                user_id=self.owner.id,
                s3_key=f"zip-uploads/{exp.id}/bomb.zip",
                status="queued",
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            job_id = str(job.id)

        # Limit to 500 bytes uncompressed
        with self.assertRaises(ValueError) as ctx:
            process_bundle_upload(
                experiment_id=str(exp.id),
                job_id=job_id,
                s3_key=f"zip-uploads/{exp.id}/bomb.zip",
                api_client=self.client,
                s3_client=mock_s3,
                max_uncompressed_bytes=500,
            )
        self.assertIn("exceeds limit", str(ctx.exception))

        with SessionLocal() as db:
            refreshed_job = db.query(BundleUploadJob).filter_by(id=job.id).first()
            self.assertEqual(refreshed_job.status, "failed")

    def test_worker_zip_slip_guardrail(self):
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("media/../../etc/passwd", b"root:x:0:0:")
        zip_bytes = zip_buffer.getvalue()

        mock_s3 = MagicMock()
        def download_file(bucket, key, target):
            with open(target, "wb") as f:
                f.write(zip_bytes)
        mock_s3.download_file.side_effect = download_file

        exp = self._create_experiment(status="draft_media_processing")
        with SessionLocal() as db:
            job = BundleUploadJob(
                experiment_id=exp.id,
                user_id=self.owner.id,
                s3_key=f"zip-uploads/{exp.id}/slip.zip",
                status="queued",
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            job_id = str(job.id)

        with self.assertRaises(ValueError) as ctx:
            process_bundle_upload(
                experiment_id=str(exp.id),
                job_id=job_id,
                s3_key=f"zip-uploads/{exp.id}/slip.zip",
                api_client=self.client,
                s3_client=mock_s3,
            )
        self.assertIn("Zip slip detected", str(ctx.exception))

    def test_worker_missing_media_root_guardrail(self):
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("wrong_dir/sample.png", b"image-content")
        zip_bytes = zip_buffer.getvalue()

        mock_s3 = MagicMock()
        def download_file(bucket, key, target):
            with open(target, "wb") as f:
                f.write(zip_bytes)
        mock_s3.download_file.side_effect = download_file

        exp = self._create_experiment(status="draft_media_processing")
        with SessionLocal() as db:
            job = BundleUploadJob(
                experiment_id=exp.id,
                user_id=self.owner.id,
                s3_key=f"zip-uploads/{exp.id}/no_media.zip",
                status="queued",
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            job_id = str(job.id)

        with self.assertRaises(ValueError) as ctx:
            process_bundle_upload(
                experiment_id=str(exp.id),
                job_id=job_id,
                s3_key=f"zip-uploads/{exp.id}/no_media.zip",
                api_client=self.client,
                s3_client=mock_s3,
            )
        self.assertIn("top-level 'media/' directory", str(ctx.exception))

    def test_worker_successful_extraction(self):
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w") as zf:
            zf.writestr("media/cat.png", b"fake-png-data-1")
            zf.writestr("media/dog.jpg", b"fake-jpg-data-2")
            zf.writestr("media/invalid.wav", b"fake-wav-data")  # invalid for image modality
        zip_bytes = zip_buffer.getvalue()

        mock_s3 = MagicMock()
        def download_file(bucket, key, target):
            with open(target, "wb") as f:
                f.write(zip_bytes)
        mock_s3.download_file.side_effect = download_file

        exp = self._create_experiment(modality="image", status="draft_media_processing")
        with SessionLocal() as db:
            job = BundleUploadJob(
                experiment_id=exp.id,
                user_id=self.owner.id,
                s3_key=f"zip-uploads/{exp.id}/valid.zip",
                status="queued",
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            job_id = str(job.id)

        result = process_bundle_upload(
            experiment_id=str(exp.id),
            job_id=job_id,
            s3_key=f"zip-uploads/{exp.id}/valid.zip",
            modality="image",
            api_client=self.client,
            s3_client=mock_s3,
        )

        self.assertEqual(result["status"], "completed")
        self.assertIn("cat.png", result["applied"])
        self.assertIn("dog.jpg", result["applied"])
        self.assertTrue(any("invalid.wav" in e["filename"] for e in result["errors"]))

        # Verify job and experiment final status in database
        with SessionLocal() as db:
            refreshed_job = db.query(BundleUploadJob).filter_by(id=job.id).first()
            self.assertEqual(refreshed_job.status, "completed")
            refreshed_exp = db.query(Experiment).filter_by(id=exp.id).first()
            self.assertEqual(refreshed_exp.status, "draft")
            units = db.query(DataUnit).filter_by(experiment_id=exp.id).all()
            self.assertEqual(len(units), 2)
