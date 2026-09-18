export type ReviewSampleFilter = "all" | "annotated" | "unannotated";

export function filterReviewSamples<T extends { n_annotations: number }>(
  samples: T[],
  filter: ReviewSampleFilter,
): T[] {
  if (filter === "annotated") {
    return samples.filter(sample => sample.n_annotations > 0);
  }
  if (filter === "unannotated") {
    return samples.filter(sample => sample.n_annotations === 0);
  }
  return samples;
}
