import { describe, expect, it } from "vitest";
import { filterReviewSamples } from "./reviewSampleFilter";

const samples = [
  { id: "never-reviewed", n_annotations: 0 },
  { id: "reviewed-once", n_annotations: 1 },
  { id: "reviewed-many", n_annotations: 3 },
];

describe("filterReviewSamples", () => {
  it("keeps only zero-annotation samples in the not annotated view", () => {
    expect(filterReviewSamples(samples, "unannotated").map(sample => sample.id)).toEqual([
      "never-reviewed",
    ]);
  });

  it("keeps samples with one or more annotations in the annotated view", () => {
    expect(filterReviewSamples(samples, "annotated").map(sample => sample.id)).toEqual([
      "reviewed-once",
      "reviewed-many",
    ]);
  });

  it("does not remove samples from the all view", () => {
    expect(filterReviewSamples(samples, "all")).toEqual(samples);
  });
});
