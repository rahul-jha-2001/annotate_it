import type { ConfigurationEditorProps, TypedAnnotationControlProps } from "../contracts";
import { BaseAnnotationModule } from "./BaseAnnotationModule";
import { ChoiceConfiguration } from "./categorical";

export interface TemporalRegion { start: number; end: number }
export interface SegmentSchema {
  annotation_type: "segment";
  schema_version: 1;
  choices: string[];
  multi_select: false;
}
export interface SegmentAnswer { label?: string; regions: TemporalRegion[] }

declare module "../../components/annotator/types" {
  interface AnnotationSchemaMap { segment: SegmentSchema }
  interface AnnotationAnswerMap { segment: SegmentAnswer }
}

function SegmentConfiguration(props: ConfigurationEditorProps<SegmentSchema>) {
  return <ChoiceConfiguration {...props} />;
}

function SegmentControl({ schema, answer, onChange }: TypedAnnotationControlProps<SegmentSchema, SegmentAnswer>) {
  return <div>
    <label className="form-label" htmlFor="segment-label">Region label</label>
    <select id="segment-label" className="form-select" value={answer.label ?? ""} onChange={event => onChange({ ...answer, label: event.target.value })}>
      <option value="">-- Choose --</option>
      {schema.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select>
    <p style={{ margin: "10px 0 0", fontSize: "0.85rem" }}>{answer.regions.length} region(s) selected</p>
  </div>;
}

function SegmentAnswerView({ answer }: { answer: SegmentAnswer }) {
  return <div><strong>{answer.label ?? "No label"}</strong><div className="region-list">
    {answer.regions.map((region, index) => <span key={`${region.start}-${region.end}-${index}`} className="metadata-chip">{region.start.toFixed(2)}s–{region.end.toFixed(2)}s</span>)}
    {answer.regions.length === 0 && <span>No regions</span>}
  </div></div>;
}

export class SegmentAnnotationModule extends BaseAnnotationModule<SegmentSchema, SegmentAnswer> {
  readonly key = "segment" as const;
  readonly name = "Segment / Region";
  readonly schemaVersion = 1 as const;
  readonly requiredInteraction = "temporal-regions" as const;
  readonly ConfigurationEditor = SegmentConfiguration;
  readonly Control = SegmentControl;
  readonly AnswerView = SegmentAnswerView;
  readonly goldGuidance = "Region start/end values are seconds, with end greater than start.";

  description(mediaName: string) { return `Mark labeled time regions in ${mediaName.toLowerCase()}`; }
  defaultSchema(): SegmentSchema { return { annotation_type: "segment", schema_version: 1, choices: ["Region"], multi_select: false }; }
  createInitialAnswer(): SegmentAnswer { return { regions: [] }; }
  createInteraction(_schema: SegmentSchema, answer: SegmentAnswer, onChange: (answer: SegmentAnswer) => void) {
    return { kind: "temporal-regions" as const, regions: answer.regions, onChange: (regions: TemporalRegion[]) => onChange({ ...answer, regions }) };
  }
  isComplete(_schema: SegmentSchema, answer: SegmentAnswer) { return Boolean(answer.label); }
  validateAnswer(answer: unknown, schema: SegmentSchema): string[] {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return ["Gold answer must be an object"];
    const value = answer as Record<string, unknown>;
    if (typeof value.label !== "string" || !schema.choices.includes(value.label)) return ["Gold answer has an unknown or missing label"];
    if (!Array.isArray(value.regions)) return ["Gold answer requires a regions array"];
    const invalid = value.regions.some(region => {
      if (!region || typeof region !== "object") return true;
      const candidate = region as Record<string, unknown>;
      return typeof candidate.start !== "number" || typeof candidate.end !== "number" || candidate.start < 0 || candidate.end <= candidate.start;
    });
    return invalid ? ["Gold answer has an invalid time region"] : [];
  }
  goldAnswerShape() { return "{ label: string, regions: [{ start: number, end: number }] }"; }
  goldInstructions(schema: SegmentSchema) { return [`Labels must be one of: ${schema.choices.join(", ")}.`, this.goldGuidance]; }
  createGoldExample(schema: SegmentSchema): SegmentAnswer { return { label: schema.choices[0] || "Your label", regions: [{ start: 0.5, end: 2.75 }] }; }
}

export const segmentPlugin = new SegmentAnnotationModule();
