import type { AnnotationModuleContext, ConfigurationEditorProps, TypedAnnotationControlProps } from "../contracts";
import { BaseAnnotationModule } from "./BaseAnnotationModule";

export interface TranscriptionSchema {
  annotation_type: "transcription";
  schema_version: 1;
  case_sensitive: boolean;
  collapse_whitespace: boolean;
  strip_punctuation: boolean;
  minimum_length: number;
}

export interface TranscriptionAnswer { text: string }

declare module "../../components/annotator/types" {
  interface AnnotationSchemaMap { transcription: TranscriptionSchema }
  interface AnnotationAnswerMap { transcription: TranscriptionAnswer }
}

function TranscriptionConfiguration({ schema, onChange }: ConfigurationEditorProps<TranscriptionSchema>) {
  return <div className="form-group">
    <label className="form-label" htmlFor="transcription-minimum">Minimum transcript length</label>
    <input id="transcription-minimum" className="form-input" type="number" min={0} value={schema.minimum_length} onChange={event => onChange({ ...schema, minimum_length: Math.max(0, Number(event.target.value)) })} />
    <label className="choice-option"><input type="checkbox" checked={schema.case_sensitive} onChange={event => onChange({ ...schema, case_sensitive: event.target.checked })} />Case-sensitive comparison</label>
    <label className="choice-option"><input type="checkbox" checked={schema.collapse_whitespace} onChange={event => onChange({ ...schema, collapse_whitespace: event.target.checked })} />Collapse repeated whitespace</label>
    <label className="choice-option"><input type="checkbox" checked={schema.strip_punctuation} onChange={event => onChange({ ...schema, strip_punctuation: event.target.checked })} />Ignore punctuation when scoring</label>
  </div>;
}

function TranscriptionControl({ answer, onChange }: TypedAnnotationControlProps<TranscriptionSchema, TranscriptionAnswer>) {
  return <div>
    <label className="form-label" htmlFor="transcription-answer">Transcript</label>
    <textarea id="transcription-answer" className="form-input" rows={7} value={answer.text} onChange={event => onChange({ text: event.target.value })} placeholder="Type exactly what you hear" />
  </div>;
}

function TranscriptionAnswerView({ answer }: { answer: TranscriptionAnswer }) {
  return <span>{answer.text || "No transcript"}</span>;
}

export class TranscriptionAnnotationModule extends BaseAnnotationModule<TranscriptionSchema, TranscriptionAnswer> {
  readonly key = "transcription" as const;
  readonly name = "Transcription";
  readonly schemaVersion = 1 as const;
  readonly requiredInteraction = "none" as const;
  readonly ConfigurationEditor = TranscriptionConfiguration;
  readonly Control = TranscriptionControl;
  readonly AnswerView = TranscriptionAnswerView;

  description(mediaName: string) { return `Write the spoken content in this ${mediaName.toLowerCase()} sample`; }
  defaultSchema(_context: AnnotationModuleContext): TranscriptionSchema { return { annotation_type: "transcription", schema_version: 1, case_sensitive: false, collapse_whitespace: true, strip_punctuation: false, minimum_length: 1 }; }
  createInitialAnswer(_schema: TranscriptionSchema): TranscriptionAnswer { return { text: "" }; }
  createInteraction() { return { kind: "none" as const }; }
  isComplete(schema: TranscriptionSchema, answer: TranscriptionAnswer) { return answer.text.trim().length >= schema.minimum_length; }
  validateSchema(schema: TranscriptionSchema) { return Number.isInteger(schema.minimum_length) && schema.minimum_length >= 0 ? [] : ["Minimum length must be a non-negative integer"]; }
  validateAnswer(answer: unknown, schema: TranscriptionSchema): string[] {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return ["Gold answer must be an object"];
    const value = answer as Record<string, unknown>;
    if (Object.keys(value).some(key => key !== "text") || typeof value.text !== "string") return ["Gold answer requires only a text field"];
    return value.text.trim().length >= schema.minimum_length ? [] : [`Transcript must contain at least ${schema.minimum_length} characters`];
  }
  goldAnswerShape() { return "{ text: string }"; }
  createGoldExample(_schema: TranscriptionSchema): TranscriptionAnswer { return { text: "Expected transcript" }; }
}

export const transcriptionPlugin = new TranscriptionAnnotationModule();
