import { useReducer } from "react";

import { getAnnotationPlugin } from "../../plugins/annotations/registry";
import type { ValidatedCatalogPreset } from "../../plugins/catalog/types";
import { AnnotationExperience } from "../annotator/AnnotationExperience";
import type { AnnotationAnswer, LabelSchema } from "../annotator/types";

export interface PreviewState { selectedSample: number; answer: AnnotationAnswer }
export type PreviewAction =
  | { type: "answer-changed"; answer: AnnotationAnswer }
  | { type: "sample-selected"; index: number }
  | { type: "reset" };

export function reducePreview(
  state: PreviewState,
  action: PreviewAction,
  createInitialAnswer: () => AnnotationAnswer,
): PreviewState {
  if (action.type === "answer-changed") return { ...state, answer: action.answer };
  if (action.type === "sample-selected") return { selectedSample: action.index, answer: createInitialAnswer() };
  return { selectedSample: 0, answer: createInitialAnswer() };
}

export default function CatalogPreview({ preset }: { preset: ValidatedCatalogPreset }) {
  const module = getAnnotationPlugin(preset.annotationType)!;
  const createInitialAnswer = () => module.createInitialAnswer(preset.schema);
  const [state, dispatch] = useReducer(
    (current: PreviewState, action: PreviewAction) => reducePreview(current, action, createInitialAnswer),
    undefined,
    () => ({ selectedSample: 0, answer: createInitialAnswer() }),
  );
  const sample = preset.samples[state.selectedSample] ?? preset.samples[0];

  return <div className="catalog-preview">
    {preset.samples.length > 1 && <div className="catalog-sample-selector" role="group" aria-label="Preview sample">
      {preset.samples.map((item, index) => <button
        type="button" key={item.filename}
        className={state.selectedSample === index ? "selected" : ""}
        onClick={() => dispatch({ type: "sample-selected", index })}
      >Sample {index + 1}<small>{item.filename}</small></button>)}
    </div>}
    <AnnotationExperience
      modality={preset.modality}
      schema={preset.schema as LabelSchema}
      answer={state.answer}
      onChange={answer => dispatch({ type: "answer-changed", answer })}
      mediaUrl={sample.mediaPath}
      mediaKey={`${preset.slug}:${sample.filename}`}
      controlHeading="Your annotation"
    />
    <button type="button" className="btn btn-secondary catalog-reset" onClick={() => dispatch({ type: "reset" })}>Reset preview</button>
  </div>;
}
