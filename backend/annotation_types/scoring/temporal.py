from __future__ import annotations

from typing import Callable, Sequence, TypeVar


RegionT = TypeVar("RegionT")


def interval_iou(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    intersection = max(0.0, min(end_a, end_b) - max(start_a, start_b))
    union = (end_a - start_a) + (end_b - start_b) - intersection
    return intersection / union if union > 0 else 0.0


def interval_overlap(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    return max(0.0, min(end_a, end_b) - max(start_a, start_b))


def greedy_region_match(
    left: Sequence[RegionT],
    right: Sequence[RegionT],
    score: Callable[[RegionT, RegionT], float],
) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    candidates = [
        (score(left_item, right_item), left_index, right_index)
        for left_index, left_item in enumerate(left)
        for right_index, right_item in enumerate(right)
    ]
    candidates.sort(key=lambda value: (-value[0], value[1], value[2]))
    used_left: set[int] = set()
    used_right: set[int] = set()
    total = 0.0
    for value, left_index, right_index in candidates:
        if value <= 0 or left_index in used_left or right_index in used_right:
            continue
        used_left.add(left_index)
        used_right.add(right_index)
        total += value
    return total / max(len(left), len(right))
