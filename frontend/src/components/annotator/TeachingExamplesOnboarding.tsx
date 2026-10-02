import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import AnnotationOverlaySelector from "../AnnotationOverlaySelector";
import { getAnnotationPlugin } from "../../plugins/annotations/registry";
import type { LabelSchema, TeachingExampleItem } from "./types";

interface Props {
  modality: string;
  schema: LabelSchema;
  teachingExamples: TeachingExampleItem[];
  onComplete: () => Promise<void> | void;
  submitting?: boolean;
  error?: string | null;
}

export default function TeachingExamplesOnboarding({
  modality,
  schema,
  teachingExamples,
  onComplete,
  submitting = false,
  error = null,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!teachingExamples.length) {
    return null;
  }

  const currentExample = teachingExamples[currentIndex] || teachingExamples[0];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === teachingExamples.length - 1;
  const plugin = getAnnotationPlugin(schema.annotation_type);
  const AnswerView = plugin?.AnswerView;

  return (
    <div
      className="container animate-fade-in"
      style={{ width: "100%", maxWidth: "960px", margin: "0 auto" }}
    >
      <div className="glass-panel teaching-onboarding-header" style={{ marginBottom: "20px" }}>
        <div className="flex-row" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div className="flex-row" style={{ alignItems: "center", gap: "10px" }}>
            <div className="teaching-badge">
              <Sparkles size={16} />
              <span>Teaching Example</span>
            </div>
            <span className="teaching-step-count">
              {currentIndex + 1} of {teachingExamples.length}
            </span>
          </div>
          <div className="teaching-progress-dots" aria-label="Progress">
            {teachingExamples.map((_, idx) => (
              <span
                key={idx}
                className={`teaching-dot ${idx === currentIndex ? "active" : ""} ${idx < currentIndex ? "passed" : ""}`}
              />
            ))}
          </div>
        </div>

        <h2 style={{ marginTop: "12px", marginBottom: "4px" }}>
          Observational Example: How to Annotate
        </h2>
        <p style={{ color: "var(--tide-slate)", margin: 0, fontSize: "0.95rem" }}>
          Review this example with the correct answer displayed. This is purely for demonstration and will not be scored.
        </p>
      </div>

      <div className="teaching-onboarding-media" style={{ marginBottom: "20px" }}>
        <AnnotationOverlaySelector
          modality={modality}
          schema={schema}
          mediaUrl={currentExample.media_url}
          title={currentExample.filename || `Teaching Example ${currentIndex + 1}`}
          hideAnswerCode={true}
          options={[
            {
              id: "teaching-answer",
              label: "Correct answer",
              answer: currentExample.displayed_answer,
            },
          ]}
        />
      </div>

      <div className="glass-panel teaching-details-panel" style={{ marginBottom: "20px" }}>
        <div className="teaching-answer-section">
          <span className="teaching-section-label">Expected Answer</span>
          <div className="teaching-answer-content">
            {AnswerView ? (
              <AnswerView answer={currentExample.displayed_answer} />
            ) : (
              <code>{JSON.stringify(currentExample.displayed_answer)}</code>
            )}
          </div>
        </div>

        {currentExample.explanation && (
          <div className="teaching-explanation-section">
            <span className="teaching-section-label">Why This Is Correct</span>
            <p className="teaching-explanation-text">{currentExample.explanation}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="form-error" style={{ marginBottom: "16px" }}>
          {error}
        </div>
      )}

      <div className="teaching-actions-bar">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setCurrentIndex((idx) => Math.max(0, idx - 1))}
          disabled={isFirst || submitting}
        >
          <ArrowLeft size={16} /> Previous
        </button>

        {!isLast ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              setCurrentIndex((idx) => Math.min(teachingExamples.length - 1, idx + 1))
            }
            disabled={submitting}
          >
            Next example <ArrowRight size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onComplete}
            disabled={submitting}
          >
            {submitting ? "Starting real queue…" : "Start annotating"} <Check size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
