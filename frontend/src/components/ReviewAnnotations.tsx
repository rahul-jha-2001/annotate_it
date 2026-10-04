import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { getAnnotationPlugin } from "../plugins/annotations/registry";
import type { AnnotationAnswer } from "./annotator/types";
import type { LabelSchema } from "./annotator/types";
import AnnotationOverlaySelector, { buildOverlayOptions } from "./AnnotationOverlaySelector";
import { apiFetch } from "../api";
import { filterReviewSamples, type ReviewSampleFilter } from "./reviewSampleFilter";
import PaginationBar from "./PaginationBar";

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
    label_schema: LabelSchema;
  };
  total_samples?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
  samples: ReviewSample[];
}

const formatScore = (score: number | null) => score == null ? "Pending" : `${(score * 100).toFixed(0)}%`;

export default function ReviewAnnotations({
  experimentId,
  embedded = false,
}: {
  experimentId: string;
  embedded?: boolean;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sampleFilter, setSampleFilter] = useState<ReviewSampleFilter>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const loadReview = useCallback(async (targetPage: number = 1) => {
    setError(null);
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/review?page=${targetPage}&page_size=${pageSize}`);
      if (!response.ok) throw new Error("Could not load annotations");
      const result = await response.json();
      setData(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load annotations");
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    loadReview(page);
  }, [loadReview, page]);

  if (loading) return <div className="container text-center" style={{ padding: "40px 0" }}>Loading annotations…</div>;
  if (!data) return <div className="container text-center" style={{ padding: "40px 0" }}>{error || "Experiment not found"}</div>;
  const annotationPlugin = getAnnotationPlugin(data.experiment.label_schema.annotation_type);
  const AnswerView = annotationPlugin?.AnswerView;
  const annotatedCount = data.samples.filter(sample => sample.n_annotations > 0).length;
  const unannotatedCount = data.samples.length - annotatedCount;
  const filteredSamples = filterReviewSamples(data.samples, sampleFilter);
  const baseOffset = ((data.page ?? page) - 1) * (data.page_size ?? pageSize);
  const sampleNumbers = new Map(data.samples.map((sample, index) => [sample.id, baseOffset + index + 1]));
  const totalSamples = data.total_samples ?? data.samples.length;
  const totalPages = data.total_pages ?? 1;

  const emptyFilterCopy = sampleFilter === "unannotated"
    ? { title: "Every sample has an annotation", detail: "There are no unannotated samples on this page." }
    : { title: "No annotated samples yet", detail: "Submitted annotations will appear here." };

  return (
    <div className={embedded ? "review-annotations-embedded" : "container animate-fade-in"} style={embedded ? {} : { maxWidth: "1200px" }}>
      {!embedded ? (
        <div className="page-heading">
          <div>
            <h1 style={{ fontSize: "2rem" }}>Review: {data.experiment.name}</h1>
            <p style={{ margin: 0 }}>
              {totalSamples} total sample(s) · {data.samples.reduce((total, sample) => total + sample.n_annotations, 0)} annotation(s) on this page
            </p>
          </div>
          <div className="flex-row page-actions">
            <Link href={`/experiments/${experimentId}`} className="btn btn-secondary">
              <BarChart3 size={16} /> Statistics
            </Link>
            <button className="btn btn-primary" onClick={() => loadReview(page)}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>
      ) : (
        <div className="section-heading-inline" style={{ marginBottom: "16px" }}>
          <div>
            <h2 style={{ margin: 0 }}>Samples &amp; Annotations</h2>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              {totalSamples} total sample(s) · Review all items and annotator answers
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => loadReview(page)} title="Refresh annotations">
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      )}

      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {totalSamples === 0 ? (
        <div className="glass-panel text-center"><h3>No samples</h3><p>Upload data to begin collecting annotations.</p></div>
      ) : (
        <>
          <div className="review-filter-bar">
            <div className="review-filter-summary" aria-live="polite">
              <strong>{filteredSamples.length}</strong>
              <span>of {data.samples.length} on page shown</span>
            </div>
            <div className="review-filter-tabs" aria-label="Filter samples by annotation status">
              <button type="button" aria-pressed={sampleFilter === "all"} onClick={() => setSampleFilter("all")}>
                All on page <span>{data.samples.length}</span>
              </button>
              <button type="button" aria-pressed={sampleFilter === "annotated"} onClick={() => setSampleFilter("annotated")}>
                Annotated <span>{annotatedCount}</span>
              </button>
              <button type="button" aria-pressed={sampleFilter === "unannotated"} onClick={() => setSampleFilter("unannotated")}>
                Not annotated <span>{unannotatedCount}</span>
              </button>
            </div>
          </div>

          {filteredSamples.length === 0 ? (
            <div className="glass-panel review-filter-empty text-center">
              <h3>{emptyFilterCopy.title}</h3>
              <p>{emptyFilterCopy.detail}</p>
            </div>
          ) : (
            <div className="flex-col" style={{ gap: "24px" }}>
              {filteredSamples.map(sample => (
                <section key={sample.id} className="glass-panel sample-review-card">
                  <div className="sample-review-header">
                    <div>
                      <p className="sample-number">Sample {sampleNumbers.get(sample.id)}</p>
                      <h2 title={sample.raw_uri}>{sample.filename}</h2>
                    </div>
                    <div className="sample-metadata">
                      {sample.is_gold && <span className="metadata-chip gold-chip">Gold</span>}
                      <span className="metadata-chip">{sample.n_annotations} annotation(s)</span>
                      <span className="metadata-chip">Agreement: {formatScore(sample.agreement_score)}</span>
                    </div>
                  </div>

                  <AnnotationOverlaySelector
                    modality={data.experiment.modality}
                    schema={data.experiment.label_schema}
                    mediaUrl={sample.media_url}
                    title={sample.filename}
                    options={buildOverlayOptions(sample.gold_answer, sample.annotations.map((annotation, index) => ({
                      id: annotation.id,
                      label: `Annotation ${index + 1}`,
                      answer: annotation.answer,
                    })))}
                  />

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

          <PaginationBar
            page={data.page ?? page}
            totalPages={totalPages}
            totalItems={totalSamples}
            pageSize={data.page_size ?? pageSize}
            onPageChange={newPage => {
              setPage(newPage);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            itemName="samples"
          />
        </>
      )}
      {!embedded && (
        <Link href="/" className="btn btn-secondary" style={{ marginTop: "24px" }}>
          <ArrowLeft size={16} /> Back to experiments
        </Link>
      )}
    </div>
  );
}
