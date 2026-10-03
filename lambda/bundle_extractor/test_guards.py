"""Isolated unit tests for guards.py.

Verifies pure dependency-free execution with zero backend imports.
"""

import io
import os
import tempfile
import unittest
import zipfile

from guards import (
    MODALITY_ALLOWED_EXTENSIONS,
    check_zip_bomb,
    check_zip_slip_and_structure,
    discover_candidate_files,
    filter_by_modality,
)


class GuardsTests(unittest.TestCase):
    def test_check_zip_bomb_within_limit(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("media/hello.txt", b"hello world")
        buf.seek(0)
        with zipfile.ZipFile(buf, "r") as zf:
            total = check_zip_bomb(zf, max_uncompressed_bytes=1000)
            self.assertEqual(total, len(b"hello world"))

    def test_check_zip_bomb_exceeds_limit(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("media/large.bin", b"0" * 500)
        buf.seek(0)
        with zipfile.ZipFile(buf, "r") as zf:
            with self.assertRaises(ValueError) as ctx:
                check_zip_bomb(zf, max_uncompressed_bytes=100)
            self.assertIn("exceeds limit", str(ctx.exception))

    def test_check_zip_slip_detected(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("media/valid.txt", b"valid")
            zf.writestr("../etc/passwd", b"evil")
        buf.seek(0)
        with tempfile.TemporaryDirectory() as tmp_dir:
            with zipfile.ZipFile(buf, "r") as zf:
                with self.assertRaises(ValueError) as ctx:
                    check_zip_slip_and_structure(zf, tmp_dir)
                self.assertIn("Zip slip detected", str(ctx.exception))

    def test_check_missing_media_root(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("other_folder/file.png", b"data")
        buf.seek(0)
        with tempfile.TemporaryDirectory() as tmp_dir:
            with zipfile.ZipFile(buf, "r") as zf:
                with self.assertRaises(ValueError) as ctx:
                    check_zip_slip_and_structure(zf, tmp_dir)
                self.assertIn("Archive must contain a top-level 'media/' directory", str(ctx.exception))

    def test_check_valid_structure(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("media/photo.jpg", b"image-data")
        buf.seek(0)
        with tempfile.TemporaryDirectory() as tmp_dir:
            with zipfile.ZipFile(buf, "r") as zf:
                # Should not raise
                check_zip_slip_and_structure(zf, tmp_dir)

    def test_discover_candidate_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            media_dir = os.path.join(tmp_dir, "media")
            os.makedirs(os.path.join(media_dir, "sub", "__MACOSX"), exist_ok=True)
            os.makedirs(os.path.join(media_dir, ".hidden_dir"), exist_ok=True)

            # Valid files
            with open(os.path.join(media_dir, "f1.png"), "w") as f:
                f.write("test")
            with open(os.path.join(media_dir, "sub", "f2.jpg"), "w") as f:
                f.write("test")

            # Files to ignore
            with open(os.path.join(media_dir, "Thumbs.db"), "w") as f:
                f.write("db")
            with open(os.path.join(media_dir, ".DS_Store"), "w") as f:
                f.write("ds")
            with open(os.path.join(media_dir, "sub", "__MACOSX", "f3.jpg"), "w") as f:
                f.write("macosx")
            with open(os.path.join(media_dir, ".hidden_dir", "f4.jpg"), "w") as f:
                f.write("hidden")

            candidates = discover_candidate_files(media_dir)
            rel_paths = [rel for _, rel in candidates]
            self.assertEqual(rel_paths, ["f1.png", "sub/f2.jpg"])

    def test_filter_by_modality(self):
        candidates = [
            ("/path/media/track.wav", "track.wav"),
            ("/path/media/image.png", "image.png"),
            ("/path/media/video.mp4", "video.mp4"),
            ("/path/media/doc.pdf", "doc.pdf"),
        ]

        # Audio modality
        valid_audio, rejected_audio = filter_by_modality(candidates, "audio")
        self.assertEqual([rel for _, rel in valid_audio], ["track.wav"])
        self.assertEqual(len(rejected_audio), 3)

        # Image modality
        valid_img, rejected_img = filter_by_modality(candidates, "image")
        self.assertEqual([rel for _, rel in valid_img], ["image.png"])
        self.assertEqual(len(rejected_img), 3)

        # No modality filter
        valid_none, rejected_none = filter_by_modality(candidates, "")
        self.assertEqual(len(valid_none), 4)
        self.assertEqual(len(rejected_none), 0)


if __name__ == "__main__":
    unittest.main()
