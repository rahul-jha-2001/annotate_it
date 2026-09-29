import type { SpatialPoint } from "./types";

export interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EDGE_EPSILON = 1e-7;

export function containedMediaRect(
  containerWidth: number,
  containerHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): ContentRect {
  if ([containerWidth, containerHeight, mediaWidth, mediaHeight].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error("media and container dimensions must be positive");
  }
  const scale = Math.min(containerWidth / mediaWidth, containerHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function mediaPointFromClient(
  clientX: number,
  clientY: number,
  rect: ContentRect,
): SpatialPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const relativeX = clientX - rect.x;
  const relativeY = clientY - rect.y;
  if (
    relativeX < -EDGE_EPSILON ||
    relativeY < -EDGE_EPSILON ||
    relativeX > rect.width + EDGE_EPSILON ||
    relativeY > rect.height + EDGE_EPSILON
  ) {
    return null;
  }
  return {
    x: Math.max(0, Math.min(1, relativeX / rect.width)),
    y: Math.max(0, Math.min(1, relativeY / rect.height)),
  };
}
