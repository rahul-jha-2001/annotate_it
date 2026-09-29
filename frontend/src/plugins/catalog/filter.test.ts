import { describe, expect, it } from "vitest";

import { COMING_SOON } from "./comingSoon";
import { catalogModalityCounts, filterCatalog } from "./filter";
import { listCatalogPresets } from "./registry";

describe("catalog filtering", () => {
  const entries = listCatalogPresets();

  it("filters by modality and normalized text across discovery fields", () => {
    expect(filterCatalog(entries, "audio", "  SPEAKER  ").map(item => item.slug))
      .toEqual(["speaker-diarization", "speaker-identification"]);
    expect(filterCatalog(entries, "all", "traffic").map(item => item.slug))
      .toEqual(["bounding-box"]);
    expect(filterCatalog(entries, "image", "temporal")).toEqual([]);
  });

  it("returns all entries and exact modality counts", () => {
    expect(filterCatalog(entries, "all", "")).toHaveLength(15);
    expect(catalogModalityCounts(entries)).toEqual({ all: 15, audio: 8, image: 5, video: 2 });
  });

  it("keeps coming-soon records non-runnable", () => {
    expect(COMING_SOON.length).toBeGreaterThan(0);
    expect(COMING_SOON.every(item => !(
      "schema" in item
      || "samples" in item
      || "exampleBundlePath" in item
      || "annotationType" in item
    ))).toBe(true);
  });
});
