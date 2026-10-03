import io
import json
import os
import shutil
import sys
import unittest
import uuid
from unittest.mock import MagicMock, patch

from services.bundle_worker import process_bundle_upload

_lambda_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "lambda", "bundle_extractor"))
if _lambda_dir not in sys.path:
    sys.path.insert(0, _lambda_dir)
from lambda_function import lambda_handler


FIXTURES_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "sample", "bundle_upload_tests")
)


class BundleFixturesParityTests(unittest.TestCase):
    """Verifies that bundle_worker.py and lambda_handler behave identically across all 4 test fixtures."""

    def _setup_mock_s3(self, zip_path: str):
        mock_s3 = MagicMock()
        def download_file(bucket, key, target):
            shutil.copyfile(zip_path, target)
        mock_s3.download_file.side_effect = download_file
        return mock_s3

    def _setup_mock_client(self):
        client = MagicMock()
        client.patch.return_value = MagicMock(status_code=200)
        client.post.return_value = MagicMock(status_code=200, json=lambda: {"created": [{"id": str(uuid.uuid4())}]})
        return client

    # --- 1. bundle_test_media.zip ---
    def test_fixture_media_worker(self):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_media.zip")
        s3 = self._setup_mock_s3(zip_path)
        client = self._setup_mock_client()

        result = process_bundle_upload(
            experiment_id="exp-1",
            job_id="job-1",
            s3_key="zip-uploads/exp-1/media.zip",
            modality="audio",
            api_client=client,
            s3_client=s3,
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["applied"]), 12)
        self.assertEqual(len(result["errors"]), 0)

    @patch("lambda_function.boto3.client")
    @patch("lambda_function.make_backend_request")
    def test_fixture_media_lambda(self, mock_backend, mock_boto):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_media.zip")
        mock_boto.return_value = self._setup_mock_s3(zip_path)
        mock_backend.return_value = (200, {"status": "ok"})

        event = {
            "bucket": "test-bucket",
            "s3_key": "zip-uploads/exp-1/media.zip",
            "job_id": "job-1",
            "experiment_id": "exp-1",
            "modality": "audio",
        }
        res = lambda_handler(event, MagicMock(aws_request_id="req-1"))
        self.assertEqual(res["statusCode"], 200)
        body = json.loads(res["body"])
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["applied_count"], 12)
        self.assertEqual(body["errors_count"], 0)

    # --- 2. bundle_test_zipslip.zip ---
    def test_fixture_zipslip_worker(self):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_zipslip.zip")
        s3 = self._setup_mock_s3(zip_path)
        client = self._setup_mock_client()

        with self.assertRaises(ValueError) as ctx:
            process_bundle_upload(
                experiment_id="exp-2",
                job_id="job-2",
                s3_key="zip-uploads/exp-2/zipslip.zip",
                modality="audio",
                api_client=client,
                s3_client=s3,
            )
        self.assertIn("Zip slip detected", str(ctx.exception))

    @patch("lambda_function.boto3.client")
    @patch("lambda_function.make_backend_request")
    def test_fixture_zipslip_lambda(self, mock_backend, mock_boto):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_zipslip.zip")
        mock_boto.return_value = self._setup_mock_s3(zip_path)
        mock_backend.return_value = (200, {"status": "ok"})

        event = {
            "bucket": "test-bucket",
            "s3_key": "zip-uploads/exp-2/zipslip.zip",
            "job_id": "job-2",
            "experiment_id": "exp-2",
            "modality": "audio",
        }
        res = lambda_handler(event, MagicMock(aws_request_id="req-2"))
        self.assertEqual(res["statusCode"], 500)
        body = json.loads(res["body"])
        self.assertIn("Zip slip detected", body["error"])

    # --- 3. bundle_test_badstructure.zip ---
    def test_fixture_badstructure_worker(self):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_badstructure.zip")
        s3 = self._setup_mock_s3(zip_path)
        client = self._setup_mock_client()

        with self.assertRaises(ValueError) as ctx:
            process_bundle_upload(
                experiment_id="exp-3",
                job_id="job-3",
                s3_key="zip-uploads/exp-3/badstruct.zip",
                modality="audio",
                api_client=client,
                s3_client=s3,
            )
        self.assertIn("Archive must contain a top-level 'media/' directory", str(ctx.exception))

    @patch("lambda_function.boto3.client")
    @patch("lambda_function.make_backend_request")
    def test_fixture_badstructure_lambda(self, mock_backend, mock_boto):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_badstructure.zip")
        mock_boto.return_value = self._setup_mock_s3(zip_path)
        mock_backend.return_value = (200, {"status": "ok"})

        event = {
            "bucket": "test-bucket",
            "s3_key": "zip-uploads/exp-3/badstruct.zip",
            "job_id": "job-3",
            "experiment_id": "exp-3",
            "modality": "audio",
        }
        res = lambda_handler(event, MagicMock(aws_request_id="req-3"))
        self.assertEqual(res["statusCode"], 500)
        body = json.loads(res["body"])
        self.assertIn("Archive must contain a top-level 'media/' directory", body["error"])

    # --- 4. bundle_test_badfiletype.zip ---
    def test_fixture_badfiletype_worker(self):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_badfiletype.zip")
        s3 = self._setup_mock_s3(zip_path)
        client = self._setup_mock_client()

        result = process_bundle_upload(
            experiment_id="exp-4",
            job_id="job-4",
            s3_key="zip-uploads/exp-4/badfiletype.zip",
            modality="audio",
            api_client=client,
            s3_client=s3,
        )
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["applied"], ["bundle_test_001.wav"])
        self.assertEqual(len(result["errors"]), 1)
        self.assertEqual(result["errors"][0]["filename"], "malicious.exe")
        self.assertIn("Invalid extension '.exe'", result["errors"][0]["error"])

    @patch("lambda_function.boto3.client")
    @patch("lambda_function.make_backend_request")
    def test_fixture_badfiletype_lambda(self, mock_backend, mock_boto):
        zip_path = os.path.join(FIXTURES_DIR, "bundle_test_badfiletype.zip")
        mock_boto.return_value = self._setup_mock_s3(zip_path)
        mock_backend.return_value = (200, {"status": "ok"})

        event = {
            "bucket": "test-bucket",
            "s3_key": "zip-uploads/exp-4/badfiletype.zip",
            "job_id": "job-4",
            "experiment_id": "exp-4",
            "modality": "audio",
        }
        res = lambda_handler(event, MagicMock(aws_request_id="req-4"))
        self.assertEqual(res["statusCode"], 200)
        body = json.loads(res["body"])
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["applied_count"], 1)
        self.assertEqual(body["errors_count"], 1)


if __name__ == "__main__":
    unittest.main()
