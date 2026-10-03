import { useEffect, useState, useCallback } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { apiFetch } from "../api";
import { getMediaPlugin } from "../plugins/media/registry";
import AnnotationOverlaySelector, { buildOverlayOptions } from "./AnnotationOverlaySelector";
import type { AnnotationAnswer, LabelSchema } from "./annotator/types";
import { parseCsv, parseDatasetBundle, type MetadataFieldDefinition, type ParsedDatasetRow } from "./datasetBundle";

export interface QualificationQuestion {
  key: string;
  label: string;
  type: "single_choice" | "multi_choice" | "boolean" | "number" | "text";
  required: boolean;
  options: string[];
  minimum?: number;
  maximum?: number;
}

export interface RoutingRule {
  metadata_field: string;
  operator: "equals" | "in" | "gte";
  question_key: string;
}

export interface TeachingExampleDraft {
  filename: string;
  data_unit_id?: string;
  answer: AnnotationAnswer;
  answerText: string;
  explanation: string;
  error?: string | null;
  keepAsGold?: boolean;
}

export const routingOperatorFor = (
  field: MetadataFieldDefinition | undefined,
  question: QualificationQuestion | undefined,
): RoutingRule["operator"] | null => {
  if (!field || !question) return null;
  if (field.type === "number" && question.type === "number") return "gte";
  if (field.type === "boolean" && question.type === "boolean") return "equals";
  if (["text", "choice"].includes(field.type) && question.type === "multi_choice") return "in";
  if (["text", "choice"].includes(field.type) && question.type === "single_choice") return "equals";
  return null;
};

