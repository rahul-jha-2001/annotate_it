import { describe, expect, it, vi } from "vitest";
import { interactionRegionKey, waveformRegionOptions } from "./waveformRegions";

describe("waveform region synchronization", () => {
  it("hydrates saved temporal regions into editable waveform options", () => {
    const interaction = {
      kind: "temporal-regions" as const,
      regions: [{ start: 0.5, end: 2.75 }],
      onChange: vi.fn(),
    };

    expect(waveformRegionOptions(interaction)).toEqual([{
      id: "annotation-region-0",
      start: 0.5,
      end: 2.75,
      color: "rgba(48, 175, 255, 0.38)",
      drag: true,
      resize: true,
    }]);
  });

  it("hydrates labels and makes review overlays read-only", () => {
    const interaction = {
      kind: "labeled-temporal-regions" as const,
      regions: [{ start: 1, end: 3, label: "Speech" }],
      newRegionLabel: "Music",
      onChange: vi.fn(),
      readonly: true,
    };

    const [region] = waveformRegionOptions(interaction);
    expect(region).toMatchObject({
      id: "annotation-region-0",
      start: 1,
      end: 3,
      content: "Speech",
      drag: false,
      resize: false,
    });
    expect(region.color).toMatch(/^hsla\(/);
  });

  it("changes its key when a saved region changes", () => {
    const onChange = vi.fn();
    const first = { kind: "temporal-regions" as const, regions: [{ start: 1, end: 2 }], onChange };
    const second = { kind: "temporal-regions" as const, regions: [{ start: 1, end: 4 }], onChange };

    expect(interactionRegionKey(first)).not.toBe(interactionRegionKey(second));
  });
});
