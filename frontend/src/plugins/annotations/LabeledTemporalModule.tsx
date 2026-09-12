import { Trash2 } from "lucide-react";

import type {
  AnnotationModuleContext,
  ConfigurationEditorProps,
  LabeledTemporalRegion,
  TypedAnnotationControlProps,
} from "../contracts";
import { BaseAnnotationModule } from "./BaseAnnotationModule";

export interface LabeledTemporalSchema<KeyT extends string = string> {
  annotation_type: KeyT;
  schema_version: 1;
  choices: string[];
  allow_custom_labels: boolean;
  max_regions: number;
}
export interface LabeledTemporalAnswer { regions: LabeledTemporalRegion[] }

export const updateTemporalRegionLabel = (
  regions: LabeledTemporalRegion[], index: number, label: string,
) => regions.map((region, position) => position === index ? { ...region, label } : region);

export const removeTemporalRegion = (
  regions: LabeledTemporalRegion[], index: number,
) => regions.filter((_, position) => position !== index);

function LabeledTemporalConfiguration<KeyT extends string>({ schema, onChange }: ConfigurationEditorProps<LabeledTemporalSchema<KeyT>>) {
  return <div className="form-group">
    {!schema.allow_custom_labels && <>
      <label className="form-label">Region labels</label>
      {schema.choices.map((choice, index) => <div className="flex-row" key={index}>
        <input className="form-input" value={choice} onChange={event => onChange({ ...schema, choices: schema.choices.map((item, position) => position === index ? event.target.value : item) })} />
        <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...schema, choices: schema.choices.filter((_, position) => position !== index) })}>Remove</button>
      </div>)}
      <button type="button" className="btn btn-secondary" onClick={() => onChange({ ...schema, choices: [...schema.choices, ""] })}>Add label</button>
    </>}
    <label className="form-label" htmlFor="maximum-regions">Maximum regions per answer</label>
    <input id="maximum-regions" className="form-input" type="number" min={1} max={10000} value={schema.max_regions} onChange={event => onChange({ ...schema, max_regions: Number(event.target.value) })} />
  </div>;
}

function LabeledTemporalControl<KeyT extends string>({ schema, answer, onChange }: TypedAnnotationControlProps<LabeledTemporalSchema<KeyT>, LabeledTemporalAnswer>) {
  return <div>
    <p className="help-text">Create regions on the media, then set the label for each region here.</p>
    <div className="region-list">{answer.regions.map((region, index) => <div className="flex-row" key={`${region.start}-${region.end}-${index}`}>
      <span>{region.start.toFixed(2)}s–{region.end.toFixed(2)}s</span>
      {schema.allow_custom_labels
        ? <input className="form-input" value={region.label} onChange={event => onChange({ regions: updateTemporalRegionLabel(answer.regions, index, event.target.value) })} />
        : <select className="form-select" value={region.label} onChange={event => onChange({ regions: updateTemporalRegionLabel(answer.regions, index, event.target.value) })}>{schema.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select>}
      <button type="button" className="inline-icon-button" aria-label={`Remove region ${index + 1}`} onClick={() => onChange({ regions: removeTemporalRegion(answer.regions, index) })}><Trash2 size={14} /></button>
    </div>)}</div>
  </div>;
}

function LabeledTemporalAnswerView({ answer }: { answer: LabeledTemporalAnswer }) {
  return <div className="region-list">{answer.regions.map((region, index) => <span className="metadata-chip" key={`${region.start}-${region.end}-${index}`}><strong>{region.label}</strong> {region.start.toFixed(2)}s–{region.end.toFixed(2)}s</span>)}</div>;
}

export abstract class LabeledTemporalAnnotationModule<KeyT extends string> extends BaseAnnotationModule<LabeledTemporalSchema<KeyT>, LabeledTemporalAnswer> {
  abstract readonly key: KeyT;
  abstract readonly name: string;
  abstract readonly defaultChoices: string[];
  abstract readonly allowCustomLabels: boolean;
  readonly schemaVersion = 1 as const;
  readonly requiredInteraction = "labeled-temporal-regions" as const;
  readonly ConfigurationEditor = LabeledTemporalConfiguration<KeyT>;
  readonly Control = LabeledTemporalControl<KeyT>;
  readonly AnswerView = LabeledTemporalAnswerView;

  defaultSchema(_context: AnnotationModuleContext): LabeledTemporalSchema<KeyT> { return { annotation_type: this.key, schema_version: 1, choices: [...this.defaultChoices], allow_custom_labels: this.allowCustomLabels, max_regions: 500 }; }
  createInitialAnswer(): LabeledTemporalAnswer { return { regions: [] }; }
  createInteraction(_schema: LabeledTemporalSchema<KeyT>, answer: LabeledTemporalAnswer, onChange: (answer: LabeledTemporalAnswer) => void) {
    return { kind: "labeled-temporal-regions" as const, regions: answer.regions, newRegionLabel: answer.regions[answer.regions.length - 1]?.label ?? this.defaultChoices[0] ?? "Speaker 1", onChange: (regions: LabeledTemporalRegion[]) => onChange({ regions }) };
  }
  isComplete(_schema: LabeledTemporalSchema<KeyT>, answer: LabeledTemporalAnswer) { return answer.regions.length > 0 && answer.regions.every(region => region.label.trim()); }
  validateSchema(schema: LabeledTemporalSchema<KeyT>) {
    if (!Number.isInteger(schema.max_regions) || schema.max_regions < 1) return ["Maximum regions must be a positive integer"];
    const labels = schema.choices.map(label => label.trim());
    if (!schema.allow_custom_labels && (!labels.length || labels.some(label => !label))) return ["Add at least one non-empty region label"];
    if (new Set(labels).size !== labels.length) return ["Region labels must be unique"];
    return [];
  }
  validateAnswer(answer: unknown, schema: LabeledTemporalSchema<KeyT>): string[] {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return ["Gold answer must be an object"];
    const regions = (answer as Record<string, unknown>).regions;
    if (!Array.isArray(regions)) return ["Gold answer requires a regions array"];
    if (regions.length > schema.max_regions) return [`Gold answer exceeds ${schema.max_regions} regions`];
    const invalid = regions.some(region => {
      if (!region || typeof region !== "object") return true;
      const item = region as Record<string, unknown>;
      return typeof item.start !== "number" || item.start < 0 || typeof item.end !== "number" || item.end <= item.start || typeof item.label !== "string" || !item.label.trim() || (!schema.allow_custom_labels && !schema.choices.includes(item.label));
    });
    return invalid ? ["Gold answer contains an invalid labeled region"] : [];
  }
  goldAnswerShape() { return "{ regions: [{ start: number, end: number, label: string }] }"; }
  createGoldExample(): LabeledTemporalAnswer { return { regions: [{ start: 0.5, end: 2.75, label: this.defaultChoices[0] ?? "Speaker 1" }] }; }
  goldInstructions(schema: LabeledTemporalSchema<KeyT>) { return schema.allow_custom_labels ? ["Every region requires a non-empty label."] : [`Region labels must be one of: ${schema.choices.join(", ")}.`]; }
}
