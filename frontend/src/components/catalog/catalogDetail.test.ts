import { describe, expect, it } from "vitest";
import { buildCatalogDetail } from "./AnnotationCatalogDetail";

describe("catalog detail model", () => {
  it("resolves a known preset with joined samples and static data paths", () => {
    const result = buildCatalogDetail("speaker-diarization");
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.preset.samples).toHaveLength(2);
      expect(result.preset.metadataPath).toMatch(/metadata\.csv$/);
      expect(result.preset.goldAnswersPath).toMatch(/gold_answers\.json$/);
    }
  });

  it("returns not-found for unknown or stale slugs", () => {
    expect(buildCatalogDetail("removed-task")).toEqual({ kind: "not-found" });
    expect(buildCatalogDetail("")).toEqual({ kind: "not-found" });
  });
});
