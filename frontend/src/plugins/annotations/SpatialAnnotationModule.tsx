import { Trash2 } from "lucide-react";

import type {
  AnnotationModuleContext,
  ConfigurationEditorProps,
  TypedAnnotationControlProps,
} from "../contracts";
import type { SpatialPoint, SpatialShape, SpatialTool } from "../spatial/types";
import { BaseAnnotationModule } from "./BaseAnnotationModule";

export interface SpatialSchema<KeyT extends string = string> {
  annotation_type: KeyT;
  schema_version: 1;
  choices: string[];
  max_shapes: number;
  frame_aware: boolean;
  time_tolerance: number;
  distance_tolerance: number;
}

export interface StoredShapeBase { id: string; label: string; time?: number }
export interface StoredRect extends StoredShapeBase { x: number; y: number; width: number; height: number }
export interface StoredPath extends StoredShapeBase { points: SpatialPoint[] }
export interface StoredPoint extends StoredShapeBase { x: number; y: number }
export type StoredSpatialShape = StoredRect | StoredPath | StoredPoint;
export type SpatialAnswer = Record<string, StoredSpatialShape[]>;

declare module "../../components/annotator/types" {
  interface AnnotationSchemaMap {
    bounding_box: SpatialSchema<"bounding_box">;
    polygon: SpatialSchema<"polygon">;
    polyline: SpatialSchema<"polyline">;
    ellipse: SpatialSchema<"ellipse">;
    keypoint: SpatialSchema<"keypoint">;
  }
  interface AnnotationAnswerMap {
    bounding_box: SpatialAnswer;
    polygon: SpatialAnswer;
    polyline: SpatialAnswer;
    ellipse: SpatialAnswer;
    keypoint: SpatialAnswer;
  }
}

function SpatialConfiguration<KeyT extends string>({ schema, onChange }: ConfigurationEditorProps<SpatialSchema<KeyT>>) {
  return <div className="form-group">
    <label className="form-label">Shape labels</label>
    {schema.choices.map((choice, index) => <div className="flex-row" key={index}>
      <input className="form-input" value={choice} onChange={event => onChange({ ...schema, choices: schema.choices.map((item, position) => position === index ? event.target.value : item) })} />
      <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...schema, choices: schema.choices.filter((_, position) => position !== index) })}>Remove</button>
    </div>)}
    <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...schema, choices: [...schema.choices, ""] })}>Add label</button>
    <label className="form-label" htmlFor="spatial-max-shapes">Maximum shapes per answer</label>
    <input id="spatial-max-shapes" className="form-input" type="number" min={1} max={10000} value={schema.max_shapes} onChange={event => onChange({ ...schema, max_shapes: Number(event.target.value) })} />
    {schema.frame_aware && <>
      <label className="form-label" htmlFor="spatial-time-tolerance">Video matching tolerance (seconds)</label>
      <input id="spatial-time-tolerance" className="form-input" type="number" min={0} step={0.05} value={schema.time_tolerance} onChange={event => onChange({ ...schema, time_tolerance: Number(event.target.value) })} />
    </>}
  </div>;
}

function SpatialControl<KeyT extends string>({ schema, answer, onChange }: TypedAnnotationControlProps<SpatialSchema<KeyT>, SpatialAnswer>) {
  const collection = Object.keys(answer)[0];
  const shapes = answer[collection] ?? [];
  const helpText = schema.annotation_type === "polygon"
    ? "Click to place vertices. Click the initial point, double-click, or press Enter to complete the polygon."
    : schema.annotation_type === "polyline"
      ? "Click to place points. Double-click or press Enter to complete the line."
      : "Choose a label after drawing. Select a shape on the media to move, resize, or delete it.";
  return <div>
    <p className="help-text">{helpText}</p>
    <div className="region-list">{shapes.map((shape, index) => <div className="flex-row" key={shape.id}>
      <code>{shape.id}</code>
      <select className="form-select" value={shape.label} onChange={event => onChange({ [collection]: shapes.map((item, position) => position === index ? { ...item, label: event.target.value } : item) })}>
        {schema.choices.map(choice => <option key={choice}>{choice}</option>)}
      </select>
      {shape.time !== undefined && <span>{shape.time.toFixed(2)}s</span>}
      <button type="button" className="inline-icon-button" aria-label={`Remove shape ${index + 1}`} onClick={() => onChange({ [collection]: shapes.filter((_, position) => position !== index) })}><Trash2 size={14} /></button>
    </div>)}</div>
  </div>;
}

