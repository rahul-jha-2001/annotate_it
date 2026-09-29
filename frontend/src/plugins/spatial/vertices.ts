import type { SpatialPoint } from "./types";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function moveVertex(points: SpatialPoint[], index: number, point: SpatialPoint): SpatialPoint[] {
  return points.map((candidate, position) => position === index
    ? { x: clamp(point.x), y: clamp(point.y) }
    : candidate);
}
