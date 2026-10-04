import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Info,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { apiFetch } from "../api";
import { getMediaPlugin } from "../plugins/media/registry";
import AnnotationOverlaySelector, { buildOverlayOptions } from "./AnnotationOverlaySelector";
import type { AnnotationAnswer, LabelSchema } from "./annotator/types";
import { parseCsv, validateGold, type MetadataFieldDefinition, type ParsedDatasetRow } from "./datasetBundle";

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
  if ((field.type === "number" || field.type === "text") && question.type === "number") return "gte";
  if ((field.type === "boolean" || field.type === "text") && question.type === "boolean") return "equals";
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
  isLocked,
  onUpdated,
}: {
  experimentId: string;
  modality: string;
  labelSchema: LabelSchema;
  status: string;
  isLocked?: boolean;
  onUpdated?: () => void;
}) {
  const [metadataCsv, setMetadataCsv] = useState("");
  const [goldManifest, setGoldManifest] = useState("");
  const [datasetRows, setDatasetRows] = useState<ParsedDatasetRow[]>([]);
  const [metadataFields, setMetadataFields] = useState<MetadataFieldDefinition[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const locked = Boolean(isLocked || status === "active");

  const mediaPlugin = getMediaPlugin(modality);

  const loadData = useCallback(async () => {
    try {
      // 1. Fetch experiment details for pending_metadata, pending_gold_manifest, metadata_schema
      const expRes = await apiFetch(`/api/experiments/${experimentId}`);
      let exp: any = null;
      if (expRes.ok) {
        exp = await expRes.json();
      }

      // 2. Fetch registered data units
      const unitsRes = await apiFetch(`/api/experiments/${experimentId}/data-units`);
      let units: any[] = [];
      if (unitsRes.ok) {
        const unitsData = await unitsRes.json();
        units = Array.isArray(unitsData) ? unitsData : (unitsData.data_units || []);
      }

      const urls: Record<string, string> = {};
      for (const u of units) {
        const fn = u.filename || u.raw_uri?.split("/").pop() || u.id;
        const url = u.media_url || (u.raw_uri?.startsWith("http") ? u.raw_uri : "");
        if (url) urls[fn] = url;
      }
      setMediaUrls(urls);

      // Collect base schema fields
      const schemaFields: MetadataFieldDefinition[] = (exp?.metadata_schema || []).map((f: any) => ({
        key: f.key,
        label: f.label || f.key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        type: f.type || "text",
        options: f.options || [],
      }));
      const schemaKeys = new Set(schemaFields.map(f => f.key));

      if (units.length > 0) {
        const extraKeys = new Set<string>();
        for (const u of units) {
          if (u.metadata && typeof u.metadata === "object") {
            Object.keys(u.metadata).forEach(k => {
              if (!schemaKeys.has(k)) extraKeys.add(k);
            });
          }
        }
        const extraFields: MetadataFieldDefinition[] = Array.from(extraKeys).map(k => ({
          key: k,
          label: k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          type: "text",
          options: [],
        }));
        setMetadataFields([...schemaFields, ...extraFields]);

        const rows: ParsedDatasetRow[] = units.map(u => {
          const fn = u.filename || u.raw_uri?.split("/").pop() || u.id;
          const gold = u.gold_answer || null;
          const rowErrors: string[] = [];
          if (gold) {
            rowErrors.push(...validateGold(gold, { schema: labelSchema }));
          }
          return {
            filename: fn,
            metadata: (u.metadata && typeof u.metadata === "object") ? u.metadata : {},
            goldAnswer: gold,
            errors: rowErrors,
          };
        });
        setDatasetRows(rows);
      } else {
        // Fallback when data units are extracting or not yet created: show declared pending records
        const pendingMeta: Array<{ filename: string; attributes: Record<string, any> }> = exp?.pending_metadata || [];
        const pendingGold: Array<{ filename: string; answer: any }> = exp?.pending_gold_manifest || [];

        const metaByFn = new Map<string, Record<string, any>>();
        const goldByFn = new Map<string, any>();
        const filenamesSet = new Set<string>();

        for (const m of pendingMeta) {
          if (m.filename) {
            filenamesSet.add(m.filename);
            metaByFn.set(m.filename, m.attributes || {});
          }
        }
        for (const g of pendingGold) {
          if (g.filename) {
            filenamesSet.add(g.filename);
            goldByFn.set(g.filename, g.answer || null);
          }
        }

        const extraKeys = new Set<string>();
        metaByFn.forEach(attrs => {
          Object.keys(attrs).forEach(k => {
            if (!schemaKeys.has(k)) extraKeys.add(k);
          });
        });
        const extraFields: MetadataFieldDefinition[] = Array.from(extraKeys).map(k => ({
          key: k,
          label: k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          type: "text",
          options: [],
        }));
        setMetadataFields([...schemaFields, ...extraFields]);

        const rows: ParsedDatasetRow[] = Array.from(filenamesSet).map(fn => {
          const gold = goldByFn.get(fn) || null;
          const rowErrors: string[] = [];
          if (gold) {
            rowErrors.push(...validateGold(gold, { schema: labelSchema }));
          }
          return {
            filename: fn,
            metadata: metaByFn.get(fn) || {},
            goldAnswer: gold,
            errors: rowErrors,
          };
        });
        setDatasetRows(rows);
      }
    } catch (e) {
      console.error("Failed to load dataset rows", e);
    }
  }, [experimentId, labelSchema]);

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
          await loadData();
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
          await loadData();
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

      {locked ? (
        <div className="settings-lock-notice" style={{ marginBottom: "20px" }}>
          <LockKeyhole size={18} />
          <p>
            <strong>Dataset is locked:</strong> This experiment is currently active. Media files, metadata attributes, and gold answers cannot be modified while annotations are underway.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
          <label className="dropzone compact">
            <UploadCloud className="dropzone-icon" />
            <strong>Upload / Replace metadata CSV</strong>
            <span>{metadataCsv ? "CSV loaded — select to replace" : metadataFields.length > 0 ? `${metadataFields.length} field(s) defined — select to replace` : 'Must contain a "filename" column'}</span>
            <input type="file" accept=".csv,text/csv" hidden onChange={handleUploadMetadataCsv} />
          </label>
          <label className="dropzone compact">
            <UploadCloud className="dropzone-icon" />
            <strong>Upload / Replace gold answers JSON</strong>
            <span>{goldManifest ? "JSON loaded — select to replace" : goldCount > 0 ? `${goldCount} gold answer(s) configured — select to replace` : "Declare items used for quality scoring"}</span>
            <input type="file" accept=".json,application/json" hidden onChange={handleUploadGoldJson} />
          </label>
        </div>
      )}

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

function QuestionOptionsInput({
  options,
  disabled,
  onChange,
}: {
  options: string[];
  disabled?: boolean;
  onChange: (options: string[]) => void;
}) {
  const [rawText, setRawText] = useState(() => options.join(", "));
  const lastEmittedKey = useRef(options.join(":::"));

  useEffect(() => {
    const currentKey = options.join(":::");
    if (currentKey !== lastEmittedKey.current) {
      lastEmittedKey.current = currentKey;
      setRawText(options.join(", "));
    }
  }, [options]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRawText(val);
    const parsed = val
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
    lastEmittedKey.current = parsed.join(":::");
    onChange(parsed);
  };

  const handleBlur = () => {
    const parsed = rawText
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
    lastEmittedKey.current = parsed.join(":::");
    onChange(parsed);
    setRawText(parsed.join(", "));
  };

  return (
    <input
      className="form-input"
      disabled={disabled}
      value={rawText}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder="Hindi, English, Spanish"
    />
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
  isLocked,
  onSaved,
}: {
  experimentId: string;
  initialQuestions: QualificationQuestion[];
  initialRules: RoutingRule[];
  metadataFields: MetadataFieldDefinition[];
  isLocked?: boolean;
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
    if (isLocked) return;
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
    if (isLocked) return;
    setQuestions(current => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addRule = () => {
    if (isLocked) return;
    let selectedField: MetadataFieldDefinition | undefined;
    let selectedQuestion: QualificationQuestion | undefined;
    let selectedOperator: RoutingRule["operator"] | null = null;

    for (const f of metadataFields) {
      for (const q of questions) {
        const op = routingOperatorFor(f, q);
        if (op) {
          selectedField = f;
          selectedQuestion = q;
          selectedOperator = op;
          break;
        }
      }
      if (selectedField) break;
    }

    if (!selectedField || !selectedQuestion || !selectedOperator) {
      setFeedback("No compatible metadata field found in your dataset to match with your qualification questions.");
      return;
    }

    setRules(current => [
      ...current,
      {
        metadata_field: selectedField!.key,
        question_key: selectedQuestion!.key,
        operator: selectedOperator!,
      },
    ]);
  };

  const handleSave = async () => {
    if (isLocked) return;
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
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            Annotator Qualifications &amp; Routing
            {isLocked && <span className="locked-chip"><LockKeyhole size={13} /> Locked</span>}
          </h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Screen annotators and restrict sample distribution by language or proficiency.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {!isLocked && (
            <button type="button" className="btn btn-secondary" onClick={addQuestion}>
              <Plus size={16} /> Add question
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || isLocked}>
            {isLocked ? (
              <>
                <LockKeyhole size={15} /> Locked
              </>
            ) : saving ? (
              <Loader2 size={16} className="spin-animate" />
            ) : (
              <Check size={16} />
            )}
            {isLocked ? "" : " Save Qualifications"}
          </button>
        </div>
      </div>

      {isLocked && (
        <div className="settings-lock-notice" style={{ marginBottom: "16px" }}>
          <LockKeyhole size={18} />
          <p>
            <strong>Qualifications are locked:</strong> This experiment is active. Qualification questions and routing rules cannot be edited to preserve consistent eligibility.
          </p>
        </div>
      )}

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
              {!isLocked && (
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
              )}
            </div>
            <div className="qualification-question-grid">
              <div className="form-group">
                <label className="form-label">Question prompt</label>
                <input className="form-input" disabled={isLocked} value={question.label} onChange={e => updateQuestion(index, { label: e.target.value })} placeholder="Which languages can you understand?" />
              </div>
              <div className="form-group">
                <label className="form-label">Response type</label>
                <select className="form-select" disabled={isLocked} value={question.type} onChange={e => {
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
                <QuestionOptionsInput
                  disabled={isLocked}
                  options={question.options}
                  onChange={opts => updateQuestion(index, { options: opts })}
                />
              </div>
            )}
          </div>
        ))
      )}

      {questions.length > 0 && (
        <div style={{ marginTop: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4>Matching Rules</h4>
            {!isLocked && metadataFields.length > 0 && (
              <button type="button" className="btn btn-secondary" onClick={addRule}>
                <Plus size={15} /> Add matching rule
              </button>
            )}
          </div>
          {metadataFields.length === 0 ? (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              To route samples based on qualifications, upload a metadata CSV in the <strong>Dataset &amp; Gold</strong> tab with sample attributes (such as language, dialect, or required proficiency level).
            </p>
          ) : rules.length === 0 ? (
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
                    {!isLocked && (
                      <button type="button" className="icon-button" onClick={() => setRules(current => current.filter((_, i) => i !== index))}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <div className="routing-sentence">
                    <span>Serve sample when its</span>
                    <select className="form-select" disabled={isLocked} value={rule.metadata_field} onChange={e => {
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
                    <select className="form-select" disabled={isLocked} value={rule.question_key} onChange={e => {
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
  isLocked,
  onSaved,
}: {
  experimentId: string;
  modality: string;
  labelSchema: LabelSchema;
  initialExamples: any[];
  isLocked?: boolean;
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
          setDataUnits(Array.isArray(data) ? data : (data.data_units || []));
        }
      } catch (err) {
        console.error("Failed to load data units for teaching examples", err);
      }
    };
    fetchUnits();
  }, [experimentId]);

  const goldUnits = dataUnits.filter(u => Boolean(u.is_gold) || Boolean(u.gold_answer && Object.keys(u.gold_answer).length > 0));
  const otherUnits = dataUnits.filter(u => !u.is_gold && (!u.gold_answer || Object.keys(u.gold_answer).length === 0));

  const addExample = () => {
    if (isLocked || dataUnits.length === 0) return;
    const usedIds = new Set(examples.map(ex => ex.data_unit_id));
    const targetUnit = goldUnits.find(u => !usedIds.has(u.id)) ||
      dataUnits.find(u => !usedIds.has(u.id)) ||
      goldUnits[0] ||
      dataUnits[0];

    const hasGoldAnswer = targetUnit?.gold_answer && Object.keys(targetUnit.gold_answer).length > 0;
    setExamples(current => [
      ...current,
      {
        filename: targetUnit.filename || targetUnit.id,
        data_unit_id: targetUnit.id,
        answer: hasGoldAnswer ? targetUnit.gold_answer : ({} as AnnotationAnswer),
        answerText: hasGoldAnswer ? JSON.stringify(targetUnit.gold_answer, null, 2) : "{}",
        explanation: "",
        keepAsGold: Boolean(targetUnit.is_gold),
      },
    ]);
  };

  const handleSave = async () => {
    if (isLocked) return;
    setSaving(true);
    setFeedback(null);
    try {
      for (let i = 0; i < examples.length; i++) {
        const ex = examples[i];
        const unit = dataUnits.find(u => u.id === ex.data_unit_id) || dataUnits.find(u => u.filename === ex.filename);
        const name = unit?.filename || ex.filename || `Sample ${i + 1}`;
        if (!ex.answer || Object.keys(ex.answer).length === 0) {
          throw new Error(`Teaching Example ${i + 1} ('${name}') has an empty answer. Please provide a valid answer or select a gold sample.`);
        }
      }

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
        const msg = typeof body.detail === "string"
          ? body.detail
          : Array.isArray(body?.detail)
          ? body.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ")
          : "Failed to save teaching examples";
        throw new Error(msg);
      }
      setFeedback("Teaching examples successfully saved.");
      onSaved?.();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Error saving");
    } finally {
      setSaving(false);
    }
  };

  const formatSampleName = (u: any) => {
    return u.filename || u.raw_uri?.split("/").pop() || (u.id ? `Sample ${u.id.slice(0, 8)}` : "Sample");
  };

  return (
    <div className="glass-panel" style={{ padding: "24px", marginBottom: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h3 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            Teaching Examples
            {isLocked && <span className="locked-chip"><LockKeyhole size={13} /> Locked</span>}
          </h3>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
            Show annotators onboarding reference samples with correct answers and explanations before real tasks begin.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          {!isLocked && (
            <button type="button" className="btn btn-secondary" onClick={addExample} disabled={dataUnits.length === 0}>
              <Plus size={16} /> Add example
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || examples.length === 0 || isLocked}>
            {isLocked ? (
              <>
                <LockKeyhole size={15} /> Locked
              </>
            ) : saving ? (
              <Loader2 size={16} className="spin-animate" />
            ) : (
              <Check size={16} />
            )}
            {isLocked ? "" : " Save Examples"}
          </button>
        </div>
      </div>

      {isLocked && (
        <div className="settings-lock-notice" style={{ marginBottom: "16px" }}>
          <LockKeyhole size={18} />
          <p>
            <strong>Teaching examples are locked:</strong> This experiment is active. Onboarding examples and answers cannot be modified while annotators are active.
          </p>
        </div>
      )}

      {feedback && (
        <div style={{ padding: "10px 14px", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.2)", borderRadius: "6px", marginBottom: "16px", color: "#10b981", fontSize: "0.875rem" }}>
          {feedback}
        </div>
      )}

      {goldUnits.length > 0 ? (
        <div style={{ padding: "10px 14px", background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)", borderRadius: "6px", marginBottom: "16px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          ⭐ <strong>{goldUnits.length} gold quality-check sample(s) available.</strong> When you select a gold sample from the dropdown, its verified answer is automatically pre-filled.
        </div>
      ) : (
        <div style={{ padding: "10px 14px", background: "rgba(100, 116, 139, 0.08)", border: "1px solid rgba(100, 116, 139, 0.2)", borderRadius: "6px", marginBottom: "16px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          ℹ️ <strong>No gold quality-check answers registered yet:</strong> You can define custom answers below, or upload a gold JSON in the <strong>Dataset &amp; Gold Answers</strong> tab to automatically recognize verified gold samples.
        </div>
      )}

      {examples.length === 0 ? (
        <div className="empty-builder" style={{ margin: "16px 0" }}>
          <strong>No teaching examples configured yet.</strong>
          <span>Add 2–3 reference examples to onboard new annotators effectively.</span>
        </div>
      ) : (
        examples.map((item, index) => {
          const selectedUnit = dataUnits.find(u => u.id === item.data_unit_id);
          const isSelectedGold = Boolean(selectedUnit?.is_gold) || Boolean(selectedUnit?.gold_answer && Object.keys(selectedUnit.gold_answer).length > 0);
          return (
            <div className="builder-card" key={index} style={{ marginBottom: "16px", padding: "16px" }}>
              <div className="card-heading">
                <strong>Teaching Example {index + 1}</strong>
                {!isLocked && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setExamples(current => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="form-group" style={{ marginBottom: "12px" }}>
                <label className="form-label" style={{ display: "flex", alignItems: "center" }}>
                  Select Sample
                  {isSelectedGold && (
                    <span style={{ marginLeft: "8px", fontSize: "0.75rem", padding: "2px 7px", borderRadius: "10px", background: "rgba(245, 158, 11, 0.15)", color: "#d97706", fontWeight: 600 }}>
                      ⭐ Gold Quality Check
                    </span>
                  )}
                </label>
                <select
                  className="form-select"
                  disabled={isLocked}
                  value={item.data_unit_id}
                  onChange={e => {
                    const unit = dataUnits.find(u => u.id === e.target.value);
                    const hasGoldAnswer = unit?.gold_answer && Object.keys(unit.gold_answer).length > 0;
                    setExamples(current => current.map((ex, i) => {
                      if (i !== index) return ex;
                      return {
                        ...ex,
                        data_unit_id: e.target.value,
                        filename: unit?.filename || ex.filename,
                        answer: hasGoldAnswer ? unit.gold_answer : ex.answer,
                        answerText: hasGoldAnswer ? JSON.stringify(unit.gold_answer, null, 2) : ex.answerText,
                        keepAsGold: unit?.is_gold ?? ex.keepAsGold,
                      };
                    }));
                  }}
                >
                  {goldUnits.length > 0 && (
                    <optgroup label={`⭐ Gold Quality-Check Samples (${goldUnits.length})`}>
                      {goldUnits.map(u => (
                        <option key={u.id} value={u.id}>
                          ⭐ {formatSampleName(u)} (Gold answer available)
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label={goldUnits.length > 0 ? `Other Uploaded Samples (${otherUnits.length})` : "All Uploaded Samples"}>
                    {otherUnits.map(u => (
                      <option key={u.id} value={u.id}>
                        {formatSampleName(u)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            <div className="form-group" style={{ marginBottom: "12px" }}>
              <label className="form-label">Displayed Answer (JSON)</label>
              <textarea
                className="form-input"
                rows={2}
                disabled={isLocked}
                readOnly={isLocked}
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
                disabled={isLocked}
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
                disabled={isLocked}
                checked={item.keepAsGold}
                onChange={e => {
                  const checked = e.target.checked;
                  setExamples(current => current.map((ex, i) => i === index ? { ...ex, keepAsGold: checked } : ex));
                }}
              />
              Also keep this item in the scored gold queue
            </label>
          </div>
        );
      })
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// 6. Quality & Workload Section
// --------------------------------------------------------------------------
const accessModes: Array<{ value: "sign_in_required" | "guest_name" | "anonymous"; title: string; description: string }> = [
  { value: "sign_in_required", title: "Sign-in required", description: "Every annotator must use a verified Clerk account." },
  { value: "guest_name", title: "Name required", description: "Anyone with the link can join after entering a display name." },
  { value: "anonymous", title: "Fully anonymous", description: "Anyone with the link can join without giving a name." },
];

export function ExperimentQualitySection({
  experimentId,
  initialOverlapN,
  initialGoldRatio,
  initialAccessMode,
  configurationLocked,
  experimentSummary,
  onSaved,
}: {
  experimentId: string;
  initialOverlapN: number;
  initialGoldRatio: number;
  initialAccessMode: "sign_in_required" | "guest_name" | "anonymous";
  configurationLocked: boolean;
  experimentSummary?: {
    name?: string;
    modality?: string;
    annotationType?: string;
    sampleCount?: number;
    goldCount?: number;
    teachingCount?: number;
    metadataFieldsCount?: number;
    questionCount?: number;
    ruleCount?: number;
  };
  onSaved?: () => void;
}) {
  const [overlapN, setOverlapN] = useState<number>(initialOverlapN);
  const [goldRatio, setGoldRatio] = useState<number>(initialGoldRatio);
  const [accessMode, setAccessMode] = useState<"sign_in_required" | "guest_name" | "anonymous">(initialAccessMode);
  const [units, setUnits] = useState<Array<{ id: string; is_gold: boolean }>>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setOverlapN(initialOverlapN);
    setGoldRatio(initialGoldRatio);
    setAccessMode(initialAccessMode);
  }, [initialOverlapN, initialGoldRatio, initialAccessMode]);

  useEffect(() => {
    let cancelled = false;
    const fetchUnits = async () => {
      try {
        const res = await apiFetch(`/api/experiments/${experimentId}/data-units`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : (data?.data_units || []);
          setUnits(list);
        }
      } catch (e) {
        console.error("Could not fetch data units for quality view", e);
      } finally {
        if (!cancelled) setLoadingUnits(false);
      }
    };
    fetchUnits();
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  const unitList = Array.isArray(units) ? units : [];
  const totalCount = unitList.length || (experimentSummary?.sampleCount ?? 0);
  const goldCount = unitList.filter(u => u.is_gold).length || (experimentSummary?.goldCount ?? 0);
  const regularCount = Math.max(0, totalCount - goldCount);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch(`/api/experiments/${experimentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overlap_n: overlapN,
          gold_ratio: goldRatio,
          access_mode: accessMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Could not save quality settings");
      }
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save quality settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: "24px" }}>
      <div className="section-heading-inline" style={{ marginBottom: "20px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.25rem", display: "flex", alignItems: "center", gap: "8px" }}>
            <ShieldCheck size={20} className="app-logo-icon" /> Quality &amp; Workload Settings
          </h3>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Configure annotator overlap, quality-check frequency, and reviewer access mode.
          </p>
        </div>
        {configurationLocked && (
          <span className="locked-chip">
            <LockKeyhole size={14} /> Locked
          </span>
        )}
      </div>

      {configurationLocked && (
        <div className="settings-lock-notice" style={{ marginBottom: "20px" }}>
          <LockKeyhole size={18} />
          <p>
            Access and quality settings are locked because annotations have been submitted. This protects assignment history and score consistency.
          </p>
        </div>
      )}

      {/* Quality Grid */}
      <div className="quality-grid" style={{ marginBottom: "20px" }}>
        <div className="form-group">
          <label className="form-label">People per regular sample</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="100"
            disabled={configurationLocked}
            value={overlapN}
            onChange={event => {
              const val = event.target.valueAsNumber;
              if (Number.isFinite(val) && val >= 1) setOverlapN(val);
            }}
          />
          <span className="help-text">Number of independent annotators assigned to each regular sample.</span>
        </div>
        <div className="form-group">
          <label className="form-label">Quality-check frequency</label>
          <select
            className="form-select"
            disabled={configurationLocked}
            value={goldRatio}
            onChange={event => setGoldRatio(Number(event.target.value))}
          >
            <option value="0">None</option>
            <option value="0.05">Light — 5%</option>
            <option value="0.1">Recommended — 10%</option>
            <option value="0.2">Strict — 20%</option>
          </select>
          <span className="help-text">Percentage of items served that are known gold evaluation samples.</span>
        </div>
      </div>

      {/* Workload Card */}
      <div className="workload-card" style={{ marginBottom: "24px" }}>
        <strong>Estimated regular assignments</strong>
        <span>
          {regularCount} regular samples × {overlapN} people
        </span>
        <h2>{regularCount * overlapN}</h2>
      </div>

      {/* Gold ratio warning if gold_ratio > 0 but 0 gold items exist */}
      {goldRatio > 0 && goldCount === 0 && !loadingUnits && (
        <p className="form-error" style={{ marginBottom: "20px" }}>
          Add at least one gold answer in the Dataset &amp; Gold tab or set quality-check frequency to “None”.
        </p>
      )}

      {/* Annotator Access Mode */}
      <div style={{ marginBottom: "24px" }}>
        <label className="form-label" style={{ marginBottom: "8px" }}>Annotator access mode</label>
        <div className="access-mode-grid">
          {accessModes.map(mode => (
            <button
              type="button"
              key={mode.value}
              disabled={configurationLocked}
              className={`access-mode-card ${accessMode === mode.value ? "selected" : ""}`}
              onClick={() => setAccessMode(mode.value)}
            >
              <strong>{mode.title}</strong>
              <span>{mode.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary Review Grid */}
      {experimentSummary && (
        <div style={{ marginBottom: "24px" }}>
          <h4 style={{ margin: "0 0 10px", fontSize: "0.95rem", color: "var(--text-secondary)" }}>Configuration Overview</h4>
          <div className="review-grid">
            <div><span>Name</span><strong>{experimentSummary.name || "—"}</strong></div>
            <div><span>Task / Modality</span><strong>{experimentSummary.annotationType || experimentSummary.modality || "—"}</strong></div>
            <div><span>Annotator access</span><strong>{accessMode === "sign_in_required" ? "Sign-in required" : accessMode === "guest_name" ? "Name required" : "Fully anonymous"}</strong></div>
            <div><span>Samples</span><strong>{totalCount} ({goldCount} gold)</strong></div>
            <div><span>Teaching examples</span><strong>{experimentSummary.teachingCount ? `${experimentSummary.teachingCount} (observational)` : "None"}</strong></div>
            <div><span>Metadata fields</span><strong>{experimentSummary.metadataFieldsCount ?? 0}</strong></div>
            <div><span>Qualification questions</span><strong>{experimentSummary.questionCount ?? 0}</strong></div>
            <div><span>Routing rules</span><strong>{experimentSummary.ruleCount ?? 0}</strong></div>
          </div>
        </div>
      )}

      {error && <p className="form-error" style={{ marginBottom: "16px" }}>{error}</p>}
      {saved && <p className="form-success" style={{ marginBottom: "16px" }}>Quality &amp; workload settings saved.</p>}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || configurationLocked}
          onClick={handleSave}
        >
          {configurationLocked ? (
            <>
              <LockKeyhole size={15} /> Locked
            </>
          ) : saving ? (
            <>
              <Loader2 size={16} className="spin-animate" /> Saving…
            </>
          ) : (
            <>
              <Save size={16} /> Save Quality Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}
