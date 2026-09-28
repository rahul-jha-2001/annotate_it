# Annotation Sample Dataset Specification

Use this document to generate example datasets for every annotation type
implemented by the Annotation Experiment Platform.

The generated samples should be suitable for:

- manually testing experiment creation;
- testing annotator controls;
- testing gold-answer scoring and agreement;
- serving as example datasets for developers and users.

## Registered annotation types

There are 14 registered annotation-type keys. Categorical annotation has two
answer modes, so this document contains 15 example formats.

| Annotation key | Mode | Compatible media |
|---|---|---|
| `categorical` | Single choice | Audio, video, image |
| `categorical` | Multiple choice | Audio, video, image |
| `segment` | One label with temporal regions | Audio, video |
| `transcription` | Text transcription | Audio, video containing audio |
| `speaker_diarization` | Custom speaker regions | Audio, video containing audio |
| `speaker_identification` | Known-speaker regions | Audio, video containing audio |
| `sound_event` | Labeled sound regions | Audio, video containing audio |
| `speech_segmentation` | Speech/silence regions | Audio, video containing audio |
| `video_event` | Labeled video events | Video |
| `action_recognition` | Labeled actions | Video |
| `bounding_box` | Rectangular shapes | Image, video |
| `polygon` | Polygon shapes | Image, video |
| `polyline` | Paths and lines | Image, video |
| `ellipse` | Elliptical shapes | Image, video |
| `keypoint` | Labeled points | Image, video |

## Common dataset bundle

Each example dataset should use this structure:

```text
dataset-name/
├── media/
│   ├── sample_001.wav
│   └── sample_002.wav
├── metadata.csv
├── gold_answers.json
└── README.md
```

The application does not require the local `media/` directory name. The user
selects the media files, metadata CSV, and gold JSON separately in the creation
wizard. The directory is recommended for keeping generated fixtures organized.

### Media files

Use the following formats:

- audio: WAV or MP3;
- video: MP4 or WebM;
- image: PNG, JPEG, or WebP.

Create at least five media files per example dataset. Make at least two of them
gold samples. Keep files small enough for convenient local testing.

### `metadata.csv`

The CSV is optional in the product, but generated examples should include it so
metadata preview and qualification routing can be tested.

```csv
filename,language,difficulty,content_type
sample_001.wav,Hindi,2,Speech
sample_002.wav,English,1,Music
```

Requirements:

- encode the file as UTF-8;
- include a `filename` column;
- match media filenames exactly, including case and extension;
- include one row per media file;
- do not repeat filenames;
- keep filename text intact for non-ASCII filenames;
- additional columns may contain text, numeric, boolean, or categorical data.

### `gold_answers.json`

Every annotation type uses this outer envelope:

```json
[
  {
    "filename": "sample_001.wav",
    "answer": {}
  }
]
```

Requirements:

- the top-level value is a JSON array;
- every entry contains exactly one media `filename` and its `answer`;
- `filename` matches an uploaded media file exactly;
- only quality-check samples need to appear in this file;
- the object inside `answer` follows the selected annotation type;
- do not add undocumented fields because backend models reject extra fields.

## 1. Categorical — single choice

Compatible media: audio, video, or image.

### Experiment label schema

```json
{
  "annotation_type": "categorical",
  "schema_version": 1,
  "choices": ["Good", "Noisy", "Unusable"],
  "multi_select": false
}
```

### Annotation answer

```json
{
  "value": "Good"
}
```

### Gold file

```json
[
  {
    "filename": "sample_001.wav",
    "answer": {
      "value": "Good"
    }
  },
  {
    "filename": "sample_002.wav",
    "answer": {
      "value": "Noisy"
    }
  }
]
```

The value must be one of the configured choices. Gold scoring is exact equality.

## 2. Categorical — multiple choice

Compatible media: audio, video, or image.

### Experiment label schema

```json
{
  "annotation_type": "categorical",
  "schema_version": 1,
  "choices": ["Speech", "Music", "Noise"],
  "multi_select": true
}
```

### Annotation answer

```json
{
  "values": ["Speech", "Noise"]
}
```

### Gold file

```json
[
  {
    "filename": "sample_001.wav",
    "answer": {
      "values": ["Speech", "Noise"]
    }
  }
]
```

Values must be unique and belong to `choices`. Scoring uses Jaccard similarity.

## 3. Segment / temporal region

Compatible media: audio or video.

This annotation assigns one label to a collection of temporal regions.

### Experiment label schema

```json
{
  "annotation_type": "segment",
  "schema_version": 1,
  "choices": ["Good", "Bad"],
  "multi_select": false
}
```

### Annotation answer

```json
{
  "label": "Good",
  "regions": [
    {
      "start": 0.5,
      "end": 2.75
    },
    {
      "start": 4.0,
      "end": 6.25
    }
  ]
}
```

