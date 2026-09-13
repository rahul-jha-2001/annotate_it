export interface SpatialPoint {
  x: number;
  y: number;
}

interface SpatialShapeBase {
  id: string;
  label: string;
  time?: number;
}

export interface SpatialBox extends SpatialShapeBase {
  kind: "bounding_box";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialEllipse extends SpatialShapeBase {
  kind: "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialPolygon extends SpatialShapeBase {
  kind: "polygon";
  points: SpatialPoint[];
}

export interface SpatialPolyline extends SpatialShapeBase {
  kind: "polyline";
  points: SpatialPoint[];
}

export interface SpatialKeypoint extends SpatialShapeBase {
  kind: "keypoint";
  x: number;
  y: number;
}

export type SpatialShape =
  | SpatialBox
  | SpatialEllipse
  | SpatialPolygon
  | SpatialPolyline
  | SpatialKeypoint;

export type SpatialTool = SpatialShape["kind"];

export interface SpatialDraft {
  kind: "polygon" | "polyline";
  id: string;
  label: string;
  points: SpatialPoint[];
  time?: number;
}

export interface SpatialEditorState {
  shapes: SpatialShape[];
  selectedId: string | null;
  draft: SpatialDraft | null;
  readonly: boolean;
}

export type SpatialAction =
  | { type: "replace"; shapes: SpatialShape[] }
  | { type: "select"; id: string | null }
  | { type: "create"; shape: SpatialShape }
  | { type: "update"; id: string; patch: Partial<SpatialShape> }
  | { type: "delete"; id: string }
  | { type: "start-draft"; kind: "polygon" | "polyline"; id: string; label: string; time?: number }
  | { type: "add-draft-point"; point: SpatialPoint }
  | { type: "undo-draft-point" }
  | { type: "complete-draft" }
  | { type: "cancel-draft" };
