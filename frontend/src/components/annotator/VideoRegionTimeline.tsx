import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  Timeline,
  type TimelineState,
} from "@xzdarcy/react-timeline-editor";
import type { TimelineRow } from "@xzdarcy/timeline-engine";
import "@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css";

import type {
  LabeledTemporalRegion,
  MediaInteraction,
  TemporalRegion,
} from "../../plugins/contracts";
import { labelColor } from "../../plugins/interactions/labelColors";
import {
  createRegionFromDrag,
  pointerTimeOnTimeline,
  regionsToTimelineRow,
  timelineRowToRegions,
  type VideoTimelineRow,
} from "../../plugins/interactions/videoTimeline";

type RegionInteraction = Extract<
  MediaInteraction,
  { kind: "temporal-regions" | "labeled-temporal-regions" }
>;

interface VideoRegionTimelineProps {
  duration: number;
  currentTime: number;
  interaction: RegionInteraction;
  onSeek: (time: number) => void;
}

interface DragDraft {
  anchor: number;
  current: number;
}

const SCALE_SECONDS = 1;
const SCALE_WIDTH = 88;
const START_LEFT = 20;

const regionIndexFromAction = (actionId: string) => {
  const index = Number(actionId.replace("annotation-region-", ""));
  return Number.isInteger(index) ? index : -1;
};

export default function VideoRegionTimeline({
  duration,
  currentTime,
  interaction,
  onSeek,
}: VideoRegionTimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<TimelineState>(null);
  const [dragDraft, setDragDraft] = useState<DragDraft | null>(null);
  const scaleCount = Math.max(1, Math.ceil(duration / SCALE_SECONDS));
  const baseRow = useMemo(
    () => regionsToTimelineRow(interaction.regions, duration),
    [duration, interaction.regions],
  );
  const draftRegion = dragDraft
    ? createRegionFromDrag(dragDraft.anchor, dragDraft.current, 0)
    : null;
  const editorRow: VideoTimelineRow = draftRegion ? {
    ...baseRow,
    actions: [...baseRow.actions, {
      id: "draft-region",
      effectId: "draft-region",
      start: draftRegion.start,
      end: draftRegion.end,
      minStart: 0,
      maxEnd: duration,
      movable: false,
      flexible: false,
    }],
  } : baseRow;
  const effects = Object.fromEntries(editorRow.actions.map(action => [
    action.effectId,
    { id: action.effectId },
  ]));

  useEffect(() => {
    timelineRef.current?.setTime(Math.min(currentTime, duration));
  }, [currentTime, duration]);

  const seek = (time: number) => onSeek(Math.min(duration, Math.max(0, time)));

  const pointerTime = (clientX: number) => {
    const grid = rootRef.current?.querySelector<HTMLElement>(
      ".timeline-editor-edit-area .ReactVirtualized__Grid",
    );
    if (!grid) return null;
    return pointerTimeOnTimeline(clientX, {
      viewportLeft: grid.getBoundingClientRect().left,
      scrollLeft: grid.scrollLeft,
      startLeft: START_LEFT,
      scaleWidth: SCALE_WIDTH,
      scale: SCALE_SECONDS,
      duration,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (interaction.readonly || duration <= 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      !target?.closest(".timeline-editor-edit-row")
      || target.closest(".timeline-editor-action, .timeline-editor-cursor")
    ) return;
    const time = pointerTime(event.clientX);
    if (time == null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragDraft({ anchor: time, current: time });
    seek(time);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragDraft) return;
    const time = pointerTime(event.clientX);
    if (time == null) return;
    setDragDraft(current => current ? { ...current, current: time } : null);
    seek(time);
  };

  const finishRegionDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragDraft) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const region = createRegionFromDrag(dragDraft.anchor, dragDraft.current);
    setDragDraft(null);
    if (!region) return;
    if (interaction.kind === "labeled-temporal-regions") {
      interaction.onChange([
        ...interaction.regions,
        { ...region, label: interaction.newRegionLabel },
      ]);
    } else {
      interaction.onChange([...interaction.regions, region]);
    }
    seek(region.end);
  };

  const updateRegions = (rows: TimelineRow[]) => {
    const row = rows[0] as VideoTimelineRow | undefined;
    if (!row) return;
    if (interaction.kind === "labeled-temporal-regions") {
      interaction.onChange(timelineRowToRegions(
        row,
        interaction.regions,
        duration,
      ) as LabeledTemporalRegion[]);
    } else {
      interaction.onChange(timelineRowToRegions(
        row,
        interaction.regions,
        duration,
      ) as TemporalRegion[]);
    }
  };

  const removeRegion = (index: number) => {
    if (interaction.readonly) return;
    if (interaction.kind === "labeled-temporal-regions") {
      interaction.onChange(interaction.regions.filter((_, position) => position !== index));
    } else {
      interaction.onChange(interaction.regions.filter((_, position) => position !== index));
    }
  };

  return (
    <div
      ref={rootRef}
      className="video-region-timeline"
      aria-label="Video region timeline"
      onPointerDownCapture={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={finishRegionDrag}
      onPointerCancel={() => setDragDraft(null)}
    >
      <Timeline
        ref={timelineRef}
        editorData={[editorRow] as TimelineRow[]}
        effects={effects}
        scale={SCALE_SECONDS}
        scaleSplitCount={10}
        scaleWidth={SCALE_WIDTH}
        startLeft={START_LEFT}
        minScaleCount={scaleCount}
        maxScaleCount={scaleCount}
        rowHeight={56}
        gridSnap
        dragLine
        autoScroll
        disableDrag={Boolean(interaction.readonly)}
        style={{ width: "100%", height: 108 }}
        getScaleRender={time => `${time.toFixed(time < 10 ? 1 : 0)}s`}
        getActionRender={action => {
          const index = regionIndexFromAction(action.id);
          const region = index >= 0 ? interaction.regions[index] : null;
          const label = region && "label" in region && typeof region.label === "string"
            ? region.label
            : "label" in interaction && typeof interaction.label === "string" && interaction.label
            ? interaction.label
            : `Region ${index + 1}`;
          const activeLabel = region && "label" in region && typeof region.label === "string"
            ? region.label
            : "label" in interaction && typeof interaction.label === "string" && interaction.label
            ? interaction.label
            : undefined;
          const background = action.id === "draft-region"
            ? "rgba(48, 175, 255, 0.24)"
            : activeLabel
              ? labelColor(activeLabel, 0.42)
              : "rgba(48, 175, 255, 0.42)";
          const displayText = action.id === "draft-region"
            ? "New region"
            : `${label} · ${action.start.toFixed(2)}–${action.end.toFixed(2)}s`;
          return (
            <div className="video-timeline-region" style={{ background }}>
              <span title={displayText}>{displayText}</span>
              {index >= 0 && !interaction.readonly && (
                <button
                  type="button"
                  aria-label={`Remove region ${index + 1}`}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => {
                    event.stopPropagation();
                    removeRegion(index);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        }}
        onChange={updateRegions}
        onClickTimeArea={time => {
          seek(time);
          return true;
        }}
        onCursorDrag={seek}
        onCursorDragEnd={seek}
      />
      <p className="video-timeline-help">
        {interaction.readonly
          ? "Click the timeline to inspect a moment in the video."
          : "Drag empty timeline space to create a region. Drag a region to move it, or drag its edges to resize it."}
      </p>
    </div>
  );
}
