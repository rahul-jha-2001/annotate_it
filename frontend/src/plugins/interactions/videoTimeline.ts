import type { TemporalRegion } from "../contracts";

export interface VideoTimelineAction {
  id: string;
  effectId: string;
  start: number;
  end: number;
  minStart: number;
  maxEnd: number;
  movable?: boolean;
  flexible?: boolean;
}

export interface VideoTimelineRow {
  id: string;
  actions: VideoTimelineAction[];
}

export interface TimelinePointerGeometry {
  viewportLeft: number;
  scrollLeft: number;
  startLeft: number;
  scaleWidth: number;
  scale: number;
  duration: number;
}

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

export function regionsToTimelineRow<T extends TemporalRegion>(
  regions: T[],
  duration: number,
): VideoTimelineRow {
  return {
    id: "annotation-regions",
    actions: regions.map((region, index) => ({
      id: `annotation-region-${index}`,
      effectId: `annotation-region-${index}`,
      start: region.start,
      end: region.end,
      minStart: 0,
      maxEnd: duration,
    })),
  };
}

export function timelineRowToRegions<T extends TemporalRegion>(
  row: VideoTimelineRow,
  currentRegions: T[],
  duration: number,
): T[] {
  return row.actions.flatMap((action, position) => {
    const parsedIndex = Number(action.id.replace("annotation-region-", ""));
    const source = currentRegions[Number.isInteger(parsedIndex) ? parsedIndex : position];
    if (!source) return [];
    const start = clamp(action.start, 0, duration);
    const end = clamp(action.end, 0, duration);
    if (end <= start) return [];
    return [{ ...source, start, end }];
  });
}

export function pointerTimeOnTimeline(
  clientX: number,
  geometry: TimelinePointerGeometry,
): number {
  const contentX = clientX - geometry.viewportLeft + geometry.scrollLeft - geometry.startLeft;
  const time = (contentX / geometry.scaleWidth) * geometry.scale;
  return clamp(time, 0, geometry.duration);
}

export function createRegionFromDrag(
  anchorTime: number,
  currentTime: number,
  minimumDuration = 0.05,
): TemporalRegion | null {
  const start = Math.min(anchorTime, currentTime);
  const end = Math.max(anchorTime, currentTime);
  const length = end - start;
  return length > 0 && length >= minimumDuration ? { start, end } : null;
}