// --------------------------------------------------------------------------
// 1. Status Banner
// --------------------------------------------------------------------------
export function ExperimentStatusBanner({
  status,
  bundleJobProgress,
  onReuploadMedia,
}: {
  status: string;
  bundleJobProgress?: { files_processed?: number; files_total?: number } | null;
  onReuploadMedia?: () => void;
}) {
  if (status === "draft_media_processing") {
    return (
      <div style={{ background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "8px", padding: "14px 18px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Loader2 size={20} className="spin-animate text-blue-600" style={{ flexShrink: 0 }} />
        <div>
          <strong style={{ color: "#3b82f6", display: "block", fontSize: "0.95rem" }}>
            Dataset Archive Processing in Background
          </strong>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Processed {bundleJobProgress?.files_processed ?? 0} of {bundleJobProgress?.files_total ?? "?"} files.
            You can configure qualifications, teaching examples, or review declared metadata below while extraction completes.
          </span>
        </div>
      </div>
    );
  }

  if (status === "draft_media_failed") {
    return (
      <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", padding: "14px 18px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)", fontWeight: 600, fontSize: "0.95rem" }}>
          <AlertCircle size={20} /> Media Archive Extraction Failed
        </div>
        <p style={{ margin: "6px 0 12px", fontSize: "0.875rem" }}>
          The media archive extraction encountered an error. You can re-upload the zip archive or fix your declared metadata/gold answers.
        </p>
        {onReuploadMedia && (
          <button type="button" className="btn btn-secondary" onClick={onReuploadMedia} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <RefreshCw size={15} /> Re-upload Media (.zip)
          </button>
        )}
      </div>
    );
  }

  if (status === "draft") {
    return (
      <div style={{ background: "rgba(100, 116, 139, 0.08)", border: "1px solid rgba(100, 116, 139, 0.25)", borderRadius: "8px", padding: "12px 18px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
        <Info size={18} style={{ color: "#64748b", flexShrink: 0 }} />
        <span style={{ fontSize: "0.875rem" }}>
          <strong>Draft Experiment</strong> — Configure your dataset, qualifications, and teaching examples below, then click Deploy to start accepting annotations.
        </span>
      </div>
    );
  }

  return null;
}

// --------------------------------------------------------------------------
// 2. Deploy Section
// --------------------------------------------------------------------------
export function ExperimentDeploySection({
  experimentId,
  status,
  onDeployed,
}: {
  experimentId: string;
  status: string;
  onDeployed?: () => void;
}) {
  const [validation, setValidation] = useState<{
    can_deploy: boolean;
    status: string;
    orphaned_gold_entries: string[];
    missing_from_extraction: string[];
    missing_from_metadata: string[];
    blocker_reason?: string | null;
  } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchValidation = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/experiments/${experimentId}/pre-deploy-validation`);
      if (res.ok) {
        setValidation(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch pre-deploy validation", err);
    }
  }, [experimentId]);

  useEffect(() => {
    fetchValidation();
    let interval: number | undefined;
    if (status === "draft_media_processing") {
      interval = window.setInterval(fetchValidation, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchValidation, status]);

  const handleDeploy = async () => {
    setDeploying(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/experiments/${experimentId}/deploy`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Could not deploy experiment");
      }
      onDeployed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  };

  const isProcessing = status === "draft_media_processing";
  const isFailed = status === "draft_media_failed";
  const canDeploy = validation ? validation.can_deploy && !isProcessing && !isFailed : false;

  return (
    <div className="glass-panel" style={{ padding: "20px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "1.15rem" }}>Deploy Experiment</h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Validate data units, sync gold answers, and activate annotator share links.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canDeploy || deploying}
          onClick={handleDeploy}
          title={
            isProcessing
              ? "Cannot deploy while media archive is processing"
              : isFailed
              ? "Cannot deploy when media extraction failed"
              : validation && !validation.can_deploy
              ? validation.blocker_reason ?? "Cannot deploy until validation issues are resolved"
              : undefined
          }
          style={{ minWidth: "160px" }}
        >
          {deploying ? (
            <>
              <Loader2 size={16} className="spin-animate" /> Deploying…
            </>
          ) : (
            <>
              Deploy Experiment <Check size={16} />
            </>
          )}
        </button>
      </div>

      {error && <p className="form-error" style={{ marginTop: "12px" }}>{error}</p>}

      {validation && (
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {Boolean(validation.orphaned_gold_entries && validation.orphaned_gold_entries.length > 0) && (
            <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", padding: "12px 16px", display: "flex", gap: "10px", alignItems: "flex-start", color: "var(--danger)" }}>
              <AlertCircle size={18} style={{ marginTop: "2px", flexShrink: 0 }} />
              <div>
                <strong>{validation.orphaned_gold_entries.length} gold entries reference files that were never found in the uploaded archive:</strong>
                <p style={{ margin: "4px 0", fontSize: "0.85rem", wordBreak: "break-all" }}>{validation.orphaned_gold_entries.join(", ")}</p>
                <span style={{ fontSize: "0.85rem" }}>Fix the gold manifest before deploying.</span>
              </div>
            </div>
          )}
          {Boolean(validation.missing_from_extraction && validation.missing_from_extraction.length > 0) && (
            <div style={{ background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.3)", borderRadius: "8px", padding: "12px 16px", display: "flex", gap: "10px", alignItems: "flex-start", color: "#d97706" }}>
              <AlertTriangle size={18} style={{ marginTop: "2px", flexShrink: 0 }} />
              <div>
                <strong>{validation.missing_from_extraction.length} files listed in your metadata were not found in the archive:</strong>
                <p style={{ margin: "4px 0", fontSize: "0.85rem", wordBreak: "break-all" }}>{validation.missing_from_extraction.join(", ")}</p>
                <span style={{ fontSize: "0.85rem" }}>They will not be part of this experiment.</span>
              </div>
            </div>
          )}
          {Boolean(validation.missing_from_metadata && validation.missing_from_metadata.length > 0) && (
            <div style={{ background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: "8px", padding: "12px 16px", display: "flex", gap: "10px", alignItems: "flex-start", color: "var(--accent)" }}>
              <Info size={18} style={{ marginTop: "2px", flexShrink: 0 }} />
              <div>
                <strong>{validation.missing_from_metadata.length} extracted files have no metadata row.</strong>
                <span style={{ display: "block", fontSize: "0.85rem" }}>This is normal if metadata was optional for your use case.</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// 3. Dataset Review & Upload Section
// --------------------------------------------------------------------------
export function ExperimentDatasetSection({
  experimentId,
  modality,
  labelSchema,
  status,
  onUpdated,
}: {
  experimentId: string;
  modality: string;
  labelSchema: LabelSchema;
  status: string;
  onUpdated?: () => void;
}) {
  const [metadataCsv, setMetadataCsv] = useState("");
  const [goldManifest, setGoldManifest] = useState("");
  const [datasetRows, setDatasetRows] = useState<ParsedDatasetRow[]>([]);
  const [metadataFields, setMetadataFields] = useState<MetadataFieldDefinition[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const mediaPlugin = getMediaPlugin(modality);

  const loadData = useCallback(async () => {
    try {
      const unitsRes = await apiFetch(`/api/experiments/${experimentId}/data-units`);
      if (unitsRes.ok) {
        const unitsData = await unitsRes.json();
        const units = unitsData.data_units || [];

        const urls: Record<string, string> = {};
        for (const u of units) {
          const fn = u.filename || u.raw_uri?.split("/").pop() || u.id;
          if (u.raw_uri) urls[fn] = u.raw_uri;
        }
        setMediaUrls(urls);

        const filenames = units.map((u: any) => u.filename || u.raw_uri.rsplit?.("/", 1)?.[1] || u.id);
        const allowPending = status === "draft_media_processing" || filenames.length === 0;

        const parsed = parseDatasetBundle(filenames, metadataCsv, goldManifest, {
          schema: labelSchema,
          allowPendingMedia: allowPending,
        });
        setMetadataFields(parsed.metadataFields);
        setDatasetRows(parsed.rows);
      }
    } catch (e) {
      console.error("Failed to load dataset rows", e);
    }
  }, [experimentId, status, metadataCsv, goldManifest, labelSchema]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUploadMetadataCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setMetadataCsv(text);
    setFeedback(null);
    try {
      const parsed = parseCsv(text.replace(/^\uFEFF/, ""));
      if (parsed.length > 1) {
        const headers = parsed[0].map(h => h.trim());
        const fnIdx = headers.indexOf("filename");
        if (fnIdx >= 0) {
          const rows = parsed.slice(1).map(r => {
            const fn = r[fnIdx]?.trim();
            const attrs: Record<string, any> = {};
            headers.forEach((h, i) => { if (i !== fnIdx && r[i]) attrs[h] = r[i]; });
            return { filename: fn, attributes: attrs };
          }).filter(r => Boolean(r.filename));
          await apiFetch(`/api/experiments/${experimentId}/reupload-metadata`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          setFeedback("Metadata successfully synced.");
          onUpdated?.();
        }
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to sync metadata");
    }
  };

  const handleUploadGoldJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setGoldManifest(text);
    setFeedback(null);
    try {
      const manifestObj = JSON.parse(text);
      if (Array.isArray(manifestObj)) {
        const res = await apiFetch(`/api/experiments/${experimentId}/reupload-gold-manifest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: manifestObj }),
        });
        if (res.ok) {
          setFeedback("Gold answers successfully synced.");
          onUpdated?.();
        }
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to sync gold answers");
    }
  };

  const goldCount = datasetRows.filter(r => Boolean(r.goldAnswer)).length;

  return (
    <div className="glass-panel" style={{ padding: "24px", marginBottom: "24px" }}>
      <div className="section-heading">
        <div>
          <h3>Dataset &amp; Gold Answers</h3>
          <p>Review uploaded media samples, declared metadata attributes, and quality-check gold answers.</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
        <label className="dropzone compact">
          <UploadCloud className="dropzone-icon" />
          <strong>Upload / Replace metadata CSV</strong>
          <span>{metadataCsv ? "CSV loaded — select to replace" : 'Must contain a "filename" column'}</span>
          <input type="file" accept=".csv,text/csv" hidden onChange={handleUploadMetadataCsv} />
        </label>
        <label className="dropzone compact">
          <UploadCloud className="dropzone-icon" />
          <strong>Upload / Replace gold answers JSON</strong>
          <span>{goldManifest ? "JSON loaded — select to replace" : "Declare items used for quality scoring"}</span>
          <input type="file" accept=".json,application/json" hidden onChange={handleUploadGoldJson} />
        </label>
      </div>

      {feedback && (
        <div style={{ padding: "10px 14px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "6px", marginBottom: "16px", color: "#10b981", fontSize: "0.875rem" }}>
          {feedback}
        </div>
      )}

      <div className="dataset-summary" style={{ marginBottom: "16px" }}>
        <div><strong>{datasetRows.length}</strong><span>samples</span></div>
        <div><strong>{metadataFields.length}</strong><span>metadata fields</span></div>
        <div><strong>{goldCount}</strong><span>gold answers</span></div>
      </div>

      {datasetRows.length === 0 ? (
        <div className="empty-builder">
          {status === "draft_media_processing" ? (
            <>
              <Loader2 size={28} className="spin-animate text-blue-600" style={{ margin: "0 auto 8px" }} />
              <strong>Media archive is processing in the background</strong>
              <span>Upload a metadata CSV above to preview declared items immediately, or wait for extraction to finish.</span>
            </>
          ) : (
            <strong>No data units registered yet.</strong>
          )}
        </div>
      ) : (
        <div className="dataset-table-wrap">
          <table className="dataset-table">
            <thead>
              <tr>
                <th style={{ minWidth: "220px" }}>Sample</th>
                {metadataFields.map(field => <th key={field.key}>{field.label}</th>)}
                <th>Gold answer</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {datasetRows.map(row => (
                <tr key={row.filename} className={row.errors.length ? "invalid" : ""}>
                  <td style={{ minWidth: "220px", verticalAlign: "top" }}>
                    <strong style={{ display: "block", marginBottom: "6px", wordBreak: "break-all" }}>{row.filename}</strong>
                    <div className="sample-row-preview">
                      {status === "draft_media_processing" && !mediaUrls[row.filename] ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--text-muted)", fontSize: "0.85rem", background: "var(--surface-hover)", padding: "4px 8px", borderRadius: "4px" }}>
                          <Loader2 size={13} className="spin-animate" /> Media extracting...
                        </div>
                      ) : mediaPlugin && mediaUrls[row.filename] ? (
                        row.goldAnswer ? (
                          <AnnotationOverlaySelector modality={modality} schema={labelSchema} mediaUrl={mediaUrls[row.filename]} title={row.filename} options={buildOverlayOptions(row.goldAnswer as AnnotationAnswer, [])} />
                        ) : (
                          <mediaPlugin.PreviewRenderer mediaUrl={mediaUrls[row.filename]} title={row.filename} />
                        )
                      ) : (
                        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{status === "draft_media_processing" ? "Pending extraction" : "Media ready"}</span>
                      )}
                    </div>
                  </td>
                  {metadataFields.map(field => (
                    <td key={field.key}>
                      <span style={{ fontSize: "0.875rem" }}>{String(row.metadata[field.key] ?? "—")}</span>
                    </td>
                  ))}
                  <td>
                    <span style={{ fontSize: "0.85rem", color: row.goldAnswer ? "var(--text-main)" : "var(--text-muted)" }}>
                      {row.goldAnswer ? JSON.stringify(row.goldAnswer) : "None"}
                    </span>
                  </td>
                  <td>
                    {row.errors.length ? (
                      <span className="status-error" title={row.errors.join("; ")}>Needs attention</span>
                    ) : (
                      <span className="status-ready">Ready</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// 4. Qualifications & Routing Section
// --------------------------------------------------------------------------
export function ExperimentQualificationsSection({
  experimentId,
  initialQuestions,
  initialRules,
  metadataFields,
  onSaved,
}: {
  experimentId: string;
  initialQuestions: QualificationQuestion[];
  initialRules: RoutingRule[];
  metadataFields: MetadataFieldDefinition[];
  onSaved?: () => void;
}) {
  const [questions, setQuestions] = useState<QualificationQuestion[]>(initialQuestions || []);
  const [rules, setRules] = useState<RoutingRule[]>(initialRules || []);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setQuestions(initialQuestions || []);
    setRules(initialRules || []);
  }, [initialQuestions, initialRules]);

  const addQuestion = () => {
    setQuestions(current => [
      ...current,
      {
        key: `q_${Date.now()}`,
        label: "",
        type: "single_choice",
        options: ["Option 1", "Option 2"],
        required: true,
      },
    ]);
  };

  const updateQuestion = (index: number, patch: Partial<QualificationQuestion>) => {
    setQuestions(current => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addRule = () => {
    const field = metadataFields[0];
    const compatibleQuestion = questions.find(q => routingOperatorFor(field, q));
    if (!field || !compatibleQuestion) return;
    const operator = routingOperatorFor(field, compatibleQuestion);
    if (!operator) return;
    setRules(current => [...current, { metadata_field: field.key, question_key: compatibleQuestion.key, operator }]);
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/experiments/${experimentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qualification_form: questions,
          routing_rules: rules,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to save qualifications");
      }
      setFeedback("Qualifications and routing rules saved successfully.");
      onSaved?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "24px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3>Annotator Qualifications &amp; Routing</h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Screen annotators and restrict sample distribution by language or proficiency.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" className="btn btn-secondary" onClick={addQuestion}>
            <Plus size={16} /> Add question
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin-animate" /> : <Check size={16} />} Save Qualifications
          </button>
        </div>
      </div>

      {feedback && (
        <div style={{ padding: "10px 14px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "6px", marginBottom: "16px", color: "#10b981", fontSize: "0.875rem" }}>
          {feedback}
        </div>
      )}

      {questions.length === 0 ? (
        <div className="empty-builder" style={{ margin: "16px 0" }}>
          <strong>No qualification questions yet.</strong>
          <span>All annotators will be eligible for all samples unless questions and rules are added.</span>
        </div>
      ) : (
        questions.map((question, index) => (
          <div className="builder-card qualification-card" key={question.key} style={{ marginBottom: "12px" }}>
            <div className="card-heading">
              <strong>Question {index + 1}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label={`Delete question ${index + 1}`}
                onClick={() => {
                  setQuestions(current => current.filter((_, i) => i !== index));
                  setRules(current => current.filter(r => r.question_key !== question.key));
                }}
              >
                <Trash2 size={17} />
              </button>
            </div>
            <div className="qualification-question-grid">
              <div className="form-group">
                <label className="form-label">Question prompt</label>
                <input className="form-input" value={question.label} onChange={e => updateQuestion(index, { label: e.target.value })} placeholder="Which languages can you understand?" />
              </div>
              <div className="form-group">
                <label className="form-label">Response type</label>
                <select className="form-select" value={question.type} onChange={e => {
                  const type = e.target.value as QualificationQuestion["type"];
                  updateQuestion(index, { type, options: type.includes("choice") ? question.options : [] });
                  setRules(current => current.filter(r => r.question_key !== question.key));
                }}>
                  <option value="single_choice">Choose one option</option>
                  <option value="multi_choice">Choose all that apply</option>
                  <option value="boolean">Yes or No</option>
                  <option value="number">Numeric proficiency level</option>
                  <option value="text">Free-text response (not for routing)</option>
                </select>
              </div>
            </div>
            {question.type.includes("choice") && (
              <div className="form-group">
                <label className="form-label">Answer options (comma-separated)</label>
                <input className="form-input" value={question.options.join(", ")} onChange={e => updateQuestion(index, { options: e.target.value.split(",").map(v => v.trim()).filter(Boolean) })} placeholder="Hindi, English, Spanish" />
              </div>
            )}
          </div>
        ))
      )}

      {metadataFields.length > 0 && questions.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4>Matching Rules</h4>
            <button type="button" className="btn btn-secondary" onClick={addRule}>
              <Plus size={15} /> Add matching rule
            </button>
          </div>
          {rules.length === 0 ? (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>No routing rules added yet.</p>
          ) : (
            rules.map((rule, index) => {
              const selectedField = metadataFields.find(f => f.key === rule.metadata_field);
              const selectedQuestion = questions.find(q => q.key === rule.question_key);
              const operatorText = rule.operator === "in" ? "is included in" : rule.operator === "gte" ? "is at or below" : "exactly equals";
              return (
                <div className="routing-card" key={index} style={{ marginBottom: "10px" }}>
                  <div className="card-heading">
                    <strong>Rule {index + 1}</strong>
                    <button type="button" className="icon-button" onClick={() => setRules(current => current.filter((_, i) => i !== index))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="routing-sentence">
                    <span>Serve sample when its</span>
                    <select className="form-select" value={rule.metadata_field} onChange={e => {
                      const field = metadataFields.find(f => f.key === e.target.value);
                      const compQ = questions.find(q => routingOperatorFor(field, q)) ?? selectedQuestion;
                      const op = routingOperatorFor(field, compQ);
                      if (compQ && op) {
                        setRules(current => current.map((r, i) => (i === index ? { ...r, metadata_field: field!.key, question_key: compQ.key, operator: op } : r)));
                      }
                    }}>
                      {metadataFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                    <strong>{operatorText}</strong>
                    <span>the annotator’s answer to</span>
                    <select className="form-select" value={rule.question_key} onChange={e => {
                      const q = questions.find(item => item.key === e.target.value);
                      const compF = metadataFields.find(f => routingOperatorFor(f, q)) ?? selectedField;
                      const op = routingOperatorFor(compF, q);
                      if (compF && q && op) {
                        setRules(current => current.map((r, i) => (i === index ? { ...r, metadata_field: compF.key, question_key: q.key, operator: op } : r)));
                      }
                    }}>
                      {questions.filter(q => routingOperatorFor(selectedField, q)).map(q => <option key={q.key} value={q.key}>{q.label}</option>)}
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// 5. Teaching Examples Section
// --------------------------------------------------------------------------
export function ExperimentTeachingSection({
  experimentId,
  modality: _modality,
  labelSchema: _labelSchema,
  initialExamples,
  onSaved,
}: {
  experimentId: string;
  modality: string;
  labelSchema: LabelSchema;
  initialExamples: any[];
  onSaved?: () => void;
}) {
  const [examples, setExamples] = useState<TeachingExampleDraft[]>([]);
  const [dataUnits, setDataUnits] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const mapped = (initialExamples || []).map((te: any) => ({
      filename: te.filename || "",
      data_unit_id: te.data_unit_id,
      answer: te.displayed_answer || te.answer || {},
      answerText: JSON.stringify(te.displayed_answer || te.answer || {}),
      explanation: te.explanation || "",
      keepAsGold: Boolean(te.keep_as_gold),
    }));
    setExamples(mapped);
  }, [initialExamples]);

  useEffect(() => {
    const fetchUnits = async () => {
      try {
        const res = await apiFetch(`/api/experiments/${experimentId}/data-units`);
        if (res.ok) {
          const data = await res.json();
          setDataUnits(data.data_units || []);
        }
      } catch (err) {
        console.error("Failed to load data units for teaching examples", err);
      }
    };
    fetchUnits();
  }, [experimentId]);

  const addExample = () => {
    if (dataUnits.length === 0) return;
    const firstUnit = dataUnits[0];
    setExamples(current => [
      ...current,
      {
        filename: firstUnit.filename || firstUnit.id,
        data_unit_id: firstUnit.id,
        answer: {} as AnnotationAnswer,
        answerText: "{}",
        explanation: "",
        keepAsGold: false,
      },
    ]);
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const payload = examples.map(ex => ({
        data_unit_id: ex.data_unit_id || dataUnits.find(u => u.filename === ex.filename)?.id,
        displayed_answer: ex.answer,
        explanation: ex.explanation.trim() || undefined,
        keep_as_gold: Boolean(ex.keepAsGold),
      }));

      if (payload.some(item => !item.data_unit_id)) {
        throw new Error("Each teaching example must be mapped to an existing data unit");
      }

      const res = await apiFetch(`/api/experiments/${experimentId}/teaching-examples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teaching_examples: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Failed to save teaching examples");
      }
      setFeedback("Teaching examples successfully saved.");
      onSaved?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "24px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3>Teaching Examples</h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Show annotators onboarding reference samples with correct answers and explanations before real tasks begin.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" className="btn btn-secondary" onClick={addExample} disabled={dataUnits.length === 0}>
            <Plus size={16} /> Add example
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || examples.length === 0}>
            {saving ? <Loader2 size={16} className="spin-animate" /> : <Check size={16} />} Save Examples
          </button>
        </div>
      </div>

      {feedback && (
        <div style={{ padding: "10px 14px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "6px", marginBottom: "16px", color: "#10b981", fontSize: "0.875rem" }}>
          {feedback}
        </div>
      )}

      {examples.length === 0 ? (
        <div className="empty-builder" style={{ margin: "16px 0" }}>
          <strong>No teaching examples configured yet.</strong>
          <span>Add 2–3 reference examples to onboard new annotators effectively.</span>
        </div>
      ) : (
        examples.map((item, index) => (
          <div className="builder-card" key={index} style={{ marginBottom: "16px", padding: "16px" }}>
            <div className="card-heading">
              <strong>Teaching Example {index + 1}</strong>
              <button
                type="button"
                className="icon-button"
                onClick={() => setExamples(current => current.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="form-group" style={{ marginBottom: "12px" }}>
              <label className="form-label">Select Sample</label>
              <select
                className="form-select"
                value={item.data_unit_id}
                onChange={e => {
                  const unit = dataUnits.find(u => u.id === e.target.value);
                  setExamples(current => current.map((ex, i) => i === index ? { ...ex, data_unit_id: e.target.value, filename: unit?.filename || ex.filename } : ex));
                }}
              >
                {dataUnits.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.filename || u.raw_uri?.rsplit?.("/", 1)?.[1] || u.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: "12px" }}>
              <label className="form-label">Displayed Answer (JSON)</label>
              <textarea
                className="form-input"
                rows={2}
                value={item.answerText}
                onChange={e => {
                  const val = e.target.value;
                  let parsed = item.answer;
                  try {
                    parsed = JSON.parse(val);
                  } catch {}
                  setExamples(current => current.map((ex, i) => i === index ? { ...ex, answerText: val, answer: parsed } : ex));
                }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: "12px" }}>
              <label className="form-label">Explanation shown to annotator</label>
              <input
                className="form-input"
                value={item.explanation}
                onChange={e => {
                  const val = e.target.value;
                  setExamples(current => current.map((ex, i) => i === index ? { ...ex, explanation: val } : ex));
                }}
                placeholder="Explain why this annotation is correct..."
              />
            </div>
            <label className="required-toggle">
              <input
                type="checkbox"
                checked={item.keepAsGold}
                onChange={e => {
                  const checked = e.target.checked;
                  setExamples(current => current.map((ex, i) => i === index ? { ...ex, keepAsGold: checked } : ex));
                }}
              />
              Also keep this item in the scored gold queue
            </label>
          </div>
        ))
      )}
    </div>
  );
}
