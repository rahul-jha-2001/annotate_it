import { describe, expect, it, vi } from "vitest";

import { getAnnotationPlugin } from "./registry";
import {
  removeTemporalRegion,
  updateTemporalRegionLabel,
} from "./LabeledTemporalModule";

const regions = [
  { start: 0, end: 1, label: "Speech" },
  { start: 1, end: 2, label: "Music" },
];

describe("labeled temporal modules", () => {
  it("changes one region label without affecting its neighbors", () => {
    expect(updateTemporalRegionLabel(regions, 0, "Noise")).toEqual([
      { start: 0, end: 1, label: "Noise" },
      regions[1],
    ]);
    expect(regions[0].label).toBe("Speech");
  });

  it("removes only the selected region", () => {
    expect(removeTemporalRegion(regions, 0)).toEqual([regions[1]]);
  });

  it("maps child answers to the shared labeled interaction", () => {
    const module = getAnnotationPlugin("sound_event")!;
    const schema = module.defaultSchema({ interactionDefaults: {} });
    const answer = { regions };
    const onChange = vi.fn();
    const interaction = module.createInteraction(schema, answer, onChange);
    expect(interaction.kind).toBe("labeled-temporal-regions");
    if (interaction.kind === "labeled-temporal-regions") {
      interaction.onChange([{ start: 2, end: 3, label: "Speech" }]);
    }
    expect(onChange).toHaveBeenCalledWith({
      regions: [{ start: 2, end: 3, label: "Speech" }],
    });
  });
});