### Gold file

```json
[
  {
    "filename": "sample_001.wav",
    "answer": {
      "label": "Good",
      "regions": [
        {
          "start": 0.5,
          "end": 2.75
        }
      ]
    }
  }
]
```

`label` must belong to `choices`. Times are seconds, `start >= 0`, and
`end > start`. Temporal scoring uses region intersection-over-union after the
top-level labels match.

## 4. Transcription

Compatible media: audio or video containing audio.

### Experiment label schema

```json
{
  "annotation_type": "transcription",
  "schema_version": 1,
  "case_sensitive": false,
  "collapse_whitespace": true,
  "strip_punctuation": false,
  "minimum_length": 1
}
```

### Annotation answer

```json
{
  "text": "The expected spoken sentence."
}
```

### Gold file

```json
[
  {
    "filename": "sample_001.wav",
    "answer": {
      "text": "नमस्ते, आप कैसे हैं?"
    }
  },
  {
    "filename": "sample_002.wav",
    "answer": {
      "text": "Hello, how are you?"
    }
  }
]
```

The configured normalization rules are applied before word-edit similarity is
calculated. The normalized text must satisfy `minimum_length`.

## Shared labeled-temporal format

The next six annotation types use the same answer shape. Each temporal region
owns its label.

```json
{
  "regions": [
    {
      "start": 0.5,
      "end": 2.75,
      "label": "Some label"
    }
  ]
}
```

For every region, `start >= 0`, `end > start`, and `label` is non-empty. The
number of regions cannot exceed `max_regions`.

## 5. Speaker diarization

Compatible media: audio or video containing audio.

### Experiment label schema

```json
{
  "annotation_type": "speaker_diarization",
  "schema_version": 1,
  "choices": [],
  "allow_custom_labels": true,
  "max_regions": 500
}
```

### Gold file

```json
[
  {
    "filename": "conversation_001.wav",
    "answer": {
      "regions": [
        {
          "start": 0.0,
          "end": 2.4,
          "label": "Speaker 1"
        },
        {
          "start": 2.4,
          "end": 5.8,
          "label": "Speaker 2"
        },
        {
          "start": 5.8,
          "end": 8.1,
          "label": "Speaker 1"
        }
      ]
    }
  }
]
```

Labels are custom. Agreement aligns equivalent speaker clusters, so an
annotator using `Person A` can agree with gold data using `Speaker 1` when their
time regions correspond.

## 6. Speaker identification

Compatible media: audio or video containing audio.

### Experiment label schema

```json
{
  "annotation_type": "speaker_identification",
  "schema_version": 1,
  "choices": ["Rahul", "Priya", "Unknown"],
  "allow_custom_labels": false,
  "max_regions": 500
}
```

### Gold file

```json
[
  {
    "filename": "interview_001.wav",
    "answer": {
      "regions": [
        {
          "start": 0.0,
          "end": 3.2,
          "label": "Rahul"
        },
        {
          "start": 3.2,
          "end": 7.5,
          "label": "Priya"
        }
      ]
    }
  }
]
```

Every label must belong to `choices`.

## 7. Sound-event annotation

Compatible media: audio or video containing audio.

### Experiment label schema

```json
{
  "annotation_type": "sound_event",
  "schema_version": 1,
  "choices": ["Speech", "Music", "Noise"],
  "allow_custom_labels": false,
  "max_regions": 500
}
```

### Gold file

```json
[
  {
    "filename": "street_001.wav",
    "answer": {
      "regions": [
        {
          "start": 0.2,
          "end": 2.8,
          "label": "Speech"
        },
        {
          "start": 1.5,
          "end": 4.0,
          "label": "Noise"
        }
      ]
    }
  }
]
```

Overlapping regions are allowed. Every label must belong to `choices`.

## 8. Speech/silence segmentation

Compatible media: audio or video containing audio.

### Experiment label schema

```json
{
  "annotation_type": "speech_segmentation",
  "schema_version": 1,
  "choices": ["Speech", "Silence"],
  "allow_custom_labels": false,
  "max_regions": 500
}
```

### Gold file

```json
[
  {
    "filename": "recording_001.wav",
    "answer": {
      "regions": [
        {
          "start": 0.0,
          "end": 2.6,
          "label": "Speech"
        },
        {
          "start": 2.6,
          "end": 3.4,
          "label": "Silence"
        },
        {
          "start": 3.4,
          "end": 6.0,
          "label": "Speech"
        }
      ]
    }
  }
]
```

## 9. Video-event annotation

Compatible media: video only.

### Experiment label schema

