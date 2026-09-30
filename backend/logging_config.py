"""Cloud-ready structured logging configuration for Annotate It backend.

Provides:
- ContextVar-based request, trace, user, experiment, and annotator correlation IDs.
- JSONLogFormatter producing single-line structured JSON records for CloudWatch,
  GCP Cloud Logging, Datadog, and container runtimes.
- TextLogFormatter for local development ergonomics.
- Automatic sanitization of sensitive fields (tokens, secrets, passwords).
- Root logger setup and third-party logger tuning.
"""

from __future__ import annotations

import contextvars
import datetime
import json
import logging
import sys
import traceback
from typing import Any, Dict, Optional
import uuid

# Context variables for distributed request tracing and domain correlation
current_request_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_request_id", default=None
)
current_trace_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_trace_id", default=None
)
current_user_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_user_id", default=None
)
current_experiment_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_experiment_id", default=None
)
current_annotator_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "current_annotator_id", default=None
)

# Standard logging record attributes to exclude when extracting extra fields
_STANDARD_LOG_RECORD_ATTRS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "id",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
    }
)

_CONTEXT_KEYS = frozenset(
    {"request_id", "trace_id", "user_id", "experiment_id", "annotator_id"}
)

# Sensitive key patterns to redact in structured logs
_SENSITIVE_KEY_SUBSTRINGS = ("password", "secret", "session_token", "private_key")


def sanitize_value(key: str, value: Any) -> Any:
    """Mask sensitive string values whose keys resemble passwords, secrets, or session tokens."""
    key_lower = key.lower()
    if any(sub in key_lower for sub in _SENSITIVE_KEY_SUBSTRINGS):
        if value is None:
            return None
        return "***REDACTED***"
    if isinstance(value, dict):
        return {k: sanitize_value(str(k), v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_value(key, v) for v in value]
    return value


def default_json_serializer(obj: Any) -> Any:
    """Serialize common non-JSON types (UUID, datetime, set, etc.)."""
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, (set, frozenset)):
        return sorted(list(obj))
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    return str(obj)


