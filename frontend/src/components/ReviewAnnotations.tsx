import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { getAnnotationPlugin } from "../plugins/annotations/registry";
import { getMediaPlugin } from "../plugins/media/registry";
import type { AnnotationAnswer } from "./annotator/types";

interface AnnotationRecord {
  id: string;
  annotator_id: string;
  answer: AnnotationAnswer;
  submitted_at: string;
}

interface ReviewSample {
  id: string;
  filename: string;
  raw_uri: string;
  media_url: string;
  is_gold: boolean;
  gold_answer: AnnotationRecord["answer"] | null;
  metadata: Record<string, unknown>;
  agreement_score: number | null;
  n_annotations: number;
  annotations: AnnotationRecord[];
}

interface ReviewData {
  experiment: {
    id: string;
    name: string;
    modality: string;
    label_schema: { annotation_type: string };
  };
  samples: ReviewSample[];
}

const formatScore = (score: number | null) => score == null ? "Pending" : `${(score * 100).toFixed(0)}%`;

export default function ReviewAnnotations({ experimentId }: { experimentId: string }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReview = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/experiments/${experimentId}/review`);
      if (!response.ok) throw new Error("Could not load annotations");
      setData(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load annotations");
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => { loadReview(); }, [loadReview]);

  if (loading) return <div className="container text-center">Loading annotations…</div>;
  if (!data) return <div className="container text-center">{error || "Experiment not found"}</div>;
  const mediaPlugin = getMediaPlugin(data.experiment.modality);
  const annotationPlugin = getAnnotationPlugin(data.experiment.label_schema.annotation_type);
  const AnswerView = annotationPlugin?.AnswerView;
  const MediaPreview = mediaPlugin?.PreviewRenderer;

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "1200px" }}>
      <div className="page-heading">
        <div>
          <h1 style={{ fontSize: "2rem" }}>Review: {data.experiment.name}</h1>
          <p style={{ margin: 0 }}>
            {data.samples.length} sample(s) · {data.samples.reduce((total, sample) => total + sample.n_annotations, 0)} annotation(s)
          </p>
        </div>
        <div className="flex-row page-actions">
          <Link href={`/experiments/${experimentId}`} className="btn btn-secondary">
            <BarChart3 size={16} /> Statistics
          </Link>
          <button className="btn btn-primary" onClick={loadReview}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {data.samples.length === 0 ? (
        <div className="glass-panel text-center"><h3>No samples</h3><p>Upload data to begin collecting annotations.</p></div>
      ) : (
        <div className="flex-col" style={{ gap: "24px" }}>
          {data.samples.map((sample, sampleIndex) => (
            <section key={sample.id} className="glass-panel sample-review-card">
              <div className="sample-review-header">
                <div>
                  <p className="sample-number">Sample {sampleIndex + 1}</p>
                  <h2 title={sample.raw_uri}>{sample.filename}</h2>
                </div>
                <div className="sample-metadata">
                  {sample.is_gold && <span className="metadata-chip gold-chip">Gold</span>}
                  <span className="metadata-chip">{sample.n_annotations} annotation(s)</span>
                  <span className="metadata-chip">Agreement: {formatScore(sample.agreement_score)}</span>
                </div>
              </div>

              {MediaPreview
                ? <MediaPreview mediaUrl={sample.media_url} title={sample.filename} />
                : <p>Unsupported media modality: {data.experiment.modality}</p>}

              {Object.keys(sample.metadata).length > 0 && (
                <div className="sample-metadata" style={{ marginBottom: "20px" }}>
                  {Object.entries(sample.metadata).map(([key, value]) => (
                    <span key={key} className="metadata-chip">{key}: {String(value)}</span>
                  ))}
                </div>
              )}

              {sample.gold_answer && (
                <div className="gold-answer">
                  <span className="annotation-label">Gold answer</span>
                  {AnswerView ? <AnswerView answer={sample.gold_answer} /> : <code>{JSON.stringify(sample.gold_answer)}</code>}
                </div>
              )}

              <div className="annotation-list">
                <h3>Submitted annotations</h3>
                {sample.annotations.length === 0 ? (
                  <p>No annotations have been submitted for this sample.</p>
                ) : sample.annotations.map((annotation, index) => (
                  <article key={annotation.id} className="annotation-row">
                    <div className="annotation-meta">
                      <span className="annotation-label">Annotation {index + 1}</span>
                      <span>Annotator {annotation.annotator_id.slice(0, 8)}</span>
                      <time>{new Date(annotation.submitted_at).toLocaleString()}</time>
                    </div>
                    {AnswerView ? <AnswerView answer={annotation.answer} /> : <code>{JSON.stringify(annotation.answer)}</code>}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Link href="/" className="btn btn-secondary" style={{ marginTop: "24px" }}>
        <ArrowLeft size={16} /> Back to experiments
      </Link>
    </div>
  );
}
