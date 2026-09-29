import { describe, expect, it, vi } from "vitest";
import { reducePreview, type PreviewState } from "./CatalogPreview";

describe("catalog preview lifecycle", () => {
  const initial = { value: "" };
  const createInitial = vi.fn(() => ({ value: "" }));
  const changed: PreviewState = { selectedSample: 0, answer: { value: "Good" } };

  it("keeps answer changes in preview state", () => {
    expect(reducePreview(changed, { type: "answer-changed", answer: { value: "Bad" } }, createInitial))
      .toEqual({ selectedSample: 0, answer: { value: "Bad" } });
  });

  it("discards answers when changing samples or resetting", () => {
    const selected = reducePreview(changed, { type: "sample-selected", index: 1 }, createInitial);
    expect(selected).toEqual({ selectedSample: 1, answer: initial });
    expect(selected.answer).not.toBe(initial);
    const reset = reducePreview(changed, { type: "reset" }, createInitial);
    expect(reset).toEqual({ selectedSample: 0, answer: initial });
    expect(createInitial).toHaveBeenCalledTimes(2);
  });
});