def set_logging_context(
    request_id: Optional[str] = None,
    trace_id: Optional[str] = None,
    user_id: Optional[str] = None,
    experiment_id: Optional[str] = None,
    annotator_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Bind correlation identifiers to the current async context and return reset tokens."""
    tokens = {}
    if request_id is not None:
        tokens["request_id"] = current_request_id.set(request_id)
    if trace_id is not None:
        tokens["trace_id"] = current_trace_id.set(trace_id)
    if user_id is not None:
        tokens["user_id"] = current_user_id.set(user_id)
    if experiment_id is not None:
        tokens["experiment_id"] = current_experiment_id.set(experiment_id)
    if annotator_id is not None:
        tokens["annotator_id"] = current_annotator_id.set(annotator_id)
    return tokens


def reset_logging_context(tokens: Dict[str, Any]) -> None:
    """Reset context variables using the tokens returned by set_logging_context."""
    if "request_id" in tokens:
        current_request_id.reset(tokens["request_id"])
    if "trace_id" in tokens:
        current_trace_id.reset(tokens["trace_id"])
    if "user_id" in tokens:
        current_user_id.reset(tokens["user_id"])
    if "experiment_id" in tokens:
        current_experiment_id.reset(tokens["experiment_id"])
    if "annotator_id" in tokens:
        current_annotator_id.reset(tokens["annotator_id"])


def clear_logging_context() -> None:
    """Clear all correlation identifiers in the current context."""
    current_request_id.set(None)
    current_trace_id.set(None)
    current_user_id.set(None)
    current_experiment_id.set(None)
    current_annotator_id.set(None)


class LoggingContextFilter(logging.Filter):
    """Filter that injects context variables into each LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        req_id = current_request_id.get()
        if req_id is not None and getattr(record, "request_id", None) is None:
            record.request_id = req_id

        trace_id = current_trace_id.get()
        if trace_id is not None and getattr(record, "trace_id", None) is None:
            record.trace_id = trace_id

        user_id = current_user_id.get()
        if user_id is not None and getattr(record, "user_id", None) is None:
            record.user_id = user_id

        exp_id = current_experiment_id.get()
        if exp_id is not None and getattr(record, "experiment_id", None) is None:
            record.experiment_id = exp_id

        ann_id = current_annotator_id.get()
        if ann_id is not None and getattr(record, "annotator_id", None) is None:
            record.annotator_id = ann_id
        return True


class JSONLogFormatter(logging.Formatter):
    """Formats log records as structured, single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        # Determine UTC ISO timestamp
        created_dt = datetime.datetime.fromtimestamp(
            record.created, tz=datetime.timezone.utc
        )
        timestamp_str = created_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        message = record.getMessage()

        payload: Dict[str, Any] = {
            "timestamp": timestamp_str,
            "level": record.levelname,
            "logger": record.name,
            "message": message,
        }

        # Context correlation fields
        for field in ("request_id", "trace_id", "user_id", "experiment_id", "annotator_id"):
            val = getattr(record, field, None)
            if val is not None:
                payload[field] = str(val)

        # Process any extra fields attached to the record
        for key, value in record.__dict__.items():
            if (
                key not in _STANDARD_LOG_RECORD_ATTRS
                and key not in _CONTEXT_KEYS
                and key not in payload
                and not key.startswith("_")
            ):
                payload[key] = sanitize_value(key, value)

        # Format exception information if present
        if record.exc_info:
            exc_type, exc_val, exc_tb = record.exc_info
            payload["exception"] = {
                "type": getattr(exc_type, "__name__", str(exc_type)),
                "message": str(exc_val),
                "stacktrace": traceback.format_exception(exc_type, exc_val, exc_tb),
            }
        elif record.stack_info:
            payload["stack_info"] = record.stack_info

        return json.dumps(payload, default=default_json_serializer, ensure_ascii=False)


class TextLogFormatter(logging.Formatter):
    """Formats log records as readable text for local development."""

    def format(self, record: logging.LogRecord) -> str:
        created_dt = datetime.datetime.fromtimestamp(
            record.created, tz=datetime.timezone.utc
        )
        timestamp_str = created_dt.strftime("%Y-%m-%d %H:%M:%S")

        req_id = getattr(record, "request_id", None)
        req_prefix = f" [req:{req_id[:8]}]" if req_id else ""

        message = record.getMessage()

        # Append extra fields if present
        extras = []
        for key, value in record.__dict__.items():
            if (
                key not in _STANDARD_LOG_RECORD_ATTRS
                and key not in ("request_id", "trace_id", "user_id", "experiment_id", "annotator_id")
                and not key.startswith("_")
            ):
                sanitized = sanitize_value(key, value)
                extras.append(f"{key}={sanitized}")

        extra_str = f" ({', '.join(extras)})" if extras else ""
        formatted = f"{timestamp_str} [{record.levelname:<7}] [{record.name}]{req_prefix} {message}{extra_str}"

        if record.exc_info:
            formatted += "\n" + "".join(
                traceback.format_exception(*record.exc_info)
            ).rstrip()
        return formatted


def setup_logging(log_level: str = "INFO", log_format: str = "json") -> None:
    """Configure the root logger with the appropriate formatter and context filter."""
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)

    root_logger = logging.getLogger()
    root_logger.setLevel(numeric_level)

    # Clear existing handlers to prevent duplicate lines
    for handler in list(root_logger.handlers):
        root_logger.removeHandler(handler)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setLevel(numeric_level)
    stream_handler.addFilter(LoggingContextFilter())

    if log_format.lower() == "text":
        formatter = TextLogFormatter()
    else:
        formatter = JSONLogFormatter()

    stream_handler.setFormatter(formatter)
    root_logger.addHandler(stream_handler)

    # Disable uvicorn.access to avoid double-logging requests (handled by FastAPI middleware)
    logging.getLogger("uvicorn.access").disabled = True
    # Ensure uvicorn.error propagates to root logger
    logging.getLogger("uvicorn.error").handlers = []
    logging.getLogger("uvicorn.error").propagate = True
