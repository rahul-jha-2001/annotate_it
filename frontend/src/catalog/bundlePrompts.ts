import { getAnnotationPlugin } from "../plugins/annotations/registry";

export const MAX_ZIP_GB = 2;

export const SELF_CHECK_SCRIPT = `import csv, json, os, unicodedata, zipfile
from collections import Counter

ZIP, CSV, GOLD = "dataset_media.zip", "metadata.csv", "gold_answers.json"
problems, notes = [], []

with zipfile.ZipFile(ZIP) as z:
    entries = [n for n in z.namelist() if not n.endswith("/")]
files = set()
for n in entries:
    parts = n.split("/")
    if len(parts) != 2 or parts[0] != "media":
        problems.append(f"zip entry is not directly inside media/: {n}")
    elif parts[1].startswith(".") or parts[1] == "Thumbs.db":
        problems.append(f"hidden/system file in zip: {n}")
    else:
        files.add(parts[1])
for f in sorted(files):
    if not unicodedata.is_normalized("NFC", f):
        problems.append(f"filename is not NFC-normalized (may fail to match): {f!r}")
if len(files) != len([n for n in entries if n.startswith("media/")]):
    problems.append("duplicate filenames inside media/")

if os.path.exists(CSV):
    with open(CSV, encoding="utf-8", newline="") as fh:  # a BOM will show up below
        rows = list(csv.DictReader(fh))
    if not rows or "filename" not in rows[0]:
        problems.append("metadata.csv has no 'filename' column (or is empty, or has a BOM)")
    else:
        names = [r["filename"] for r in rows]
        for n, c in Counter(names).items():
            if c > 1:
                problems.append(f"metadata.csv: duplicate filename {n!r}")
        for n in sorted(set(names) - files):
            problems.append(f"metadata.csv lists a file that is not in the zip: {n!r}")
        for n in sorted(files - set(names)):
            notes.append(f"zip file has no metadata row: {n!r}")
else:
    notes.append("no metadata.csv produced")

if os.path.exists(GOLD):
    with open(GOLD, encoding="utf-8") as fh:
        gold = json.load(fh)
    if not isinstance(gold, list):
        problems.append("gold_answers.json must be a JSON array")
    else:
        seen = Counter()
        for i, e in enumerate(gold):
            if not isinstance(e, dict) or set(e) != {"filename", "answer"}:
                problems.append(f"gold entry {i}: must have exactly 'filename' and 'answer'")
                continue
            seen[e["filename"]] += 1
            if e["filename"] not in files:
                problems.append(f"gold entry {i}: {e['filename']!r} is not in the zip (blocks deployment)")
        for n, c in seen.items():
            if c > 1:
                problems.append(f"gold_answers.json: duplicate filename {n!r}")
        notes.append(f"{len(gold)} gold entries")
else:
    notes.append("no gold_answers.json produced (deployment needs at least one gold entry when quality checks are on)")

print(f"{len(files)} media files in zip")
print("PROBLEMS:" if problems else "No problems found.")
for p in problems: print("  -", p)
print("NOTES:")
for n in notes: print("  -", n)
raise SystemExit(1 if problems else 0)`;

