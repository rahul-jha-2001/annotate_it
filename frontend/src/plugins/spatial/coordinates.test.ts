import { describe, expect, it } from "vitest";

import { containedMediaRect, mediaPointFromClient } from "./coordinates";

describe("spatial coordinate conversion", () => {
  it("calculates contained rectangles for square, landscape, and portrait media", () => {
    expect(containedMediaRect(400, 400, 100, 100)).toEqual({ x: 0, y: 0, width: 400, height: 400 });
    expect(containedMediaRect(400, 400, 200, 100)).toEqual({ x: 0, y: 100, width: 400, height: 200 });
    expect(containedMediaRect(400, 400, 100, 200)).toEqual({ x: 100, y: 0, width: 200, height: 400 });
  });

  it("maps client coordinates to normalized media coordinates", () => {
    const rect = { x: 50, y: 100, width: 400, height: 200 };
    expect(mediaPointFromClient(250, 200, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(mediaPointFromClient(50, 100, rect)).toEqual({ x: 0, y: 0 });
    expect(mediaPointFromClient(450, 300, rect)).toEqual({ x: 1, y: 1 });
  });

  it("rejects outside clicks and clamps floating-point edge drift", () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    expect(mediaPointFromClient(9.9, 30, rect)).toBeNull();
    expect(mediaPointFromClient(30, 70.1, rect)).toBeNull();
    expect(mediaPointFromClient(110 + Number.EPSILON, 70, rect)).toEqual({ x: 1, y: 1 });
  });
});
