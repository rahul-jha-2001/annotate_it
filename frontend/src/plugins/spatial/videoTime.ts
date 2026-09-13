import type { SpatialShape } from "./types";

export function shapeAtTime<ShapeT extends SpatialShape>(shape: ShapeT, time: number): ShapeT {
  if (!Number.isFinite(time) || time < 0) throw new Error("Video time must be non-negative");
  return { ...shape, time };
}

export function canCreateAtPlaybackState(paused: boolean): boolean {
  return paused;
}

export function visibleShapesAtTime(
  shapes: SpatialShape[],
  currentTime: number,
  tolerance: number,
): SpatialShape[] {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("Video shape tolerance cannot be negative");
  }
  return shapes.filter(shape =>
    shape.time !== undefined && Math.abs(shape.time - currentTime) <= tolerance + Number.EPSILON,
  );
}