export const PREAMBLE_TEMPLATE = `You are preparing a dataset for upload to TaskGlass, a data annotation platform.
The annotation task is: {{TASK_NAME}}. Compatible media: {{MEDIA_TYPES}}.

Produce THREE separate deliverables from the user's raw files:

  1. dataset_media.zip   contains ONLY a top-level folder named media/ with every media file.
  2. metadata.csv        a separate file, NOT inside the zip. Optional.
  3. gold_answers.json   a separate file, NOT inside the zip. Optional.

They are separate because the zip uploads and extracts in the background (it can be
large), while metadata and gold answers are uploaded on their own so the designer can
keep configuring the experiment in the meantime.

STEP 1. ASK THE USER (skip anything already answered):
  - The exact labels/choices for this task, spelled exactly as they will be entered
    when the experiment is created. Never invent or guess them. (See the task section
    below for what to ask for this task.)
  - Which files should be gold (known-correct) examples, and the correct answer for
    each. If none, skip gold_answers.json.
  - Any descriptive columns they want in metadata.csv (language, difficulty, source...).
    Optional.

STEP 2. THE ZIP (dataset_media.zip)
  - One top-level folder named exactly media/. Put every file directly inside it with
    no subfolders. Matching is by filename only, so two files with the same name in
    different subfolders would collide.
  - Keep original filenames exactly: same spelling, case, and extension. Keep non-ASCII
    names (for example Hindi or Sanskrit titles) intact. Do not rename, transliterate,
    or clean them up. Write names in Unicode NFC form consistently across the zip,
    metadata.csv, and gold_answers.json.
  - Allowed file types: audio .wav .mp3; video .mp4 .webm; image .png .jpg .jpeg .webp.
    Files of an unsupported type are rejected individually, so leave them out.
  - Put nothing else in the zip: no metadata.csv, no gold_answers.json, no hidden or
    system files (.DS_Store, Thumbs.db, __MACOSX).
  - Use a standard .zip. Maximum archive size: {{MAX_ZIP_GB}} GB. If the dataset is
    larger, tell the user instead of producing an archive that will be rejected.

STEP 3. metadata.csv (optional, but if you produce it, it must cover every media file)
  - Plain UTF-8 without a BOM, with a header row.
  - A column named exactly \`filename\`, with one row per media file, matching the zip's
    filenames exactly. No duplicate filenames.
  - Any other columns are optional and can hold text, numbers, true/false, or
    categories. Use short descriptive header names.
  - For a missing value, leave the cell empty. Do not write None, null, or N/A.

STEP 4. gold_answers.json (optional)
  - A top-level JSON array. Each element is exactly {"filename": "...", "answer": {...}}
    and nothing else. Extra fields are rejected.
  - Include entries only for files the user designated as gold.
  - Every \`filename\` must exactly match a file in the zip. A gold entry that points at
    a file not in the zip blocks deployment.
  - If the experiment uses quality checks (the default), at least one gold entry is
    required before it can be deployed. Remind the user of this if they gave none.
  - The shape of "answer" depends on the task. See the task section below.

STEP 5. VERIFY BEFORE DELIVERING
  If you can run code, run the check below (adjust the paths) and fix everything under
  PROBLEMS. If you cannot run code, perform the same checks by hand. Then tell the user
  the file counts and anything listed under NOTES.

\`\`\`python
${SELF_CHECK_SCRIPT}
\`\`\`

This script checks structure and filename agreement only. The answer shapes themselves are checked against the rules in each task section below.`;

export const SHARED_FRAGMENTS = {
  TEMPORAL_REGIONS: `TIME RULES
  - Times are in seconds from the start of the file (decimals are fine).
  - For every region: start >= 0 and end > start, and end must not exceed the file's
    real duration. Read durations with a media tool such as ffprobe. Do not guess.
  - At most {{MAX_REGIONS}} regions per file (the default experiment limit).
  - Labels must be spelled exactly as the user gave them.`,

  NORMALIZED_COORDINATES: `COORDINATE RULES
  - All coordinates are normalized to the range 0 to 1, with the origin at the top-left:
      x = pixel_x / media_width        y = pixel_y / media_height
      width = pixel_width / media_width    height = pixel_height / media_height
    Read the real media dimensions with an image or video library. Do not guess.
  - Round to 4 to 6 decimals, then re-check bounds. For boxes and ellipses,
    x + width <= 1 and y + height <= 1 must still hold after rounding. Clamp if rounding
    pushed a value over.
  - Every shape needs a non-empty \`id\`, unique within that file's answer, and a \`label\`
    from the user's list.
  - Images: omit the \`time\` field entirely.
    Videos: every shape MUST have \`time\` (seconds, >= 0). The same object at different
    times is a separate shape with its own id and time. Put the time in the id
    (for example "car-1-at-1.25s") so ids stay unique.
  - At most {{MAX_SHAPES}} shapes per answer (the default experiment limit).`,
} as const;

export type FragmentKey = keyof typeof SHARED_FRAGMENTS;

export interface TaskSectionDefinition {
  key: string;
  variant?: "single_choice" | "multiple_choice";
  taskName: string;
  mediaTypes: string;
  uses: FragmentKey[];
  askUser: string;
  exampleAnswer: Record<string, unknown>;
  description: string;
  schemaVersion: number;
}

