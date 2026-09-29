import { describe, expect, it } from "vitest";

import { canCreateAtPlaybackState, shapeAtTime, visibleShapesAtTime } from "./videoTime";
import type { SpatialShape } from "./types";

const shapes: SpatialShape[] = [
  { kind: "keypoint", id: "one", label: "Nose", x: 0.1, y: 0.2, time: 1 },
  { kind: "keypoint", id: "two", label: "Nose", x: 0.2, y: 0.3, time: 1.15 },
  { kind: "keypoint", id: "three", label: "Nose", x: 0.3, y: 0.4, time: 2 },
];

describe("frame-aware video spatial helpers", () => {
  it("assigns the current media time to a new shape", () => {
    expect(shapeAtTime({ kind: "keypoint", id: "new", label: "Nose", x: 0.5, y: 0.5 }, 3.25)).toMatchObject({ time: 3.25 });
  });

  it("only allows creation while playback is paused", () => {
    expect(canCreateAtPlaybackState(true)).toBe(true);
    expect(canCreateAtPlaybackState(false)).toBe(false);
  });

  it("shows only timestamped shapes within the configured tolerance", () => {
    expect(visibleShapesAtTime(shapes, 1.1, 0.1).map(shape => shape.id)).toEqual(["one", "two"]);
    expect(visibleShapesAtTime(shapes, 2, 0).map(shape => shape.id)).toEqual(["three"]);
    expect(() => visibleShapesAtTime(shapes, 1, -0.1)).toThrow(/tolerance/i);
  });
});
