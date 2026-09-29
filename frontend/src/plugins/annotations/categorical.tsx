import type { AnnotationModuleContext, ConfigurationEditorProps, TypedAnnotationControlProps } from "../contracts";
import { BaseAnnotationModule } from "./BaseAnnotationModule";
import { catalogBundlePaths, catalogSamples, defineCatalogPreset } from "../catalog/fixtures";
import type { AnnotationCatalogPreset } from "../catalog/types";

export interface CategoricalSchema {
  annotation_type: "categorical";
  schema_version: 1;
  choices: string[];
  multi_select: boolean;
}

export interface CategoricalAnswer {
  value?: string;
  values?: string[];
}

declare module "../../components/annotator/types" {
  interface AnnotationSchemaMap { categorical: CategoricalSchema }
  interface AnnotationAnswerMap { categorical: CategoricalAnswer }
}

interface ChoiceSchema {
  annotation_type: string;
  schema_version: number;
  choices: string[];
  multi_select: boolean;
}

export function ChoiceConfiguration<SchemaT extends ChoiceSchema>({ schema, onChange }: ConfigurationEditorProps<SchemaT>) {
  const updateChoice = (index: number, value: string) => onChange({
    ...schema,
    choices: schema.choices.map((choice, position) => position === index ? value : choice),
  });
  return <div className="form-group">
    <label className="form-label">Labels or choices</label>
    {schema.choices.map((choice, index) => <div className="flex-row" key={index}>
      <input className="form-input" value={choice} onChange={event => updateChoice(index, event.target.value)} />
      <button type="button" className="btn btn-secondary" onClick={() => onChange({
        ...schema,
        choices: schema.choices.filter((_, position) => position !== index),
      })}>Remove</button>
    </div>)}
    <button type="button" className="btn btn-secondary" onClick={() => onChange({
      ...schema,
      choices: [...schema.choices, ""],
    })}>Add label</button>
    <label className="flex-row">
      <input type="checkbox" checked={schema.multi_select} onChange={event => onChange({
        ...schema,
        multi_select: event.target.checked,
      })} />
      Allow multiple labels
    </label>
  </div>;
}