```json
{
  "annotation_type": "video_event",
  "schema_version": 1,
  "choices": ["Scene change", "Object enters", "Object exits"],
  "allow_custom_labels": false,
  "max_regions": 500
}
```

### Gold file

```json
[
  {
    "filename": "security_001.mp4",
    "answer": {
      "regions": [
        {
          "start": 1.5,
          "end": 4.2,
          "label": "Object enters"
        },
        {
          "start": 8.0,
          "end": 9.1,
          "label": "Object exits"
        }
      ]
    }
  }
]
```

## 10. Action recognition

Compatible media: video only.

### Experiment label schema

```json
{
  "annotation_type": "action_recognition",
  "schema_version": 1,
  "choices": ["Walking", "Running", "Sitting"],
  "allow_custom_labels": false,
  "max_regions": 500
}
```

### Gold file

```json
[
  {
    "filename": "person_001.mp4",
    "answer": {
      "regions": [
        {
          "start": 0.0,
          "end": 3.5,
          "label": "Walking"
        },
        {
          "start": 3.5,
          "end": 6.8,
          "label": "Running"
        }
      ]
    }
  }
]
```

## Shared spatial format

The five spatial annotations support images and videos. They use this common
schema configuration:

```json
{
  "annotation_type": "TYPE_KEY",
  "schema_version": 1,
  "choices": ["Person", "Car"],
  "max_shapes": 100,
  "frame_aware": false,
  "time_tolerance": 0.1,
  "distance_tolerance": 0.1
}
```

### Coordinate rules

Coordinates are normalized to the inclusive range `[0, 1]`:

```text
normalized_x = pixel_x / media_width
normalized_y = pixel_y / media_height
```

For rectangular shapes, `x` and `y` identify the top-left corner.

```text
normalized_width  = pixel_width / media_width
normalized_height = pixel_height / media_height
```

Every shape requires:

- a non-empty `id` unique within the complete answer;
- a `label` contained in the schema's `choices`;
- valid normalized geometry contained inside the media.

### Image versus video

For image experiments:

```json
{
  "frame_aware": false
}
```

Image answers must not contain `time`.

For video experiments:

```json
{
  "frame_aware": true,
  "time_tolerance": 0.1
}
```

Every video shape must contain a non-negative `time` in seconds. Since IDs must
be unique within the answer, use frame-specific IDs such as
`car-1-at-1.25-seconds` rather than repeating one ID at multiple timestamps.

## 11. Bounding boxes

Compatible media: image or video.

### Experiment label schema

```json
{
  "annotation_type": "bounding_box",
  "schema_version": 1,
  "choices": ["Person", "Car"],
  "max_shapes": 100,
  "frame_aware": false,
  "time_tolerance": 0.1,
  "distance_tolerance": 0.1
}
```

### Image gold file

```json
[
  {
    "filename": "street_001.jpg",
    "answer": {
      "boxes": [
        {
          "id": "person-1",
          "label": "Person",
          "x": 0.1,
          "y": 0.15,
          "width": 0.25,
          "height": 0.7
        },
        {
          "id": "car-1",
          "label": "Car",
          "x": 0.45,
          "y": 0.5,
          "width": 0.4,
          "height": 0.3
        }
      ]
    }
  }
]
```

For every box, `width > 0`, `height > 0`, `x + width <= 1`, and
`y + height <= 1`.

### Video gold file

```json
[
  {
    "filename": "traffic_001.mp4",
    "answer": {
      "boxes": [
        {
          "id": "car-1-at-1.25-seconds",
          "label": "Car",
          "time": 1.25,
          "x": 0.2,
          "y": 0.45,
          "width": 0.35,
          "height": 0.25
        }
      ]
    }
  }
]
```

## 12. Polygons

Compatible media: image or video.

### Experiment label schema

```json
{
  "annotation_type": "polygon",
  "schema_version": 1,
  "choices": ["Building", "Road"],
  "max_shapes": 100,
  "frame_aware": false,
  "time_tolerance": 0.1,
  "distance_tolerance": 0.1
}
```

### Image gold file

```json
[
  {
    "filename": "city_001.jpg",
    "answer": {
      "polygons": [
        {
          "id": "building-1",
          "label": "Building",
          "points": [
            { "x": 0.1, "y": 0.1 },
            { "x": 0.7, "y": 0.1 },
            { "x": 0.75, "y": 0.65 },
            { "x": 0.15, "y": 0.7 }
          ]
        }
      ]
    }
  }
]
```

A polygon requires at least three points and must form valid, non-self-
intersecting geometry.

### Video answer

```json
{
  "polygons": [
    {
      "id": "object-1-at-2.5-seconds",
      "label": "Object",
      "time": 2.5,
      "points": [
        { "x": 0.1, "y": 0.1 },
        { "x": 0.5, "y": 0.1 },
        { "x": 0.3, "y": 0.6 }
      ]
    }
  ]
}
```

