import type { AnnotationAnswer } from "../../components/annotator/types";
import type { AnnotationPlugin, AnnotationControlProps } from "../contracts";

function SegmentControl({ schema, answer, onChange }: AnnotationControlProps) {
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

function SegmentPreviewInteraction({ answer, onChange }: Pick<AnnotationControlProps, "answer" | "onChange">) {
  return (
    <div className="segment-preview">
      <div className="segment-preview-wave">
        {(answer.regions?.length ?? 0) > 0 && <div className="segment-preview-region">Example region</div>}
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => onChange({
          ...answer,
          regions: answer.regions?.length ? [] : [{ start: 1.25, end: 3.75 }],
        })}
      >
        {answer.regions?.length ? "Remove example region" : "Add example region"}
      </button>
    </div>
  );
}

function SegmentAnswerView({ answer }: { answer: AnnotationAnswer }) {
  return (
    <div>
      <strong>{answer.label ?? "No label"}</strong>
      <div className="region-list">
        {(answer.regions ?? []).map((region, index) => (
          <span key={`${region.start}-${region.end}-${index}`} className="metadata-chip">
            {region.start.toFixed(2)}s–{region.end.toFixed(2)}s
          </span>
        ))}
        {(answer.regions ?? []).length === 0 && <span>No regions</span>}
      </div>
    </div>
  );
}

export const segmentPlugin: AnnotationPlugin = {
  key: "segment",
  description: mediaName => `Mark labeled time regions in ${mediaName.toLowerCase()}`,
  requiredInteraction: "temporal-regions",
  Control: SegmentControl,
  PreviewInteractionEditor: SegmentPreviewInteraction,
  AnswerView: SegmentAnswerView,
  createInitialAnswer: () => ({ regions: [] }),
  createInteraction: (answer, onChange) => ({
    kind: "temporal-regions",
    regions: answer.regions ?? [],
    onChange: regions => onChange({ ...answer, regions }),
  }),
  isComplete: (_schema, answer) => Boolean(answer.label),
  validateGold: (answer, schema) => {
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return ["Gold answer must be an object"];
    const value = answer as Record<string, unknown>;
    if (typeof value.label !== "string" || !schema.choices.includes(value.label)) return ["Gold answer has an unknown or missing label"];
    if (!Array.isArray(value.regions)) return ["Gold answer requires a regions array"];
    const invalid = value.regions.some(region => {
      if (!region || typeof region !== "object") return true;
      const candidate = region as Record<string, unknown>;
      return typeof candidate.start !== "number"
        || typeof candidate.end !== "number"
        || candidate.start < 0
        || candidate.end <= candidate.start;
    });
    return invalid ? ["Gold answer has an invalid time region"] : [];
  },
  goldAnswerShape: () => "{ label: string, regions: [{ start: number, end: number }] }",
  createGoldExample: schema => ({
    label: schema.choices[0] || "Your label",
    regions: [{ start: 0.5, end: 2.75 }],
  }),
  goldGuidance: "Region start/end values are seconds, with end greater than start.",
};