function CategoricalControl({ schema, answer, onChange }: TypedAnnotationControlProps<CategoricalSchema, CategoricalAnswer>) {
  if (schema.multi_select) {
    const selected = answer.values ?? [];
    return <fieldset style={{ border: 0 }}>
      <legend className="form-label" style={{ marginBottom: "10px" }}>Select one or more labels</legend>
      <div className="flex-col" style={{ gap: "10px" }}>{schema.choices.map(choice => <label key={choice} className="flex-row">
        <input type="checkbox" checked={selected.includes(choice)} onChange={() => onChange({
          values: selected.includes(choice) ? selected.filter(value => value !== choice) : [...selected, choice],
        })} />{choice}
      </label>)}</div>
    </fieldset>;
  }
  return <div>
    <label className="form-label" htmlFor="categorical-answer">Select a label</label>
    <select id="categorical-answer" className="form-select" value={answer.value ?? ""} onChange={event => onChange({ value: event.target.value })}>
      <option value="">-- Choose --</option>
      {schema.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select>
  </div>;
}

function CategoricalAnswerView({ answer }: { answer: CategoricalAnswer }) {
  return <span>{answer.values !== undefined ? answer.values.join(", ") || "No choices" : answer.value ?? "No choice"}</span>;
}

export class CategoricalAnnotationModule extends BaseAnnotationModule<CategoricalSchema, CategoricalAnswer> {
  readonly key = "categorical" as const;
  readonly name = "Categorical";
  readonly schemaVersion = 1 as const;
  readonly requiredInteraction = "none" as const;
  readonly ConfigurationEditor = ChoiceConfiguration;
  readonly Control = CategoricalControl;
  readonly AnswerView = CategoricalAnswerView;

  catalogPresets(_context: AnnotationModuleContext): AnnotationCatalogPreset<CategoricalSchema>[] {
    const singleSlug = "audio-classification-single";
    const multiSlug = "audio-classification-multi";
    return [
      defineCatalogPreset({
        slug: singleSlug, title: "Audio classification · single choice",
        summary: "Assign exactly one quality or content label to an entire audio clip.", family: "Classification",
        useCases: ["Audio quality", "Intent classification", "Content labeling"], modality: "audio",
        schema: { annotation_type: "categorical", schema_version: 1, choices: ["Good", "Noisy", "Unusable"], multi_select: false },
        samples: catalogSamples(singleSlug, [
          { filename: "sample_001.wav", metadata: { language: "English", difficulty: 2, content_type: "Speech" }, goldAnswer: { value: "Good" } },
          { filename: "sample_002.wav", metadata: { language: "Hindi", difficulty: 2, content_type: "Speech" }, goldAnswer: { value: "Good" } },
        ]),
        metadataDescription: "Language, difficulty, and content type can route clips to qualified annotators.",
        scoringDescription: "Gold scoring is exact label match; agreement compares the selected label across annotators.",
        ...catalogBundlePaths(singleSlug),
      }),
      defineCatalogPreset({
        slug: multiSlug, title: "Audio classification · multiple choice",
        summary: "Assign every applicable label to an audio clip.", family: "Classification",
        useCases: ["Mixed-content tagging", "Acoustic attributes", "Multi-label moderation"], modality: "audio",
        schema: { annotation_type: "categorical", schema_version: 1, choices: ["Speech", "Music", "Noise"], multi_select: true },
        samples: catalogSamples(multiSlug, [
          { filename: "sample_001.wav", metadata: { language: "English", difficulty: 1, content_type: "Mixed" }, goldAnswer: { values: ["Speech"] } },
          { filename: "sample_002.wav", metadata: { language: "English", difficulty: 1, content_type: "Mixed" }, goldAnswer: { values: ["Speech"] } },
        ]),
        metadataDescription: "Language, difficulty, and content type describe each mixed clip.",
        scoringDescription: "Gold and agreement scoring use set overlap across the selected labels.",
        ...catalogBundlePaths(multiSlug),
      }),
    ];
  }

  description(mediaName: string) { return `Choose one or more labels for the whole ${mediaName.toLowerCase()} sample`; }
  defaultSchema(): CategoricalSchema { return { annotation_type: "categorical", schema_version: 1, choices: ["Good", "Noisy", "Unusable"], multi_select: false }; }
  createInitialAnswer(schema: CategoricalSchema): CategoricalAnswer {
    return schema.multi_select ? { values: [] } : { value: "" };
  }
  createInteraction() { return { kind: "none" as const }; }
  isComplete(schema: CategoricalSchema, answer: CategoricalAnswer) { return schema.multi_select ? (answer.values?.length ?? 0) > 0 : Boolean(answer.value); }
  validateSchema(schema: CategoricalSchema): string[] {
    const choices = schema.choices.map(choice => choice.trim());
    if (!choices.length || choices.some(choice => !choice)) return ["Add at least one non-empty label"];
    if (new Set(choices).size !== choices.length) return ["Labels must be unique"];
    return [];
  }
  validateAnswer(answer: unknown, schema: CategoricalSchema): string[] {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return ["Gold answer must be an object"];
    const value = answer as Record<string, unknown>;
    if (schema.multi_select) {
      if (!Array.isArray(value.values) || value.values.length === 0) return ["Gold answer requires a non-empty values array"];
      const unknown = value.values.find(label => typeof label !== "string" || !schema.choices.includes(label));
      return unknown ? [`Unknown gold label: ${String(unknown)}`] : [];
    }
    if (typeof value.value !== "string") return ["Gold answer requires a value"];
    return schema.choices.includes(value.value) ? [] : [`Unknown gold label: ${value.value}`];
  }
  goldAnswerShape(schema: CategoricalSchema) { return schema.multi_select ? "{ values: string[] }" : "{ value: string }"; }
  goldInstructions(schema: CategoricalSchema) { return [`Labels must be one of: ${schema.choices.join(", ")}.`]; }
  createGoldExample(schema: CategoricalSchema): CategoricalAnswer {
    return schema.multi_select ? { values: schema.choices.slice(0, 2).length ? schema.choices.slice(0, 2) : ["Your label"] } : { value: schema.choices[0] || "Your label" };
  }
}

export const categoricalPlugin = new CategoricalAnnotationModule();