When using this answer, include `Object` in the experiment's `choices`.

## 13. Polylines

Compatible media: image or video.

### Experiment label schema

```json
{
  "annotation_type": "polyline",
  "schema_version": 1,
  "choices": ["Lane", "Path"],
  "max_shapes": 100,
  "frame_aware": false,
  "time_tolerance": 0.1,
  "distance_tolerance": 0.1
}
```

### Image gold file

```json
[
  {
    "filename": "road_001.jpg",
    "answer": {
      "polylines": [
        {
          "id": "lane-1",
          "label": "Lane",
          "points": [
            { "x": 0.1, "y": 0.8 },
            { "x": 0.4, "y": 0.5 },
            { "x": 0.8, "y": 0.2 }
          ]
        }
      ]
    }
  }
]
```

A polyline requires at least two distinct points. Add `time` to every polyline
in a video experiment.

## 14. Ellipses

Compatible media: image or video.

### Experiment label schema

```json
{
  "annotation_type": "ellipse",
  "schema_version": 1,
  "choices": ["Face", "Wheel"],
  "max_shapes": 100,
  "frame_aware": false,
  "time_tolerance": 0.1,
  "distance_tolerance": 0.1
}
```

### Image gold file

```json
[
  {
    "filename": "portrait_001.jpg",
    "answer": {
      "ellipses": [
        {
          "id": "face-1",
          "label": "Face",
          "x": 0.25,
          "y": 0.1,
          "width": 0.5,
          "height": 0.65
        }
      ]
    }
  }
]
```

Ellipses use their enclosing normalized rectangle. The same rectangular bounds
rules as bounding boxes apply. Add `time` to every ellipse in a video experiment.

## 15. Keypoints

Compatible media: image or video.

### Experiment label schema

```json
{
  "annotation_type": "keypoint",
  "schema_version": 1,
  "choices": ["Left eye", "Right eye", "Nose"],
  "max_shapes": 100,
  "frame_aware": false,
  "time_tolerance": 0.1,
  "distance_tolerance": 0.05
}
```

### Image gold file

```json
[
  {
    "filename": "face_001.jpg",
    "answer": {
      "keypoints": [
        {
          "id": "left-eye-1",
          "label": "Left eye",
          "x": 0.38,
          "y": 0.42
        },
        {
          "id": "right-eye-1",
          "label": "Right eye",
          "x": 0.62,
          "y": 0.42
        },
        {
          "id": "nose-1",
          "label": "Nose",
          "x": 0.5,
          "y": 0.57
        }
      ]
    }
  }
]
```

### Video gold file

```json
[
  {
    "filename": "face_001.mp4",
    "answer": {
      "keypoints": [
        {
          "id": "nose-at-1.25-seconds",
          "label": "Nose",
          "time": 1.25,
          "x": 0.5,
          "y": 0.57
        }
      ]
    }
  }
]
```

## Instructions for a data-generating agent

For each generated annotation dataset:

1. Select one annotation key and one compatible modality from the table.
2. Generate at least five small, valid media files.
3. Use filenames that clearly identify the sample and remain identical across
   the media file, `metadata.csv`, and `gold_answers.json`.
4. Generate a UTF-8 `metadata.csv` row for every media file.
5. Mark at least two samples as gold by including them in `gold_answers.json`.
6. Make every gold answer visibly verifiable from its media. For example, draw
   a visible rectangle in an image before describing its bounding-box geometry.
7. Include the exact experiment label schema in the dataset `README.md`.
8. Include a short explanation of what each gold answer represents.
9. Keep all time boundaries within the real audio/video duration.
10. Keep every normalized spatial coordinate within `[0, 1]`.
11. Do not include `time` in image spatial answers.
12. Include `time` in every video spatial shape.
13. Use unique shape IDs within each complete answer.
14. Do not include fields that are not shown in this specification.

## Final validation checklist

- [ ] Annotation key is registered and spelled exactly as documented.
- [ ] Modality is compatible with the annotation type.
- [ ] Media files open and play or render correctly.
- [ ] CSV is valid UTF-8.
- [ ] CSV contains the exact `filename` column.
- [ ] Every CSV filename matches one media file.
- [ ] Gold JSON is a top-level array.
- [ ] Every gold filename matches one media file.
- [ ] Every answer uses the correct top-level field.
- [ ] Every configured label is spelled consistently.
- [ ] Temporal boundaries are valid and inside media duration.
- [ ] Spatial coordinates are normalized and inside media bounds.
- [ ] Shape IDs are non-empty and unique within each answer.
- [ ] Image shapes omit `time`.
- [ ] Video shapes include non-negative `time`.
- [ ] No undocumented fields are present.
