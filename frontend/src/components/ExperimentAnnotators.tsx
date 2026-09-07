import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  RefreshCw,
  UserRound,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { apiFetch } from "../api";
import { getAnnotationPlugin } from "../plugins/annotations/registry";
import { getMediaPlugin } from "../plugins/media/registry";
import type { AnnotationAnswer } from "./annotator/types";

interface QualificationQuestion {
  key: string;
  label: string;
  type: string;
}

interface AnnotatorSummary {
  id: string;
  display_name: string;
  email: string | null;
  identity_type: "signed_in" | "anonymous";
  status: "active" | "paused";
  items_completed: number;
  gold_items_seen: number;
  rolling_gold_accuracy: number | null;
  rolling_agreement_score: number | null;
  qualification_answers: Record<string, unknown>;
  qualified_at: string | null;
  created_at: string;
  last_activity_at: string;
}

interface AnnotatorListData {
  experiment: {
    id: string;
    name: string;
    qualification_form: QualificationQuestion[];
  };
  annotators: AnnotatorSummary[];
}

interface AnnotatorAnnotation {
  id: string;
  data_unit_id: string;
  filename: string;
  raw_uri: string;
  media_url: string;
  metadata: Record<string, unknown>;
  answer: AnnotationAnswer;
  submitted_at: string;
  is_gold: boolean;
  gold_answer: AnnotationAnswer | null;
  gold_score: number | null;
  agreement_score: number | null;
}

interface AnnotatorDetailData {
  experiment: {
    id: string;
    name: string;
    modality: string;
    label_schema: { annotation_type: string };
    qualification_form: QualificationQuestion[];
  };
  annotator: AnnotatorSummary;
  annotations: AnnotatorAnnotation[];
}

const formatScore = (score: number | null) =>
  score == null ? "Not available" : `${(score * 100).toFixed(0)}%`;

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const formatAnswer = (answer: unknown) => {
  if (Array.isArray(answer)) return answer.join(", ");
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  return String(answer ?? "—");
};

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : fallback;
}

