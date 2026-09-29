import { describe, expect, it } from "vitest";

import {
  createRegionFromDrag,
  pointerTimeOnTimeline,
  regionsToTimelineRow,
  timelineRowToRegions,
} from "./videoTimeline";

describe("video timeline adapter", () => {
  it("maps labeled annotation regions to bounded timeline actions", () => {
    expect(regionsToTimelineRow([
      { start: 1, end: 3, label: "Speech" },
      { start: 4, end: 6, label: "Music" },
    ], 8)).toEqual({
      id: "annotation-regions",
      actions: [
        { id: "annotation-region-0", effectId: "annotation-region-0", start: 1, end: 3, minStart: 0, maxEnd: 8 },
        { id: "annotation-region-1", effectId: "annotation-region-1", start: 4, end: 6, minStart: 0, maxEnd: 8 },
      ],
    });
  });

  it("preserves labels when timeline actions are moved and resized", () => {
    const currentRegions = [
      { start: 1, end: 3, label: "Speech" },
      { start: 4, end: 6, label: "Music" },
    ];
    const changedRow = regionsToTimelineRow(currentRegions, 8);
    changedRow.actions[0] = { ...changedRow.actions[0], start: 1.5, end: 3.75 };

    expect(timelineRowToRegions(changedRow, currentRegions, 8)).toEqual([
      { start: 1.5, end: 3.75, label: "Speech" },
      { start: 4, end: 6, label: "Music" },
    ]);
  });

  it("clamps pointer positions to the playable video duration", () => {
    const geometry = { viewportLeft: 100, scrollLeft: 40, startLeft: 20, scaleWidth: 80, scale: 1, duration: 8 };

    expect(pointerTimeOnTimeline(60, geometry)).toBe(0);
    expect(pointerTimeOnTimeline(400, geometry)).toBe(4);
    expect(pointerTimeOnTimeline(900, geometry)).toBe(8);
  });

  it("creates an ordered region when the annotator drags right-to-left", () => {
    expect(createRegionFromDrag(5.25, 2.5)).toEqual({ start: 2.5, end: 5.25 });
  });

  it("ignores a click that is too short to form a region", () => {
    expect(createRegionFromDrag(2, 2.02)).toBeNull();
  });

  it("never creates a zero-length draft region", () => {
    expect(createRegionFromDrag(2, 2, 0)).toBeNull();
  });
});
