from typing import Any, Dict

from annotation_types import get_type


def normalize_label_schema(schema: Any) -> Dict[str, Any]:
    """Convert the pre-registry list schema into the current single-type shape."""
    if isinstance(schema, dict):
        return schema
    if not isinstance(schema, list) or not schema:
        raise ValueError("Experiment has an invalid label schema")

    annotation_types = {
        entry.get("type")
        for entry in schema
        if isinstance(entry, dict) and entry.get("type")
    }
    if len(annotation_types) != 1:
        raise ValueError(
            "Legacy experiment schema must contain exactly one annotation type"
        )
    annotation_type = annotation_types.pop()
    choices = [
        entry["name"]
        for entry in schema
        if isinstance(entry, dict) and isinstance(entry.get("name"), str)
    ]
    normalized = {
        "annotation_type": annotation_type,
        "choices": choices,
        "multi_select": False,
    }
    return get_type(annotation_type).validate_config(normalized)
