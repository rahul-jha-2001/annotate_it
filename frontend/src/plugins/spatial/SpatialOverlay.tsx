import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MediaInteraction } from "../contracts";
import { labelColor } from "../interactions/labelColors";
import { containedMediaRect, mediaPointFromClient, type ContentRect } from "./coordinates";
import { initialSpatialState, spatialReducer } from "./reducer";
import type { SpatialAction, SpatialPoint, SpatialShape } from "./types";
import { moveVertex } from "./vertices";

interface SpatialOverlayProps {
  interaction: Extract<MediaInteraction, { kind: "spatial-shapes" }>;
  mediaWidth: number;
  mediaHeight: number;
  className?: string;
}

interface DragState {
  mode: "create" | "move" | "resize" | "vertex";
  start: SpatialPoint;
  shape?: SpatialShape;
  vertexIndex?: number;
}

let fallbackId = 0;
function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  fallbackId += 1;
  return `${prefix}-${fallbackId}`;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function translated(shape: SpatialShape, dx: number, dy: number): Partial<SpatialShape> {
  if (shape.kind === "polygon" || shape.kind === "polyline") {
    const minX = Math.min(...shape.points.map(point => point.x));
    const maxX = Math.max(...shape.points.map(point => point.x));
    const minY = Math.min(...shape.points.map(point => point.y));
    const maxY = Math.max(...shape.points.map(point => point.y));
    const safeDx = clamp(dx, -minX, 1 - maxX);
    const safeDy = clamp(dy, -minY, 1 - maxY);
    return { points: shape.points.map(point => ({ x: point.x + safeDx, y: point.y + safeDy })) };
  }
  if (shape.kind === "bounding_box" || shape.kind === "ellipse") {
    return {
      x: clamp(shape.x + dx, 0, 1 - shape.width),
      y: clamp(shape.y + dy, 0, 1 - shape.height),
    };
  }
  return { x: clamp(shape.x + dx), y: clamp(shape.y + dy) };
}

