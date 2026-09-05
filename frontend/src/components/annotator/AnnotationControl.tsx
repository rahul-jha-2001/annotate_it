import type { AnnotationAnswer, LabelSchema } from "./types";

interface Props {
  schema: LabelSchema;
  answer: AnnotationAnswer;
  onChange: (answer: AnnotationAnswer) => void;
}

function CategoricalControl({ schema, answer, onChange }: Props) {
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

function SegmentControl({ schema, answer, onChange }: Props) {
  return (
    <div>
      <label className="form-label" htmlFor="segment-label">Region label</label>
      <select
        id="segment-label"
        className="form-select"
        value={answer.label ?? ""}
        onChange={event => onChange({ ...answer, label: event.target.value })}
      >
        <option value="">-- Choose --</option>
        {schema.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
      </select>
      <p style={{ margin: "10px 0 0", fontSize: "0.85rem" }}>
        {(answer.regions ?? []).length} region(s) selected
      </p>
    </div>
  );
}

const controls: Record<string, (props: Props) => JSX.Element> = {
  categorical: CategoricalControl,
  segment: SegmentControl,
};

export function isAnswerComplete(schema: LabelSchema, answer: AnnotationAnswer): boolean {
  if (schema.annotation_type === "categorical") {
    return schema.multi_select ? (answer.values?.length ?? 0) > 0 : Boolean(answer.value);
  }
  if (schema.annotation_type === "segment") {
    return Boolean(answer.label);
  }
  return false;
}

export default function AnnotationControl(props: Props) {
  const Control = controls[props.schema.annotation_type];
  if (!Control) return <p>Unsupported annotation type: {props.schema.annotation_type}</p>;
  return <Control {...props} />;
}
