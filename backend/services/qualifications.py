from typing import Any, Dict, List


def validate_sample_metadata(
    metadata: Dict[str, Any], schema: List[Dict[str, Any]]
) -> Dict[str, Any]:
    definitions = {field["key"]: field for field in schema}
    # Only validate fields that have an explicit schema definition.
    # Arbitrary / open-ended metadata fields are accepted as-is without restriction.
    for key, value in metadata.items():
        if key not in definitions:
            continue
        definition = definitions[key]
        field_type = definition.get("type")
        if field_type in {"text", "choice"} and not isinstance(value, str):
            raise ValueError(f"metadata '{key}' must be text")
        if field_type == "choice" and value not in definition.get("options", []):
            raise ValueError(f"metadata '{key}' has an unknown option")
        if field_type == "number" and (
            isinstance(value, bool) or not isinstance(value, (int, float))
        ):
            raise ValueError(f"metadata '{key}' must be a number")
        if field_type == "boolean" and not isinstance(value, bool):
            raise ValueError(f"metadata '{key}' must be true or false")
    return metadata


def validate_qualification_answers(
    answers: Dict[str, Any], form: List[Dict[str, Any]]
) -> Dict[str, Any]:
    questions = {question["key"]: question for question in form}
    unknown = sorted(set(answers) - set(questions))
    if unknown:
        raise ValueError(f"unknown qualification answers: {', '.join(unknown)}")
    missing = [
        question["key"]
        for question in form
        if question.get("required", True) and question["key"] not in answers
    ]
    if missing:
        raise ValueError(f"missing required answers: {', '.join(missing)}")

    for key, value in answers.items():
        question = questions[key]
        question_type = question["type"]
        options = question.get("options", [])
        if question_type == "single_choice":
            if not isinstance(value, str) or value not in options:
                raise ValueError(f"answer '{key}' must be one of its configured options")
        elif question_type == "multi_choice":
            if not isinstance(value, list) or any(item not in options for item in value):
                raise ValueError(f"answer '{key}' contains an unknown option")
            if len(value) != len(set(value)):
                raise ValueError(f"answer '{key}' contains duplicate options")
        elif question_type == "boolean" and not isinstance(value, bool):
            raise ValueError(f"answer '{key}' must be true or false")
        elif question_type == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"answer '{key}' must be a number")
            if question.get("minimum") is not None and value < question["minimum"]:
                raise ValueError(f"answer '{key}' is below the minimum")
            if question.get("maximum") is not None and value > question["maximum"]:
                raise ValueError(f"answer '{key}' is above the maximum")
        elif question_type == "text" and (
            not isinstance(value, str) or not value.strip() or len(value) > 2000
        ):
            raise ValueError(f"answer '{key}' must be non-empty text up to 2000 characters")
    return answers


def sample_matches_qualifications(
    metadata: Dict[str, Any], answers: Dict[str, Any], rules: List[Dict[str, Any]]
) -> bool:
    for rule in rules:
        sample_value = metadata.get(rule["metadata_field"])
        answer_value = answers.get(rule["question_key"])
        if sample_value is None or answer_value is None:
            return False
        operator = rule["operator"]
        if operator == "equals" and sample_value != answer_value:
            return False
        if operator == "in" and (
            not isinstance(answer_value, list) or sample_value not in answer_value
        ):
            return False
        if operator == "gte":
            if isinstance(answer_value, bool) or not isinstance(answer_value, (int, float)):
                return False
            try:
                numeric_sample = float(sample_value)
            except (ValueError, TypeError):
                return False
            if answer_value < numeric_sample:
                return False
    return True
