import os
import zipfile
from typing import Dict, List, Set, Tuple

MODALITY_ALLOWED_EXTENSIONS: Dict[str, Set[str]] = {
    "audio": {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".wma"},
    "video": {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"},
    "text": {".txt", ".json", ".csv", ".md"},
}


def check_zip_bomb(zf: zipfile.ZipFile, max_uncompressed_bytes: int) -> int:
    """Returns total uncompressed size. Raises ValueError if it exceeds the limit."""
    total = sum(info.file_size for info in zf.infolist())
    if total > max_uncompressed_bytes:
        raise ValueError(
            f"Uncompressed archive size {total} bytes exceeds limit of {max_uncompressed_bytes} bytes"
        )
    return total


def check_zip_slip_and_structure(zf: zipfile.ZipFile, dest_dir: str) -> None:
    """Raises ValueError on path traversal or a missing top-level media/ directory."""
    dest_dir_abs = os.path.abspath(dest_dir)
    has_media_root = False
    for member in zf.infolist():
        norm_name = os.path.normpath(member.filename).replace("\\", "/")
        if norm_name.startswith("media/") or norm_name == "media":
            has_media_root = True

        target_path = os.path.abspath(os.path.join(dest_dir_abs, member.filename))
        if not (target_path == dest_dir_abs or target_path.startswith(dest_dir_abs + os.sep)):
            raise ValueError(f"Zip slip detected: path traversal attempt in {member.filename}")

    if not has_media_root:
        raise ValueError("Archive must contain a top-level 'media/' directory")


def discover_candidate_files(media_dir: str) -> List[Tuple[str, str]]:
    """Returns [(abs_path, rel_path), ...] for every real media file, skipping OS artifacts."""
    candidates: List[Tuple[str, str]] = []
    for root, dirs, files in os.walk(media_dir):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d != "__MACOSX"]
        for file in sorted(files):
            if file.startswith(".") or file == "Thumbs.db":
                continue
            abs_path = os.path.join(root, file)
            rel_path = os.path.relpath(abs_path, media_dir).replace("\\", "/")
            candidates.append((abs_path, rel_path))
    return candidates


def filter_by_modality(
    candidates: List[Tuple[str, str]], modality: str
) -> Tuple[List[Tuple[str, str]], List[Dict[str, str]]]:
    """Splits candidates into (valid, rejected). Rejected entries have {'filename', 'error'}."""
    allowed = MODALITY_ALLOWED_EXTENSIONS.get(modality.lower()) if modality else None
    valid: List[Tuple[str, str]] = []
    rejected: List[Dict[str, str]] = []
    for abs_path, rel_path in candidates:
        ext = os.path.splitext(rel_path)[1].lower()
        if allowed and ext not in allowed:
            rejected.append({
                "filename": rel_path,
                "error": f"Invalid extension '{ext}' for modality '{modality}'",
            })
        else:
            valid.append((abs_path, rel_path))
    return valid, rejected
