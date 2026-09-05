import { useMemo, useState } from "react";
import type { QualificationQuestion } from "./types";

interface Props {
  questions: QualificationQuestion[];
  submitting: boolean;
  onSubmit: (answers: Record<string, unknown>) => Promise<void>;
  error?: string | null;
}

export default function QualificationForm({ questions, submitting, onSubmit, error }: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  const complete = useMemo(() => questions.every(question => {
    if (!question.required) return true;
    const answer = answers[question.key];
    if (question.type === "multi_choice") return Array.isArray(answer) && answer.length > 0;
    return answer !== undefined && answer !== "";
  }), [answers, questions]);

  const setAnswer = (key: string, value: unknown) => {
    setAnswers(current => ({ ...current, [key]: value }));
  };

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "720px" }}>
      <div className="glass-panel">
        <p className="sample-number">Before you begin</p>
        <h1 style={{ fontSize: "2rem" }}>Qualification form</h1>
        <p>Your answers are used only to match you with samples you are qualified to annotate.</p>
        <div className="flex-col" style={{ gap: "22px", marginTop: "24px" }}>
          {questions.map(question => (
            <div key={question.key} className="form-group" style={{ margin: 0 }}>
              <label className="form-label">
                {question.label} {question.required && <span aria-label="required">*</span>}
              </label>
              {question.type === "single_choice" && (
                <select
                  className="form-select"
                  value={(answers[question.key] as string) ?? ""}
                  onChange={event => setAnswer(question.key, event.target.value)}
                >
                  <option value="">-- Choose --</option>
                  {question.options.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              )}
              {question.type === "multi_choice" && (
                <div className="choice-grid">
                  {question.options.map(option => {
                    const selected = (answers[question.key] as string[] | undefined) ?? [];
                    return (
                      <label key={option} className="choice-option">
                        <input
                          type="checkbox"
                          checked={selected.includes(option)}
                          onChange={() => setAnswer(
                            question.key,
                            selected.includes(option)
                              ? selected.filter(value => value !== option)
                              : [...selected, option],
                          )}
                        />
                        {option}
                      </label>
                    );
                  })}
                </div>
              )}
              {question.type === "boolean" && (
                <select
                  className="form-select"
                  value={answers[question.key] === undefined ? "" : String(answers[question.key])}
                  onChange={event => setAnswer(question.key, event.target.value === "true")}
                >
                  <option value="">-- Choose --</option>
                  <option value="true">Yes</option><option value="false">No</option>
                </select>
              )}
              {question.type === "number" && (
                <input
                  className="form-input"
                  type="number"
                  min={question.minimum ?? undefined}
                  max={question.maximum ?? undefined}
                  value={(answers[question.key] as number | undefined) ?? ""}
                  onChange={event => setAnswer(
                    question.key,
                    event.target.value === "" ? undefined : event.target.valueAsNumber,
                  )}
                />
              )}
            </div>
          ))}
        </div>
        {error && <p style={{ color: "#fca5a5", marginTop: "18px" }}>{error}</p>}
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "28px" }}
          disabled={!complete || submitting}
          onClick={() => onSubmit(answers)}
        >
          {submitting ? "Saving…" : "Continue to annotation"}
        </button>
      </div>
    </div>
  );
}
