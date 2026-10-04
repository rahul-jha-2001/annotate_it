// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import ReviewAnnotations from "./ReviewAnnotations";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../api";

const mockApiFetch = vi.mocked(apiFetch);

describe("ReviewAnnotations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  const sampleReviewData = {
    experiment: {
      id: "exp-1",
      name: "Image Classification Experiment",
      modality: "image",
      label_schema: { annotation_type: "classification", classes: ["cat", "dog"] },
    },
    total_samples: 35,
    page: 1,
    page_size: 20,
    total_pages: 2,
    samples: [
      {
        id: "sample-1",
        filename: "cat_01.jpg",
        raw_uri: "s3://bucket/cat_01.jpg",
        media_url: "http://example.com/cat_01.jpg",
        is_gold: false,
        gold_answer: null,
        metadata: {},
        agreement_score: 1.0,
        n_annotations: 2,
        annotations: [
          { id: "ann-1", annotator_id: "user-1", answer: "cat", submitted_at: new Date().toISOString() },
        ],
      },
    ],
  };

  it("renders sample review cards and pagination controls", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleReviewData,
    } as Response);

    render(<ReviewAnnotations experimentId="exp-1" />);

    expect(screen.getByText("Loading annotations…")).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("cat_01.jpg")).toBeDefined();
    });

    expect(screen.getByText("Review: Image Classification Experiment")).toBeDefined();
    expect(screen.getByText(/35 total sample\(s\)/)).toBeDefined();
    expect(screen.getByText(/Showing/)).toBeDefined();
    expect(screen.getByText(/1–20/)).toBeDefined();
    expect(screen.getByRole("button", { name: /next page/i })).toBeDefined();
  });

  it("navigates to next page on clicking Next", async () => {
    mockApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => sampleReviewData,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...sampleReviewData,
          page: 2,
          samples: [
            {
              id: "sample-21",
              filename: "cat_21.jpg",
              raw_uri: "s3://bucket/cat_21.jpg",
              media_url: "http://example.com/cat_21.jpg",
              is_gold: false,
              gold_answer: null,
              metadata: {},
              agreement_score: 1.0,
              n_annotations: 1,
              annotations: [],
            },
          ],
        }),
      } as Response);

    render(<ReviewAnnotations experimentId="exp-1" />);

    await waitFor(() => {
      expect(screen.getByText("cat_01.jpg")).toBeDefined();
    });

    const nextBtn = screen.getByRole("button", { name: /next page/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/api/experiments/exp-1/review?page=2&page_size=20");
    });
  });

  it("renders in embedded mode without standalone page heading", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleReviewData,
    } as Response);

    render(<ReviewAnnotations experimentId="exp-1" embedded={true} />);

    await waitFor(() => {
      expect(screen.getByText("cat_01.jpg")).toBeDefined();
    });

    expect(screen.queryByText("Review: Image Classification Experiment")).toBeNull();
    expect(screen.getByText("Samples & Annotations")).toBeDefined();
  });
});
