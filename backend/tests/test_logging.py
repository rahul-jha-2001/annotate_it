import datetime
import io
import json
import logging
import unittest
import uuid
from unittest.mock import MagicMock

from logging_config import (
    JSONLogFormatter,
    LoggingContextFilter,
    TextLogFormatter,
    clear_logging_context,
    default_json_serializer,
    reset_logging_context,
    sanitize_value,
    set_logging_context,
    setup_logging,
)
from main import extract_trace_id


class StructuredLoggingTests(unittest.TestCase):
    def setUp(self):
        clear_logging_context()

    def tearDown(self):
        clear_logging_context()

    def test_json_formatter_produces_valid_json_with_standard_fields(self):
        formatter = JSONLogFormatter()
        record = logging.LogRecord(
            name="test_logger",
            level=logging.INFO,
            pathname=__file__,
            lineno=10,
            msg="User %s did %s",
            args=("alice", "login"),
            exc_info=None,
        )
        record.request_id = "req-test-123"

        output = formatter.format(record)
        parsed = json.loads(output)

        self.assertEqual(parsed["level"], "INFO")
        self.assertEqual(parsed["logger"], "test_logger")
        self.assertEqual(parsed["message"], "User alice did login")
        self.assertEqual(parsed["request_id"], "req-test-123")
        self.assertTrue(parsed["timestamp"].endswith("Z"))

    def test_json_formatter_handles_extra_fields(self):
        formatter = JSONLogFormatter()
        record = logging.LogRecord(
            name="service_logger",
            level=logging.INFO,
            pathname=__file__,
            lineno=20,
            msg="item_allocated",
            args=(),
            exc_info=None,
        )
        record.data_unit_id = "unit-uuid-456"
        record.duration_ms = 42.5
        record.is_gold = True

        output = formatter.format(record)
        parsed = json.loads(output)

        self.assertEqual(parsed["data_unit_id"], "unit-uuid-456")
        self.assertEqual(parsed["duration_ms"], 42.5)
        self.assertIs(parsed["is_gold"], True)

    def test_json_formatter_redacts_sensitive_keys(self):
        formatter = JSONLogFormatter()
        record = logging.LogRecord(
            name="auth_logger",
            level=logging.INFO,
            pathname=__file__,
            lineno=30,
            msg="auth_attempt",
            args=(),
            exc_info=None,
        )
        record.session_token = "sess_secret_token_123"
        record.api_secret = "sk_live_verysecret"
        record.nested_payload = {
            "password": "supersecretpassword",
            "safe_user": "bob",
        }

        output = formatter.format(record)
        parsed = json.loads(output)

        self.assertEqual(parsed["session_token"], "***REDACTED***")
        self.assertEqual(parsed["api_secret"], "***REDACTED***")
        self.assertEqual(parsed["nested_payload"]["password"], "***REDACTED***")
        self.assertEqual(parsed["nested_payload"]["safe_user"], "bob")

    def test_json_formatter_formats_exceptions_structurally(self):
        formatter = JSONLogFormatter()
        try:
            raise ValueError("Something went wrong with allocation")
        except ValueError:
            import sys
            exc_info = sys.exc_info()

        record = logging.LogRecord(
            name="error_logger",
            level=logging.ERROR,
            pathname=__file__,
            lineno=40,
            msg="operation_failed",
            args=(),
            exc_info=exc_info,
        )

        output = formatter.format(record)
        parsed = json.loads(output)

        self.assertEqual(parsed["level"], "ERROR")
        self.assertIn("exception", parsed)
        self.assertEqual(parsed["exception"]["type"], "ValueError")
        self.assertIn("Something went wrong with allocation", parsed["exception"]["message"])
        self.assertIsInstance(parsed["exception"]["stacktrace"], list)
        self.assertTrue(len(parsed["exception"]["stacktrace"]) > 0)

    def test_contextvars_propagation_via_logging_context_filter(self):
        log_stream = io.StringIO()
        handler = logging.StreamHandler(log_stream)
        handler.addFilter(LoggingContextFilter())
        handler.setFormatter(JSONLogFormatter())

        test_logger = logging.getLogger("test_context_propagation")
        test_logger.setLevel(logging.INFO)
        test_logger.addHandler(handler)
        test_logger.propagate = False

        try:
            tokens = set_logging_context(
                request_id="req-999",
                trace_id="trace-888",
                user_id="user-777",
                experiment_id="exp-666",
                annotator_id="ann-555",
            )

            test_logger.info("scoped_operation", extra={"action": "step_one"})

            lines = log_stream.getvalue().strip().split("\n")
            self.assertEqual(len(lines), 1)
            parsed = json.loads(lines[0])

            self.assertEqual(parsed["request_id"], "req-999")
            self.assertEqual(parsed["trace_id"], "trace-888")
            self.assertEqual(parsed["user_id"], "user-777")
            self.assertEqual(parsed["experiment_id"], "exp-666")
            self.assertEqual(parsed["annotator_id"], "ann-555")
            self.assertEqual(parsed["action"], "step_one")

            # Test reset
            reset_logging_context(tokens)
            test_logger.info("unscoped_operation")
            lines = log_stream.getvalue().strip().split("\n")
            self.assertEqual(len(lines), 2)
            parsed_unscoped = json.loads(lines[1])
            self.assertNotIn("request_id", parsed_unscoped)
            self.assertNotIn("trace_id", parsed_unscoped)
        finally:
            test_logger.removeHandler(handler)

    def test_text_formatter_output(self):
        formatter = TextLogFormatter()
        record = logging.LogRecord(
            name="dev_logger",
            level=logging.WARNING,
            pathname=__file__,
            lineno=50,
            msg="Low storage remaining",
            args=(),
            exc_info=None,
        )
        record.request_id = "req-abcdef12345"
        record.free_mb = 120

        output = formatter.format(record)
        self.assertIn("[WARNING]", output)
        self.assertIn("[dev_logger]", output)
        self.assertIn("[req:req-abcd]", output)
        self.assertIn("Low storage remaining", output)
        self.assertIn("free_mb=120", output)

    def test_default_json_serializer(self):
        sample_uuid = uuid.uuid4()
        now = datetime.datetime.now(datetime.timezone.utc)
        self.assertEqual(default_json_serializer(sample_uuid), str(sample_uuid))
        self.assertEqual(default_json_serializer(now), now.isoformat())
        self.assertEqual(default_json_serializer({"a", "b"}), ["a", "b"])

    def test_cloud_trace_header_extraction(self):
        mock_req = MagicMock()

        # AWS ALB Trace ID
        mock_req.headers = {"x-amzn-trace-id": "Root=1-6789-abcdef"}
        self.assertEqual(extract_trace_id(mock_req), "Root=1-6789-abcdef")

        # GCP Cloud Trace Context
        mock_req.headers = {"x-cloud-trace-context": "105445aa7843bc8bf206b120001000/1;o=1"}
        self.assertEqual(extract_trace_id(mock_req), "105445aa7843bc8bf206b120001000/1;o=1")

        # W3C traceparent
        mock_req.headers = {"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"}
        self.assertEqual(
            extract_trace_id(mock_req),
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        )

        # None present
        mock_req.headers = {}
        self.assertIsNone(extract_trace_id(mock_req))

    def test_setup_logging_configures_root_logger(self):
        setup_logging(log_level="DEBUG", log_format="json")
        root = logging.getLogger()
        self.assertEqual(root.level, logging.DEBUG)
        self.assertTrue(len(root.handlers) > 0)
        self.assertIsInstance(root.handlers[0].formatter, JSONLogFormatter)

        # Switch to text format
        setup_logging(log_level="WARNING", log_format="text")
        root = logging.getLogger()
        self.assertEqual(root.level, logging.WARNING)
        self.assertIsInstance(root.handlers[0].formatter, TextLogFormatter)


if __name__ == "__main__":
    unittest.main()