export default function SpatialOverlay({
  interaction,
  mediaWidth,
  mediaHeight,
  className,
}: SpatialOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });
  const [state, setState] = useState(() => initialSpatialState(interaction.shapes, Boolean(interaction.readonly)));
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    setState(previous => ({
      ...previous,
      shapes: interaction.shapes,
      readonly: Boolean(interaction.readonly),
      selectedId: interaction.shapes.some(shape => shape.id === previous.selectedId)
        ? previous.selectedId
        : null,
    }));
  }, [interaction.shapes, interaction.readonly]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => {
      const bounds = element.getBoundingClientRect();
      setContainerSize({ width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const contentRect = useMemo<ContentRect>(
    () => containedMediaRect(containerSize.width, containerSize.height, mediaWidth || 1, mediaHeight || 1),
    [containerSize, mediaWidth, mediaHeight],
  );

  const apply = (action: SpatialAction) => {
    setState(previous => {
      const next = spatialReducer(previous, action);
      if (next.shapes !== previous.shapes) interaction.onChange(next.shapes);
      return next;
    });
  };

  const pointFromEvent = (event: ReactPointerEvent): SpatialPoint | null => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    return mediaPointFromClient(event.clientX, event.clientY, {
      x: bounds.left + contentRect.x,
      y: bounds.top + contentRect.y,
      width: contentRect.width,
      height: contentRect.height,
    });
  };

  const timeFields = interaction.frameAware && interaction.creationTime !== undefined
    ? { time: interaction.creationTime }
    : {};

  const beginDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (interaction.readonly || interaction.canCreate === false || event.target !== event.currentTarget) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (interaction.tool === "keypoint") {
      apply({
        type: "create",
        shape: {
          kind: "keypoint",
          id: createId("keypoint"),
          label: interaction.newShapeLabel,
          ...point,
          ...timeFields,
        },
      });
      return;
    }
    if (interaction.tool === "polygon" || interaction.tool === "polyline") {
      if (!state.draft || state.draft.kind !== interaction.tool) {
        apply({
          type: "start-draft",
          kind: interaction.tool,
          id: createId(interaction.tool),
          label: interaction.newShapeLabel,
          ...timeFields,
        });
      }
      apply({ type: "add-draft-point", point });
      return;
    }
    setDrag({ mode: "create", start: point });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishDrawing = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || drag.mode !== "create") return;
    const end = pointFromEvent(event);
    setDrag(null);
    if (!end) return;
    const x = Math.min(drag.start.x, end.x);
    const y = Math.min(drag.start.y, end.y);
    const width = Math.abs(end.x - drag.start.x);
    const height = Math.abs(end.y - drag.start.y);
    if (width < 0.002 || height < 0.002) return;
    const kind = interaction.tool === "ellipse" ? "ellipse" : "bounding_box";
    apply({
      type: "create",
      shape: {
        kind,
        id: createId(kind),
        label: interaction.newShapeLabel,
        x,
        y,
        width,
        height,
        ...timeFields,
      },
    });
  };

  const beginShapeDrag = (event: ReactPointerEvent, shape: SpatialShape) => {
    event.stopPropagation();
    apply({ type: "select", id: shape.id });
    if (interaction.readonly) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setDrag({ mode: "move", start: point, shape });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginVertexDrag = (event: ReactPointerEvent, shape: Extract<SpatialShape, { kind: "polygon" }>, vertexIndex: number) => {
    event.stopPropagation();
    apply({ type: "select", id: shape.id });
    if (interaction.readonly) return;
    const point = pointFromEvent(event);
    if (!point) return;
    setDrag({ mode: "vertex", start: point, shape, vertexIndex });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveShape = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag?.shape || drag.mode === "create") return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (drag.mode === "vertex" && drag.shape.kind === "polygon" && drag.vertexIndex !== undefined) {
      apply({
        type: "update",
        id: drag.shape.id,
        patch: { points: moveVertex(drag.shape.points, drag.vertexIndex, point) },
      });
      return;
    }
    if (drag.mode === "resize" && (drag.shape.kind === "bounding_box" || drag.shape.kind === "ellipse")) {
      apply({
        type: "update",
        id: drag.shape.id,
        patch: {
          width: Math.max(0.002, clamp(point.x - drag.shape.x, 0, 1 - drag.shape.x)),
          height: Math.max(0.002, clamp(point.y - drag.shape.y, 0, 1 - drag.shape.y)),
        },
      });
      return;
    }
    apply({
      type: "update",
      id: drag.shape.id,
      patch: translated(drag.shape, point.x - drag.start.x, point.y - drag.start.y),
    });
  };

  const completeDraft = () => {
    if (!state.draft) return;
    try {
      apply({ type: "complete-draft" });
    } catch {
      // An unfinished draft remains editable until it has enough unique points.
    }
  };

  const x = (value: number) => contentRect.x + value * contentRect.width;
  const y = (value: number) => contentRect.y + value * contentRect.height;
  const points = (values: SpatialPoint[]) => values.map(point => `${x(point.x)},${y(point.y)}`).join(" ");

  return (
    <div
      ref={containerRef}
      className={`spatial-overlay ${className ?? ""}`.trim()}
      tabIndex={interaction.readonly ? -1 : 0}
      onKeyDown={event => {
        if (event.key === "Escape") apply({ type: "cancel-draft" });
        if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
          apply({ type: "delete", id: state.selectedId });
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && state.draft) {
          event.preventDefault();
          apply({ type: "undo-draft-point" });
        }
      }}
    >
      <svg
        className="spatial-overlay-canvas"
        viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
        onPointerDown={beginDrawing}
        onPointerMove={moveShape}
        onPointerUp={event => {
          finishDrawing(event);
          setDrag(null);
        }}
        onDoubleClick={completeDraft}
        aria-label="Spatial annotation canvas"
      >
        {state.shapes.map(shape => {
          const selected = shape.id === state.selectedId;
          const color = labelColor(shape.label);
          const shared = {
            className: `spatial-shape${selected ? " selected" : ""}`,
            stroke: color,
            fill: labelColor(shape.label, 0.16),
            onPointerDown: (event: ReactPointerEvent) => beginShapeDrag(event, shape),
          };
          if (shape.kind === "bounding_box") {
            return <rect key={shape.id} {...shared} x={x(shape.x)} y={y(shape.y)} width={shape.width * contentRect.width} height={shape.height * contentRect.height} />;
          }
          if (shape.kind === "ellipse") {
            return <ellipse key={shape.id} {...shared} cx={x(shape.x + shape.width / 2)} cy={y(shape.y + shape.height / 2)} rx={shape.width * contentRect.width / 2} ry={shape.height * contentRect.height / 2} />;
          }
          if (shape.kind === "polygon") return <g key={shape.id}>
            <polygon {...shared} points={points(shape.points)} />
            {shape.points.map((point, vertexIndex) => <circle
              key={shape.id + "-vertex-" + vertexIndex}
              className={"spatial-vertex-handle" + (selected ? " selected" : "") + (interaction.readonly ? " readonly" : "")}
              cx={x(point.x)}
              cy={y(point.y)}
              r={selected ? 6 : 4}
              fill="white"
              stroke={color}
              aria-label={"Move vertex " + (vertexIndex + 1)}
              onPointerDown={event => beginVertexDrag(event, shape, vertexIndex)}
            />)}
          </g>;
          if (shape.kind === "polyline") return <polyline key={shape.id} {...shared} points={points(shape.points)} fill="none" />;
          return <circle key={shape.id} {...shared} cx={x(shape.x)} cy={y(shape.y)} r={selected ? 7 : 5} />;
        })}
        {state.draft && (
          <g className="spatial-draft">
            <polyline
              points={points(state.draft.points)}
              stroke={labelColor(state.draft.label)}
              fill={state.draft.kind === "polygon" ? labelColor(state.draft.label, 0.12) : "none"}
            />
            {state.draft.points.map((point, vertexIndex) => <circle
              key={"draft-vertex-" + vertexIndex}
              className="spatial-draft-vertex"
              cx={x(point.x)} cy={y(point.y)} r={4}
            />)}
          </g>
        )}
        {!interaction.readonly && state.selectedId && (() => {
          const selected = state.shapes.find(shape => shape.id === state.selectedId);
          if (!selected || (selected.kind !== "bounding_box" && selected.kind !== "ellipse")) return null;
          return (
            <circle
              className="spatial-resize-handle"
              cx={x(selected.x + selected.width)}
              cy={y(selected.y + selected.height)}
              r={6}
              onPointerDown={event => {
                event.stopPropagation();
                const point = pointFromEvent(event);
                if (!point) return;
                setDrag({ mode: "resize", start: point, shape: selected });
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            />
          );
        })()}
      </svg>
    </div>
  );
}