export const TASK_SECTIONS: TaskSectionDefinition[] = [
  {
    key: "categorical",
    variant: "single_choice",
    taskName: "categorical (single choice)",
    mediaTypes: "audio, video, image",
    uses: [],
    askUser: "the list of choices (one will be selected per file).",
    exampleAnswer: { value: "<one of the user's choices>" },
    description: "`value` must exactly equal one of the choices (case-sensitive).",
    schemaVersion: 1,
  },
  {
    key: "categorical",
    variant: "multiple_choice",
    taskName: "categorical (multiple choice)",
    mediaTypes: "audio, video, image",
    uses: [],
    askUser: "the list of choices, and confirm that more than one may apply to a file.",
    exampleAnswer: { values: ["<choice>", "<another choice>"] },
    description: "The field is `values` (plural). Every value must be one of the choices, with no duplicates inside one answer.",
    schemaVersion: 1,
  },
  {
    key: "segment",
    taskName: "segment (one label, one or more time regions)",
    mediaTypes: "audio, video",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "the list of labels, and for each gold file the label plus the start and end of each region.",
    exampleAnswer: {
      label: "<one of the user's labels>",
      regions: [{ start: 0.5, end: 2.75 }],
    },
    description: "One label applies to every region in the answer. If a gold file needs different labels on different regions, this task type cannot express it. Tell the user to use sound_event, video_event, or speaker_diarization instead.",
    schemaVersion: 1,
  },
  {
    key: "transcription",
    taskName: "transcription",
    mediaTypes: "audio, video with audio",
    uses: [],
    askUser: "the exact transcript for each gold file, and the language.",
    exampleAnswer: {
      text: "<the transcript exactly as the user provided it>",
    },
    description: "Do not correct, normalize, or clean up the user's text. The platform applies its own configured normalization when scoring. The text must be non-empty. Non-Latin scripts are fine; keep them as written.",
    schemaVersion: 1,
  },
  {
    key: "speaker_diarization",
    taskName: "speaker_diarization",
    mediaTypes: "audio, video with audio",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "who speaks when in each gold file. Speaker labels are free-form (for example \"Speaker 1\"), but use the same label for the same person throughout one file.",
    exampleAnswer: {
      regions: [{ start: 0.0, end: 2.4, label: "<speaker label>" }],
    },
    description: "Labels are not restricted to a list for this type.",
    schemaVersion: 1,
  },
  {
    key: "speaker_identification",
    taskName: "speaker_identification",
    mediaTypes: "audio, video with audio",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "the closed list of speaker names (including any \"Unknown\" option they want), and who speaks when in each gold file.",
    exampleAnswer: {
      regions: [{ start: 0.0, end: 3.2, label: "<one of the user's names>" }],
    },
    description: "Every label must be exactly one of the listed names.",
    schemaVersion: 1,
  },
  {
    key: "sound_event",
    taskName: "sound_event",
    mediaTypes: "audio, video with audio",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "the list of event labels, and each event's start, end, and label in each gold file.",
    exampleAnswer: {
      regions: [{ start: 0.2, end: 2.8, label: "<one of the user's labels>" }],
    },
    description: "Regions may overlap. Every label must be one of the user's labels.",
    schemaVersion: 1,
  },
  {
    key: "speech_segmentation",
    taskName: "speech_segmentation",
    mediaTypes: "audio, video with audio",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "the labels they use (typically a speech label and a silence label, but use exactly their wording), and the boundaries in each gold file. Ask whether gaps between regions are expected.",
    exampleAnswer: {
      regions: [{ start: 0.0, end: 2.6, label: "<one of the user's labels>" }],
    },
    description: "",
    schemaVersion: 1,
  },
  {
    key: "video_event",
    taskName: "video_event",
    mediaTypes: "video only",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "the list of event labels, and each event's start, end, and label in each gold video.",
    exampleAnswer: {
      regions: [{ start: 1.5, end: 4.2, label: "<one of the user's labels>" }],
    },
    description: "",
    schemaVersion: 1,
  },
  {
    key: "action_recognition",
    taskName: "action_recognition",
    mediaTypes: "video only",
    uses: ["TEMPORAL_REGIONS"],
    askUser: "the list of action labels, and the start, end, and action for each segment of each gold video.",
    exampleAnswer: {
      regions: [{ start: 0.0, end: 3.5, label: "<one of the user's labels>" }],
    },
    description: "",
    schemaVersion: 1,
  },
  {
    key: "bounding_box",
    taskName: "bounding_box",
    mediaTypes: "image, video",
    uses: ["NORMALIZED_COORDINATES"],
    askUser: "the list of object labels, whether the media is images or video, and each box's position. If the user gives pixel coordinates, also get the media width and height and normalize.",
    exampleAnswer: {
      boxes: [
        {
          id: "<unique id>",
          label: "<one of the user's labels>",
          x: 0.1,
          y: 0.15,
          width: 0.25,
          height: 0.7,
        },
      ],
    },
    description: 'For video, add `"time": <seconds>` to every box. `x` and `y` are the top-left corner. `width` and `height` must be greater than 0.',
    schemaVersion: 1,
  },
  {
    key: "polygon",
    taskName: "polygon",
    mediaTypes: "image, video",
    uses: ["NORMALIZED_COORDINATES"],
    askUser: "the list of labels, and each polygon's vertices in order around the shape.",
    exampleAnswer: {
      polygons: [
        {
          id: "<unique id>",
          label: "<one of the user's labels>",
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.7, y: 0.1 },
            { x: 0.75, y: 0.65 },
          ],
        },
      ],
    },
    description: "At least 3 points, in order, forming a valid polygon whose edges do not cross itself. For video, add `time` to every polygon.",
    schemaVersion: 1,
  },
  {
    key: "polyline",
    taskName: "polyline",
    mediaTypes: "image, video",
    uses: ["NORMALIZED_COORDINATES"],
    askUser: "the list of labels, and each line's points in order along the line.",
    exampleAnswer: {
      polylines: [
        {
          id: "<unique id>",
          label: "<one of the user's labels>",
          points: [
            { x: 0.1, y: 0.8 },
            { x: 0.4, y: 0.5 },
            { x: 0.8, y: 0.2 },
          ],
        },
      ],
    },
    description: "At least 2 distinct points. For video, add `time` to every polyline.",
    schemaVersion: 1,
  },
  {
    key: "ellipse",
    taskName: "ellipse",
    mediaTypes: "image, video",
    uses: ["NORMALIZED_COORDINATES"],
    askUser: "the list of labels, and the position and size of each ellipse. The ellipse is described by its enclosing rectangle.",
    exampleAnswer: {
      ellipses: [
        {
          id: "<unique id>",
          label: "<one of the user's labels>",
          x: 0.25,
          y: 0.1,
          width: 0.5,
          height: 0.65,
        },
      ],
    },
    description: "Same bounds rules as bounding_box. For video, add `time` to every ellipse.",
    schemaVersion: 1,
  },
  {
    key: "keypoint",
    taskName: "keypoint",
    mediaTypes: "image, video",
    uses: ["NORMALIZED_COORDINATES"],
    askUser: "the list of point names (for example body parts or landmarks), and each point's position.",
    exampleAnswer: {
      keypoints: [
        {
          id: "<unique id>",
          label: "<one of the user's point names>",
          x: 0.38,
          y: 0.42,
        },
      ],
    },
    description: "Each `label` must be one of the user's point names. For video, add `time` to every keypoint.",
    schemaVersion: 1,
  },
];

