from __future__ import annotations

import string


def normalize_text(
    value: str,
    *,
    case_sensitive: bool,
    collapse_whitespace: bool,
    strip_punctuation: bool,
) -> str:
    normalized = value
    if not case_sensitive:
        normalized = normalized.casefold()
    if strip_punctuation:
        normalized = normalized.translate(str.maketrans("", "", string.punctuation))
    if collapse_whitespace:
        normalized = " ".join(normalized.split())
    return normalized.strip()


def word_edit_distance(left: str, right: str) -> int:
    left_words = left.split()
    right_words = right.split()
    previous = list(range(len(right_words) + 1))
    for left_index, left_word in enumerate(left_words, start=1):
        current = [left_index]
        for right_index, right_word in enumerate(right_words, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_word != right_word),
                )
            )
        previous = current
    return previous[-1]


def word_edit_similarity(left: str, right: str) -> float:
    denominator = max(len(left.split()), len(right.split()), 1)
    return 1.0 - min(1.0, word_edit_distance(left, right) / denominator)
