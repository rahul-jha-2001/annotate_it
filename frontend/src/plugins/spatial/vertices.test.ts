import { describe, expect, it } from "vitest";

import { moveVertex } from "./vertices";

describe("polygon vertex movement", () => {
  it("updates only the dragged vertex and clamps it to media bounds", () => {
    const points = [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }, { x: 0.8, y: 0.9 }];
    const moved = moveVertex(points, 1, { x: 1.2, y: -0.2 });
    expect(moved).toEqual([{ x: 0.1, y: 0.2 }, { x: 1, y: 0 }, { x: 0.8, y: 0.9 }]);
    expect(moved[0]).toBe(points[0]);
    expect(moved[2]).toBe(points[2]);
  });
});
