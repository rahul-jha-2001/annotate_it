"""
Generates a sample dataset matching your platform's REAL 3-input structure:
  1. Audio files (with realistic names, incl. non-ASCII to match your real upload)
  2. metadata.csv (language, content_type, content_group, difficulty, verified)
  3. gold_answers.json (segment-type gold answers, WITH REAL region timestamps
     tied to actual inserted events -- not placeholder values)

Each gold region is generated from the actual audio content, so it's a genuine
correctness fixture: your scoring engine's IoU/gold_match should score a
perfect submission as ~1.0 and a wrong one as meaningfully lower, not just
pass trivially because every file shares the same fake timestamp.
"""

import numpy as np
from scipy.io import wavfile
import json
import os
import random

random.seed(7)
np.random.seed(7)

OUT_DIR = "dataset"
os.makedirs(OUT_DIR, exist_ok=True)

SR = 16000
QUALITY_LABELS = ["Good", "Noisy", "Unusable"]

# Realistic track catalog: mirrors your real upload (music/devotional/instrumental
# clips, mixed English/Hindi/Sanskrit titles, mixed languages/content types)
TRACKS = [
    {"filename": "Mridangam's Silent Pulse_1.mp3", "language": "None", "content_type": "Instrumental", "content_group": "Percussion", "difficulty": 1},
    {"filename": "Mridangam's Silent Pulse_2.mp3", "language": "None", "content_type": "Instrumental", "content_group": "Percussion", "difficulty": 2},
    {"filename": "Temple Bell Echoes.mp3", "language": "None", "content_type": "Instrumental", "content_group": "Bells", "difficulty": 1},
    {"filename": "कमल पे विराजे.mp3", "language": "Hindi", "content_type": "Vocal", "content_group": "Devotional", "difficulty": 2},
    {"filename": "महालक्ष्मी स्तुति.mp3", "language": "Sanskrit", "content_type": "Vocal", "content_group": "Devotional", "difficulty": 3},
    {"filename": "Flute Meditation Loop.mp3", "language": "None", "content_type": "Instrumental", "content_group": "Wind", "difficulty": 1},
    {"filename": "Evening Aarti Chant.mp3", "language": "Hindi", "content_type": "Vocal", "content_group": "Devotional", "difficulty": 2},
    {"filename": "Tabla Practice Session.mp3", "language": "None", "content_type": "Instrumental", "content_group": "Percussion", "difficulty": 2},
    {"filename": "संस्कृत श्लोक पाठ.mp3", "language": "Sanskrit", "content_type": "Vocal", "content_group": "Devotional", "difficulty": 3},
    {"filename": "Sitar Improvisation.mp3", "language": "None", "content_type": "Instrumental", "content_group": "String", "difficulty": 2},
]

NOISE_BY_QUALITY = {"Good": 0.01, "Noisy": 0.05, "Unusable": 0.12}


def make_background(duration_s, sr, noise_level):
    n = int(duration_s * sr)
    return (np.random.randn(n) * noise_level).astype(np.float64)

def make_tone_burst(duration_s, sr, freq=440.0, amp=0.5):
    t = np.linspace(0, duration_s, int(duration_s * sr), endpoint=False)
    envelope = np.hanning(len(t))
    return amp * envelope * np.sin(2 * np.pi * freq * t)

def insert_event(audio, sr, start_s, event_audio):
    start_i = int(start_s * sr)
    end_i = start_i + len(event_audio)
    if end_i > len(audio):
        event_audio = event_audio[: len(audio) - start_i]
        end_i = len(audio)
    audio[start_i:end_i] += event_audio
    return audio


def generate_clip(track, duration_s=8.0):
    quality = random.choice(QUALITY_LABELS)
    audio = make_background(duration_s, SR, NOISE_BY_QUALITY[quality])

    # Insert ONE clear "primary event" region -- this is what the gold
    # segment answer will point to. Real start/end, not a fixed placeholder.
    start = round(random.uniform(1.0, duration_s - 3.5), 3)
    dur = round(random.uniform(1.2, 2.5), 3)
    end = round(start + dur, 3)
    freq = random.choice([330, 440, 550, 660])
    event_audio = make_tone_burst(dur, SR, freq=freq, amp=0.6)
    audio = insert_event(audio, SR, start, event_audio)

    peak = np.max(np.abs(audio)) or 1.0
    audio = (audio / peak * 0.9 * 32767).astype(np.int16)

    # write as .wav (renamed to .mp3 extension to match your real filenames --
    # note: this is still WAV-encoded audio; rename to .wav if your platform
    # validates file content, not just extension)
    out_path = os.path.join(OUT_DIR, track["filename"].replace(".mp3", ".wav"))
    wavfile.write(out_path, SR, audio)

    return {
        "filename": track["filename"].replace(".mp3", ".wav"),
        "quality": quality,
        "region": {"start": start, "end": end},
    }


def main():
    metadata_rows = []
    gold_answers = []
    ground_truth = []

    gold_filenames = set(random.sample([t["filename"] for t in TRACKS], k=4))

    for track in TRACKS:
        result = generate_clip(track)
        filename = result["filename"]

        metadata_rows.append(
            f'{filename},{track["language"]},{track["content_type"]},'
            f'{track["content_group"]},{track["difficulty"]},true'
        )

        ground_truth.append({
            "filename": filename,
            "quality_label": result["quality"],
            "region": result["region"],
            "metadata": track,
        })

        if track["filename"] in gold_filenames:
            gold_answers.append({
                "filename": filename,
                "answer": {
                    "label": result["quality"],
                    "regions": [result["region"]],
                },
            })

    with open(os.path.join(OUT_DIR, "metadata.csv"), "w", encoding="utf-8") as f:
        f.write("filename,language,content_type,content_group,difficulty,verified\n")
        f.write("\n".join(metadata_rows) + "\n")

    with open(os.path.join(OUT_DIR, "gold_answers.json"), "w", encoding="utf-8") as f:
        json.dump(gold_answers, f, indent=2, ensure_ascii=False)

    with open(os.path.join(OUT_DIR, "ground_truth.json"), "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, indent=2, ensure_ascii=False)

    print(f"Generated {len(TRACKS)} clips in {OUT_DIR}/")
    print(f"  {len(gold_answers)} marked as gold, each with a REAL region tied to actual audio content")
    print(f"  metadata.csv includes 'None' language values (Instrumental tracks) -- verify your")
    print(f"  ingestion doesn't mis-treat the literal string 'None' as a real routable category.")


if __name__ == "__main__":
    main()
