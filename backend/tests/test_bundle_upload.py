import datetime
import io
import json
import logging
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
from lambda_function import (
    LambdaJsonLogFormatter,
    current_aws_request_id,
    current_experiment_id,
    current_job_id,
    lambda_handler,
    logger as lambda_logger,
)


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

    @patch("main.boto3.client")
    def test_bundle_upload_direct_lambda_invocation(self, mock_boto_client):
        exp = self._create_experiment()
        s3_key = f"zip-uploads/{exp.id}/lambda_job/dataset.zip"
        mock_lambda = MagicMock()
        mock_boto_client.return_value = mock_lambda

        with patch.dict(os.environ, {"LAMBDA_BUNDLE_EXTRACTOR_FUNCTION": "taskglass-bundle-extractor"}):
            res = self.client.post(f"/experiments/{exp.id}/bundle-upload", json={"s3_key": s3_key})

        self.assertEqual(res.status_code, 200)
        job_id = res.json()["job_id"]
        mock_boto_client.assert_called_with("lambda", region_name=mock_boto_client.call_args[1]["region_name"])
        mock_lambda.invoke.assert_called_once()
        call_kwargs = mock_lambda.invoke.call_args.kwargs
        self.assertEqual(call_kwargs["FunctionName"], "taskglass-bundle-extractor")
        self.assertEqual(call_kwargs["InvocationType"], "Event")
        payload = json.loads(call_kwargs["Payload"].decode("utf-8"))
        self.assertEqual(payload["s3_key"], s3_key)
        self.assertEqual(payload["job_id"], job_id)
        self.assertEqual(payload["experiment_id"], str(exp.id))
        self.assertEqual(payload["modality"], exp.modality)

    @patch("main.boto3.client")
    def test_bundle_upload_lambda_invocation_failure_does_not_break_request(self, mock_boto_client):
        exp = self._create_experiment()
        s3_key = f"zip-uploads/{exp.id}/lambda_fail_job/dataset.zip"
        mock_lambda = MagicMock()
        mock_lambda.invoke.side_effect = Exception("AWS Lambda network timeout")
        mock_boto_client.return_value = mock_lambda

        with patch.dict(os.environ, {"LAMBDA_BUNDLE_EXTRACTOR_FUNCTION": "taskglass-bundle-extractor"}):
            res = self.client.post(f"/experiments/{exp.id}/bundle-upload", json={"s3_key": s3_key})

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "queued")

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

    def test_lambda_json_log_formatter(self):
        formatter = LambdaJsonLogFormatter()
        record = logging.LogRecord(
            name="bundle_extractor",
            level=logging.INFO,
            pathname="lambda_function.py",
            lineno=100,
            msg="bundle_extractor.test_event",
            args=(),
            exc_info=None,
        )
        record.job_id = "test-job-uuid"
        record.experiment_id = "test-exp-uuid"
        record.custom_metric = 42
        record.secret_token = "super-secret-value"

        formatted = formatter.format(record)
        data = json.loads(formatted)

        self.assertEqual(data["level"], "INFO")
        self.assertEqual(data["logger"], "bundle_extractor")
        self.assertEqual(data["message"], "bundle_extractor.test_event")
        self.assertEqual(data["job_id"], "test-job-uuid")
        self.assertEqual(data["experiment_id"], "test-exp-uuid")
        self.assertEqual(data["custom_metric"], 42)
        # Sensitive substring "token" should be redacted
        self.assertEqual(data["secret_token"], "***REDACTED***")
        self.assertIn("timestamp", data)

    @patch("lambda_function.boto3.client")
    @patch("lambda_function.make_backend_request")
    def test_lambda_handler_structured_execution(self, mock_make_backend_request, mock_boto_client):
        # Create a valid test zip archive in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("media/sample1.wav", b"fake-wav-1")
            zf.writestr("media/sample2.wav", b"fake-wav-2")
        zip_bytes = zip_buffer.getvalue()

        mock_s3 = MagicMock()
        def download_file(bucket, key, target):
            with open(target, "wb") as f:
                f.write(zip_bytes)
        mock_s3.download_file.side_effect = download_file
        mock_boto_client.return_value = mock_s3

        # Mock backend responses
        def mock_request(endpoint, method, payload):
            if "data-units" in endpoint:
                return 200, {"created": [{"id": str(uuid.uuid4())}]}
            return 200, {"status": "ok"}
        mock_make_backend_request.side_effect = mock_request

        event = {
            "bucket": "test-media-bucket",
            "s3_key": "zip-uploads/exp-123/archive.zip",
            "job_id": "job-abc-456",
            "experiment_id": "exp-123",
            "modality": "audio",
        }
        mock_context = MagicMock()
        mock_context.aws_request_id = "test-aws-req-999"

        with io.StringIO() as log_capture, patch.object(sys, "stdout", log_capture):
            # Attach a capturing handler to lambda_logger
            string_io = io.StringIO()
            capture_handler = logging.StreamHandler(string_io)
            capture_handler.setFormatter(LambdaJsonLogFormatter())
            lambda_logger.addHandler(capture_handler)
            try:
                response = lambda_handler(event, mock_context)
            finally:
                lambda_logger.removeHandler(capture_handler)

        self.assertEqual(response["statusCode"], 200)
        resp_body = json.loads(response["body"])
        self.assertEqual(resp_body["status"], "completed")
        self.assertEqual(resp_body["applied_count"], 2)

        # Inspect captured JSON logs
        captured_lines = [line.strip() for line in string_io.getvalue().strip().split("\n") if line.strip()]
        self.assertGreater(len(captured_lines), 5)
        parsed_logs = [json.loads(line) for line in captured_lines]

        messages = [log["message"] for log in parsed_logs]
        self.assertIn("bundle_extractor.invocation_started", messages)
        self.assertIn("bundle_extractor.event_parsed", messages)
        self.assertIn("bundle_extractor.download_completed", messages)
        self.assertIn("bundle_extractor.archive_inspection_started", messages)
        self.assertIn("bundle_extractor.archive_extracted", messages)
        self.assertIn("bundle_extractor.invocation_completed", messages)

        # Ensure all parsed logs carry the aws_request_id, job_id, and experiment_id
        for log in parsed_logs:
            self.assertEqual(log["logger"], "bundle_extractor")
            if log["message"] not in ("bundle_extractor.invocation_started",):
                self.assertEqual(log.get("job_id"), "job-abc-456")
                self.assertEqual(log.get("experiment_id"), "exp-123")

