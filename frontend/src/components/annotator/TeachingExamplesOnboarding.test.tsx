// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import TeachingExamplesOnboarding from "./TeachingExamplesOnboarding";
import type { LabelSchema, TeachingExampleItem } from "./types";

describe("TeachingExamplesOnboarding", () => {
  afterEach(cleanup);
  const schema: LabelSchema = {
    annotation_type: "categorical",
    schema_version: 1,
    choices: ["Clear", "Noisy"],
    multi_select: false,
  };

  const teachingExamples: TeachingExampleItem[] = [
    {
      data_unit_id: "u-1",
      media_url: "blob:sample1",
      filename: "sample1.wav",
      displayed_answer: { value: "Clear" },
      explanation: "No background noise is present.",
    },
    {
      data_unit_id: "u-2",
      media_url: "blob:sample2",
      filename: "sample2.wav",
      displayed_answer: { value: "Noisy" },
      explanation: "Loud fan hum in background.",
    },
  ];

  it("renders the first teaching example with media, answer, and explanation", () => {
    const handleComplete = vi.fn();
    render(
      <TeachingExamplesOnboarding
        modality="audio"
        schema={schema}
        teachingExamples={teachingExamples}
        onComplete={handleComplete}
      />
    );

    expect(screen.getByText("1 of 2")).toBeDefined();
    expect(screen.getByText("Observational Example: How to Annotate")).toBeDefined();
    expect(screen.getByText("No background noise is present.")).toBeDefined();
    expect(screen.getByText("Clear")).toBeDefined();
    expect(screen.getByRole("button", { name: /next/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDefined();
    // Previous is disabled on first item
    expect((screen.getByRole("button", { name: /previous/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("advances to next example and shows start annotating on last example", () => {
    const handleComplete = vi.fn();
    render(
      <TeachingExamplesOnboarding
        modality="audio"
        schema={schema}
        teachingExamples={teachingExamples}
        onComplete={handleComplete}
      />
    );

    const nextBtn = screen.getByRole("button", { name: /next/i });
    fireEvent.click(nextBtn);

    expect(screen.getByText("2 of 2")).toBeDefined();
    expect(screen.getByText("Loud fan hum in background.")).toBeDefined();
    expect(screen.getByText("Noisy")).toBeDefined();

    // Previous is now enabled
    const prevBtn = screen.getByRole("button", { name: /previous/i }) as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);

    // On last item, "Start annotating" appears
    const startBtn = screen.getByRole("button", { name: /start annotating/i });
    expect(startBtn).toBeDefined();

    fireEvent.click(startBtn);
    expect(handleComplete).toHaveBeenCalledTimes(1);
  });

  it("returns null if teaching examples list is empty", () => {
    const { container } = render(
      <TeachingExamplesOnboarding
        modality="audio"
        schema={schema}
        teachingExamples={[]}
        onComplete={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders spatial bounding box teaching example on image modality", () => {
    const spatialSchema: LabelSchema = {
      annotation_type: "bounding_box",
      schema_version: 1,
      choices: ["Pedestrian", "Vehicle"],
      max_shapes: 10,
      frame_aware: false,
      time_tolerance: 0.1,
      distance_tolerance: 0.1,
    };

    const spatialExamples: TeachingExampleItem[] = [
      {
        data_unit_id: "u-spatial-1",
        media_url: "blob:image1.jpg",
        filename: "street.jpg",
        displayed_answer: {
          boxes: [
            { id: "box-1", label: "Pedestrian", x: 0.1, y: 0.2, width: 0.15, height: 0.3 },
          ],
        },
        explanation: "Pedestrian crossing near the curb.",
      },
    ];

    render(
      <TeachingExamplesOnboarding
        modality="image"
        schema={spatialSchema}
        teachingExamples={spatialExamples}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText("Pedestrian crossing near the curb.")).toBeDefined();
    expect(screen.getByText("Pedestrian")).toBeDefined();
  });

  it("renders temporal region teaching example on audio modality", () => {
    const segmentSchema: LabelSchema = {
      annotation_type: "segment",
      schema_version: 1,
      choices: ["Speech", "Silence"],
      multi_select: false,
    };

    const segmentExamples: TeachingExampleItem[] = [
      {
        data_unit_id: "u-seg-1",
        media_url: "blob:audio1.wav",
        filename: "audio1.wav",
        displayed_answer: {
          label: "Speech",
          regions: [{ start: 0.5, end: 2.5 }],
        },
        explanation: "Speech activity segment.",
      },
    ];

    render(
      <TeachingExamplesOnboarding
        modality="audio"
        schema={segmentSchema}
        teachingExamples={segmentExamples}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText("Speech activity segment.")).toBeDefined();
    expect(screen.getByText("0.50s–2.50s")).toBeDefined();
  });

  it("renders transcription teaching example on audio modality", () => {
    const transcriptionSchema: LabelSchema = {
      annotation_type: "transcription",
      schema_version: 1,
    };

    const transcriptionExamples: TeachingExampleItem[] = [
      {
        data_unit_id: "u-trans-1",
        media_url: "blob:audio2.wav",
        filename: "audio2.wav",
        displayed_answer: {
          text: "Hello and welcome to the study",
        },
        explanation: "Verbatim transcription without punctuation errors.",
      },
    ];

    render(
      <TeachingExamplesOnboarding
        modality="audio"
        schema={transcriptionSchema}
        teachingExamples={transcriptionExamples}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText("Verbatim transcription without punctuation errors.")).toBeDefined();
    expect(screen.getByText("Hello and welcome to the study")).toBeDefined();
  });

  it("renders labeled temporal event teaching example on video modality", () => {
    const videoEventSchema: LabelSchema = {
      annotation_type: "video_event",
      schema_version: 1,
      choices: ["Scene change", "Action"],
      allow_custom_labels: false,
    };

    const videoExamples: TeachingExampleItem[] = [
      {
        data_unit_id: "u-vid-1",
        media_url: "blob:video1.mp4",
        filename: "video1.mp4",
        displayed_answer: {
          regions: [{ start: 1.0, end: 4.5, label: "Scene change" }],
        },
        explanation: "Camera cut at 1.0s marks a new scene.",
      },
    ];

    render(
      <TeachingExamplesOnboarding
        modality="video"
        schema={videoEventSchema}
        teachingExamples={videoExamples}
        onComplete={vi.fn()}
      />
    );

    expect(screen.getByText("Camera cut at 1.0s marks a new scene.")).toBeDefined();
    expect(screen.getByText("Scene change")).toBeDefined();
    expect(screen.getByText("1.00s–4.50s")).toBeDefined();
  });
});
