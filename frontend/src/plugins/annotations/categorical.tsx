import type { AnnotationAnswer } from "../../components/annotator/types";
import type { AnnotationPlugin, AnnotationControlProps } from "../contracts";

function CategoricalControl({ schema, answer, onChange }: AnnotationControlProps) {
  if (schema.multi_select) {
    const selected = answer.values ?? [];
    return (
      <fieldset style={{ border: 0 }}>
        <legend className="form-label" style={{ marginBottom: "10px" }}>Select one or more labels</legend>
        <div className="flex-col" style={{ gap: "10px" }}>
          {schema.choices.map(choice => (
            <label key={choice} className="flex-row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selected.includes(choice)}
                onChange={() => onChange({
                  values: selected.includes(choice)
                    ? selected.filter(value => value !== choice)
                    : [...selected, choice],
                })}
              />
              {choice}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div>
      <label className="form-label" htmlFor="categorical-answer">Select a label</label>
      <select
        id="categorical-answer"
        className="form-select"
        value={answer.value ?? ""}
        onChange={event => onChange({ value: event.target.value })}
      >
        <option value="">-- Choose --</option>
        {schema.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select>
    </div>
  );
}

function CategoricalAnswerView({ answer }: { answer: AnnotationAnswer }) {
  if (answer.values !== undefined) return <span>{answer.values.join(", ") || "No choices"}</span>;
  return <span>{answer.value ?? "No choice"}</span>;
}

export const categoricalPlugin: AnnotationPlugin = {
  key: "categorical",
  description: mediaName => `Choose one or more labels for the whole ${mediaName.toLowerCase()} sample`,
  requiredInteraction: "none",
  Control: CategoricalControl,
  AnswerView: CategoricalAnswerView,
  createInitialAnswer: () => ({}),
  createInteraction: () => ({ kind: "none" }),
  isComplete: (schema, answer) => schema.multi_select
    ? (answer.values?.length ?? 0) > 0
    : Boolean(answer.value),
  validateGold: (answer, schema) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return ["Gold answer must be an object"];
    const value = answer as Record<string, unknown>;
    if (schema.multi_select) {
      if (!Array.isArray(value.values) || value.values.length === 0) return ["Gold answer requires a non-empty values array"];
      const unknown = value.values.find(label => typeof label !== "string" || !schema.choices.includes(label));
      return unknown ? [`Unknown gold label: ${String(unknown)}`] : [];
    }
    if (typeof value.value !== "string") return ["Gold answer requires a value"];
    return schema.choices.includes(value.value) ? [] : [`Unknown gold label: ${value.value}`];
  },
  goldAnswerShape: schema => schema.multi_select ? "{ values: string[] }" : "{ value: string }",
  createGoldExample: schema => schema.multi_select
    ? { values: schema.choices.slice(0, 2).length ? schema.choices.slice(0, 2) : ["Your label"] }
    : { value: schema.choices[0] || "Your label" },
};