export default function ExperimentAnnotators({ experimentId }: { experimentId: string }) {
  const [data, setData] = useState<AnnotatorListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/annotators`);
      if (!response.ok) throw new Error(await responseError(response, "Could not load annotators"));
      setData(await response.json());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load annotators");
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="container text-center">Loading annotators…</div>;
  if (!data) return <div className="container text-center">{error || "Experiment not found"}</div>;

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "1200px" }}>
      <div className="page-heading">
        <div>
          <p className="sample-number">Experiment participants</p>
          <h1 style={{ fontSize: "2rem" }}>{data.experiment.name}</h1>
          <p style={{ margin: 0 }}>Only people who have submitted at least one annotation appear here.</p>
        </div>
        <div className="flex-row page-actions">
          <Link href={`/experiments/${experimentId}`} className="btn btn-secondary">
            <BarChart3 size={16} /> Statistics
          </Link>
          <button className="btn btn-primary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      <section className="glass-panel annotator-table-panel">
        <div className="section-heading-inline">
          <div><h2>Annotators</h2><p>{data.annotators.length} participant(s)</p></div>
          <Users size={24} aria-hidden="true" />
        </div>
        <div className="table-scroll">
          <table className="data-table annotator-results-table">
            <thead>
              <tr>
                <th>Annotator</th><th>Status</th><th>Annotations</th><th>Gold score</th>
                <th>Agreement score</th><th>Last activity</th><th />
              </tr>
            </thead>
            <tbody>
              {data.annotators.map(annotator => (
                <tr key={annotator.id}>
                  <td>
                    <div className="annotator-identity">
                      <Link
                        href={`/experiments/${experimentId}/annotators/${annotator.id}`}
                        className="annotator-name-link"
                      >
                        {annotator.display_name}
                      </Link>
                      <span>{annotator.email || "Anonymous session"}</span>
                    </div>
                  </td>
                  <td><span className={`status-chip status-${annotator.status}`}>{annotator.status}</span></td>
                  <td>{annotator.items_completed}</td>
                  <td>
                    <strong>{formatScore(annotator.rolling_gold_accuracy)}</strong>
                    <span className="metric-context">{annotator.gold_items_seen} gold item(s)</span>
                  </td>
                  <td>{formatScore(annotator.rolling_agreement_score)}</td>
                  <td>{formatDate(annotator.last_activity_at)}</td>
                  <td>
                    <Link
                      href={`/experiments/${experimentId}/annotators/${annotator.id}`}
                      className="btn btn-secondary"
                    >
                      View work <ArrowRight size={15} />
                    </Link>
                  </td>
                </tr>
              ))}
              {data.annotators.length === 0 && (
                <tr><td colSpan={7} className="empty-table-cell">No annotations have been submitted yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function AnnotatorDetail({ experimentId, annotatorId }: { experimentId: string; annotatorId: string }) {
  const [data, setData] = useState<AnnotatorDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/annotators/${annotatorId}`);
      if (!response.ok) throw new Error(await responseError(response, "Could not load annotator activity"));
      setData(await response.json());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load annotator activity");
    } finally {
      setLoading(false);
    }
  }, [annotatorId, experimentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="container text-center">Loading annotator activity…</div>;
  if (!data) return <div className="container text-center">{error || "Annotator not found"}</div>;

  const annotationPlugin = getAnnotationPlugin(data.experiment.label_schema.annotation_type);
  const mediaPlugin = getMediaPlugin(data.experiment.modality);
  const AnswerView = annotationPlugin?.AnswerView;
  const MediaPreview = mediaPlugin?.PreviewRenderer;
  const annotator = data.annotator;

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "1100px" }}>
      <div className="page-heading">
        <div>
          <p className="sample-number">Annotator activity</p>
          <h1 style={{ fontSize: "2rem" }}>{annotator.display_name}</h1>
          <p style={{ margin: 0 }}>{annotator.email || `Anonymous ID ${annotator.id.slice(0, 8)}`} · {data.experiment.name}</p>
        </div>
        <div className="flex-row page-actions">
          <Link href={`/experiments/${experimentId}/annotators`} className="btn btn-secondary">
            <ArrowLeft size={16} /> All annotators
          </Link>
          <button className="btn btn-primary" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="annotator-metric-grid">
        <div className="glass-panel"><span>Annotations</span><strong>{annotator.items_completed}</strong></div>
        <div className="glass-panel"><span>Gold score</span><strong>{formatScore(annotator.rolling_gold_accuracy)}</strong><small>{annotator.gold_items_seen} gold item(s)</small></div>
        <div className="glass-panel"><span>Agreement score</span><strong>{formatScore(annotator.rolling_agreement_score)}</strong><small>Compared with other annotators</small></div>
        <div className="glass-panel"><span>Last activity</span><strong className="metric-date">{formatDate(annotator.last_activity_at)}</strong></div>
      </div>

      {data.experiment.qualification_form.length > 0 && (
        <section className="glass-panel qualification-summary">
          <div className="section-heading-inline"><h2>Qualification answers</h2><CheckCircle2 size={22} /></div>
          <dl>
            {data.experiment.qualification_form.map(question => (
              <div key={question.key}><dt>{question.label}</dt><dd>{formatAnswer(annotator.qualification_answers[question.key])}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <div className="section-heading-inline annotation-history-heading">
        <div><h2>Annotation history</h2><p>{data.annotations.length} submission(s), newest first</p></div>
        <UserRound size={24} aria-hidden="true" />
      </div>
      {data.annotations.length === 0 ? (
        <div className="glass-panel text-center"><p>No annotations were submitted.</p></div>
      ) : (
        <div className="flex-col" style={{ gap: "20px" }}>
          {data.annotations.map((annotation, index) => (
            <section key={annotation.id} className="glass-panel sample-review-card">
              <div className="sample-review-header">
                <div><p className="sample-number">Submission {data.annotations.length - index}</p><h2 title={annotation.raw_uri}>{annotation.filename}</h2></div>
                <div className="sample-metadata">
                  {annotation.is_gold ? (
                    <><span className="metadata-chip gold-chip">Gold item</span><span className="metadata-chip gold-chip">Gold score: {formatScore(annotation.gold_score)}</span></>
                  ) : (
                    <span className="metadata-chip">Sample agreement: {formatScore(annotation.agreement_score)}</span>
                  )}
                  <span className="metadata-chip">{formatDate(annotation.submitted_at)}</span>
                </div>
              </div>

              {MediaPreview && <MediaPreview mediaUrl={annotation.media_url} title={annotation.filename} />}
              {Object.keys(annotation.metadata).length > 0 && (
                <div className="sample-metadata annotation-metadata">
                  {Object.entries(annotation.metadata).map(([key, value]) => <span key={key} className="metadata-chip">{key}: {formatAnswer(value)}</span>)}
                </div>
              )}
              <div className="annotation-comparison">
                <div className="annotation-row">
                  <span className="annotation-label">Submitted answer</span>
                  {AnswerView ? <AnswerView answer={annotation.answer} /> : <code>{JSON.stringify(annotation.answer)}</code>}
                </div>
                {annotation.gold_answer && (
                  <div className="gold-answer">
                    <span className="annotation-label">Expected gold answer</span>
                    {AnswerView ? <AnswerView answer={annotation.gold_answer} /> : <code>{JSON.stringify(annotation.gold_answer)}</code>}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
