import type {
  SpatialAction,
  SpatialEditorState,
  SpatialPolygon,
  SpatialPolyline,
  SpatialShape,
} from "./types";

export function initialSpatialState(
  shapes: SpatialShape[] = [],
  readonly = false,
): SpatialEditorState {
  return { shapes: [...shapes], selectedId: null, draft: null, readonly };
}

function assertUniqueId(shapes: SpatialShape[], id: string) {
  if (shapes.some(shape => shape.id === id)) {
    throw new Error("Spatial shape IDs must be unique");
  }
}

export function spatialReducer(
  state: SpatialEditorState,
  action: SpatialAction,
): SpatialEditorState {
  if (state.readonly) return state;
  switch (action.type) {
    case "replace":
      return { ...state, shapes: [...action.shapes] };
    case "select":
      return { ...state, selectedId: action.id };
    case "create":
      assertUniqueId(state.shapes, action.shape.id);
      return {
        ...state,
        shapes: [...state.shapes, action.shape],
        selectedId: action.shape.id,
      };
    case "update":
      return {
        ...state,
        shapes: state.shapes.map(shape =>
          shape.id === action.id
            ? { ...shape, ...action.patch, id: shape.id, kind: shape.kind } as SpatialShape
            : shape,
        ),
      };
    case "delete":
      return {
        ...state,
        shapes: state.shapes.filter(shape => shape.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };
    case "start-draft":
      assertUniqueId(state.shapes, action.id);
      return {
        ...state,
        draft: {
          kind: action.kind,
          id: action.id,
          label: action.label,
          points: [],
          ...(action.time === undefined ? {} : { time: action.time }),
        },
      };
    case "add-draft-point":
      if (!state.draft) return state;
      return {
        ...state,
        draft: { ...state.draft, points: [...state.draft.points, action.point] },
      };
    case "undo-draft-point":
      if (!state.draft?.points.length) return state;
      return {
        ...state,
        draft: { ...state.draft, points: state.draft.points.slice(0, -1) },
      };
    case "complete-draft": {
      if (!state.draft) return state;
      let points = [...state.draft.points];
      if (state.draft.kind === "polygon" && points.length > 3) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.hypot(last.x - first.x, last.y - first.y) < 0.005) {
          points = points.slice(0, -1);
        }
      }
      const uniquePoints = new Set(points.map(point => `${point.x}:${point.y}`));
      const minimum = state.draft.kind === "polygon" ? 3 : 2;
      if (uniquePoints.size < minimum) {
        throw new Error(`${state.draft.kind} requires ${minimum === 3 ? "three" : "two"} unique points`);
      }
      const shape = {
        ...state.draft,
        points,
      } as SpatialPolygon | SpatialPolyline;
      return {
        ...state,
        shapes: [...state.shapes, shape],
        selectedId: shape.id,
        draft: null,
      };
    }
    case "cancel-draft":
      return { ...state, draft: null };
  }
}