function SpatialAnswerView({ answer }: { answer: SpatialAnswer }) {
  const shapes = Object.values(answer)[0] ?? [];
  return <div className="region-list">{shapes.map(shape => <span className="metadata-chip" key={shape.id}><strong>{shape.label}</strong> {shape.id}{shape.time === undefined ? "" : ` · ${shape.time.toFixed(2)}s`}</span>)}</div>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export abstract class SpatialAnnotationModule<KeyT extends string> extends BaseAnnotationModule<SpatialSchema<KeyT>, SpatialAnswer> {
  abstract readonly key: KeyT;
  abstract readonly name: string;
  abstract readonly tool: SpatialTool;
  abstract readonly collectionField: string;
  abstract readonly defaultLabel: string;
  readonly schemaVersion = 1 as const;
  readonly requiredInteraction = "spatial-shapes" as const;
  readonly supportedModalities = ["image", "video"] as const;
  readonly ConfigurationEditor = SpatialConfiguration<KeyT>;
  readonly Control = SpatialControl<KeyT>;
  readonly AnswerView = SpatialAnswerView;

  defaultSchema(context: AnnotationModuleContext): SpatialSchema<KeyT> {
    const defaults = context.interactionDefaults;
    return {
      annotation_type: this.key,
      schema_version: 1,
      choices: [this.defaultLabel],
      max_shapes: 100,
      frame_aware: defaults.frame_aware === true,
      time_tolerance: typeof defaults.time_tolerance === "number" ? defaults.time_tolerance : 0.1,
      distance_tolerance: 0.1,
    };
  }

  schemaForContext(schema: SpatialSchema<KeyT>, context: AnnotationModuleContext): SpatialSchema<KeyT> {
    const defaults = context.interactionDefaults;
    return {
      ...schema,
      frame_aware: defaults.frame_aware === true,
      time_tolerance: typeof defaults.time_tolerance === "number"
        ? defaults.time_tolerance
        : schema.time_tolerance,
    };
  }

  createInitialAnswer(): SpatialAnswer { return { [this.collectionField]: [] }; }

  createInteraction(schema: SpatialSchema<KeyT>, answer: SpatialAnswer, onChange: (answer: SpatialAnswer) => void) {
    const stored = answer[this.collectionField] ?? [];
    return {
      kind: "spatial-shapes" as const,
      tool: this.tool,
      shapes: stored.map(shape => ({ ...shape, kind: this.tool }) as SpatialShape),
      newShapeLabel: stored[stored.length - 1]?.label ?? schema.choices[0] ?? this.defaultLabel,
      frameAware: schema.frame_aware,
      timeTolerance: schema.time_tolerance,
      onChange: (shapes: SpatialShape[]) => onChange({
        [this.collectionField]: shapes.map(({ kind: _kind, ...shape }) => shape),
      }),
    };
  }

  isComplete(_schema: SpatialSchema<KeyT>, answer: SpatialAnswer) {
    return (answer[this.collectionField]?.length ?? 0) > 0;
  }

  validateSchema(schema: SpatialSchema<KeyT>): string[] {
    const labels = schema.choices.map(label => label.trim());
    if (!labels.length || labels.some(label => !label)) return ["Add at least one non-empty shape label"];
    if (new Set(labels).size !== labels.length) return ["Shape labels must be unique"];
    if (!Number.isInteger(schema.max_shapes) || schema.max_shapes < 1 || schema.max_shapes > 10000) return ["Maximum shapes must be an integer from 1 to 10000"];
    if (!Number.isFinite(schema.time_tolerance) || schema.time_tolerance < 0) return ["Time tolerance cannot be negative"];
    return [];
  }

  validateAnswer(answer: unknown, schema: SpatialSchema<KeyT>): string[] {
    if (!isRecord(answer) || Object.keys(answer).length !== 1 || !Array.isArray(answer[this.collectionField])) {
      return [`Gold answer requires only a ${this.collectionField} array`];
    }
    const shapes = answer[this.collectionField] as unknown[];
    if (shapes.length > schema.max_shapes) return [`Gold answer exceeds ${schema.max_shapes} shapes`];
    const ids = new Set<string>();
    for (const value of shapes) {
      if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || ids.has(value.id)) return ["Every shape requires a unique non-empty id"];
      ids.add(value.id);
      if (typeof value.label !== "string" || !schema.choices.includes(value.label)) return ["Every shape label must be configured for this task"];
      if (schema.frame_aware ? typeof value.time !== "number" || value.time < 0 : value.time !== undefined) return [schema.frame_aware ? "Every video shape requires a non-negative time" : "Image shapes cannot include time"];
      if (!this.validGeometry(value)) return [`${this.name} gold answer contains invalid normalized geometry`];
    }
    return [];
  }

  private validGeometry(shape: Record<string, unknown>): boolean {
    const coordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
    if (this.tool === "keypoint") return coordinate(shape.x) && coordinate(shape.y);
    if (this.tool === "polygon" || this.tool === "polyline") {
      if (!Array.isArray(shape.points) || shape.points.length < (this.tool === "polygon" ? 3 : 2)) return false;
      return shape.points.every(point => isRecord(point) && coordinate(point.x) && coordinate(point.y));
    }
    return coordinate(shape.x) && coordinate(shape.y) && typeof shape.width === "number" && shape.width > 0 && typeof shape.height === "number" && shape.height > 0 && (shape.x as number) + shape.width <= 1 && (shape.y as number) + shape.height <= 1;
  }

  goldAnswerShape() { return `{ ${this.collectionField}: [{ id: string, label: string, normalized geometry${this.tool === "polygon" || this.tool === "polyline" ? ", points" : ""}${""} }] }`; }
  goldInstructions(schema: SpatialSchema<KeyT>) {
    const specific = this.tool === "polygon"
      ? " Polygons require at least 3 points in order around the perimeter (do not repeat the initial point at the end)."
      : this.tool === "polyline"
        ? " Polylines require at least 2 points in order along the line."
        : "";
    return [
      `Coordinates are normalized from 0 to 1. IDs must be unique.${specific}${schema.frame_aware ? " Every shape also needs time in seconds." : " Do not include time for images."}`,
    ];
  }

  createGoldExample(schema: SpatialSchema<KeyT>): SpatialAnswer {
    const base = { id: `${this.tool}-1`, label: schema.choices[0] ?? this.defaultLabel, ...(schema.frame_aware ? { time: 1.25 } : {}) };
    const shape: StoredSpatialShape = this.tool === "polygon"
      ? { ...base, points: [{ x: 0.1, y: 0.1 }, { x: 0.7, y: 0.1 }, { x: 0.4, y: 0.7 }] }
      : this.tool === "polyline"
        ? { ...base, points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.7 }] }
        : this.tool === "keypoint"
          ? { ...base, x: 0.5, y: 0.5 }
          : { ...base, x: 0.15, y: 0.2, width: 0.4, height: 0.35 };
    return { [this.collectionField]: [shape] };
  }
}