export function getTaskSection(key: string, multiSelect?: boolean): TaskSectionDefinition | undefined {
  if (key === "categorical") {
    return TASK_SECTIONS.find(
      section => section.key === "categorical" && section.variant === (multiSelect ? "multiple_choice" : "single_choice"),
    );
  }
  return TASK_SECTIONS.find(section => section.key === key);
}

export function hasPromptForType(key: string): boolean {
  return TASK_SECTIONS.some(section => section.key === key);
}

export interface AssemblePromptOptions {
  multiSelect?: boolean;
  maxZipGb?: number;
  maxRegions?: number;
  maxShapes?: number;
}

export function assembleAgentPrompt(typeKey: string, options?: AssemblePromptOptions): string {
  const taskDef = getTaskSection(typeKey, options?.multiSelect);
  if (!taskDef) {
    throw new Error(`No agent prompt task section found for annotation type: ${typeKey}`);
  }

  const plugin = getAnnotationPlugin(typeKey);
  const defaultSchema = plugin ? plugin.defaultSchema({ interactionDefaults: {} }) : null;
  const maxRegions = options?.maxRegions
    ?? (defaultSchema && "max_regions" in defaultSchema ? (defaultSchema as any).max_regions : 500);
  const maxShapes = options?.maxShapes
    ?? (defaultSchema && "max_shapes" in defaultSchema ? (defaultSchema as any).max_shapes : 500);
  const maxZipGb = options?.maxZipGb ?? MAX_ZIP_GB;

  // 1. Preamble with token substitutions
  const preamble = PREAMBLE_TEMPLATE
    .replace(/\{\{TASK_NAME\}\}/g, taskDef.taskName)
    .replace(/\{\{MEDIA_TYPES\}\}/g, taskDef.mediaTypes)
    .replace(/\{\{MAX_ZIP_GB\}\}/g, String(maxZipGb));

  // 2. Shared fragments
  const fragments = taskDef.uses.map(useKey => {
    let fragment: string = SHARED_FRAGMENTS[useKey];
    if (useKey === "TEMPORAL_REGIONS") {
      fragment = fragment.replace(/\{\{MAX_REGIONS\}\}/g, String(maxRegions));
    }
    if (useKey === "NORMALIZED_COORDINATES") {
      fragment = fragment.replace(/\{\{MAX_SHAPES\}\}/g, String(maxShapes));
    }
    return fragment;
  });

  // 3. Task section
  const usesText = taskDef.uses.length ? taskDef.uses.join(", ") : "none";
  const jsonBlock = `\`\`\`json\n${JSON.stringify(taskDef.exampleAnswer, null, 2)}\n\`\`\``;
  const taskSectionParts = [
    `### ${taskDef.taskName}`,
    `Media: ${taskDef.mediaTypes}. Uses: ${usesText}.`,
    `Ask the user: ${taskDef.askUser}`,
    jsonBlock,
  ];
  if (taskDef.description.trim()) {
    taskSectionParts.push(taskDef.description.trim());
  }
  const taskSection = taskSectionParts.join("\n");

  // Assembled prompt = PREAMBLE + the shared fragments + the type's own TASK SECTION
  return [preamble, ...fragments, taskSection].join("\n\n");
}
