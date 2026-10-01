import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileArchive,
  Layers,
  RefreshCw,
  Settings2,
  ShieldAlert,
  X,
} from "lucide-react";
import { apiFetch } from "../api";

export interface ExportPolicy {
  min_annotations_for_consensus: number;
  low_evidence_threshold: number;
  min_gold_items: number;
  min_gold_score: number;
  min_agreement: number;
  include_low_evidence: boolean;
  prior_strength: number;
}

export interface PreflightResponse {
  mode: "complete" | "consensus";
  policy: ExportPolicy;
  source_fingerprint: string;
  source_cutoff_at: string;
  counts: {
    total_samples: number;
    annotated_samples: number;
    unannotated_samples: number;
    gold_samples: number;
    consensus_accepted_samples: number;
    accepted_samples: number;
    low_evidence_samples: number;
    insufficient_overlap_samples: number;
    low_agreement_samples: number;
    tied_samples: number;
    no_eligible_annotations_samples: number;
  };
  annotator_summary: {
    total_annotators: number;
    eligible_annotators: number;
    excluded_annotators: number;
    insufficient_gold_annotators: number;
  };
  estimated_size_bytes: number;
  training_ready: boolean;
  warnings: string[];
}

export interface ExportJobItem {
  id: string;
  experiment_id: string;
  mode: "complete" | "consensus";
  status: "queued" | "running" | "ready" | "failed" | "expired";
  policy: Record<string, unknown>;
  source_cutoff_at: string;
  source_fingerprint: string;
  warnings: string[];
  size_bytes: number | null;
  sha256: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

interface ExportDatasetModalProps {
  experimentId: string;
  experimentName: string;
  onClose: () => void;
}

const DEFAULT_POLICY: ExportPolicy = {
  min_annotations_for_consensus: 2,
  low_evidence_threshold: 3,
  min_gold_items: 5,
  min_gold_score: 0.7,
  min_agreement: 0.6,
  include_low_evidence: false,
  prior_strength: 2.0,
};

export function parseIntegerThreshold(value: string, defaultValue: number = 0, min: number = 0): number {
  const val = parseInt(value, 10);
  return Number.isNaN(val) ? defaultValue : Math.max(min, val);
}

export function parseFloatThreshold(value: string, defaultValue: number = 0, min: number = 0, max: number = 1): number {
  const val = parseFloat(value);
  return Number.isNaN(val) ? defaultValue : Math.max(min, Math.min(max, val));
}


export function calculateNeedReviewCount(
  counts: PreflightResponse["counts"],
  includeLowEvidence: boolean
): number {
  return (
    counts.insufficient_overlap_samples +
    counts.low_agreement_samples +
    counts.tied_samples +
    counts.no_eligible_annotations_samples +
    counts.unannotated_samples +
    (!includeLowEvidence ? counts.low_evidence_samples : 0)
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


export default function ExportDatasetModal({
  experimentId,
  experimentName,
  onClose,
}: ExportDatasetModalProps) {
  const [mode, setMode] = useState<"complete" | "consensus">("complete");
  const [policy, setPolicy] = useState<ExportPolicy>(DEFAULT_POLICY);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ExportJobItem | null>(null);
  const [recentJobs, setRecentJobs] = useState<ExportJobItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreflight = useCallback(async () => {
    setPreflightLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/exports/preflight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, policy }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "Failed to load export preflight");
      }
      const data: PreflightResponse = await response.json();
      setPreflight(data);
      // Reset acknowledgement if fingerprint/warnings change
      setAcknowledgeWarnings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading preflight");
    } finally {
      setPreflightLoading(false);
    }
  }, [experimentId, mode, policy]);

  const fetchRecentJobs = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/exports`);
      if (response.ok) {
        const jobs: ExportJobItem[] = await response.json();
        setRecentJobs(jobs);
      }
    } catch {
      // Non-fatal
    }
  }, [experimentId]);

  useEffect(() => {
    fetchPreflight();
    fetchRecentJobs();
  }, [fetchPreflight, fetchRecentJobs]);

  // Poll active job status
  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    const pollInterval = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/api/experiments/${experimentId}/exports/${activeJobId}`);
        if (!res.ok) return;
        const job: ExportJobItem = await res.json();
        if (cancelled) return;
        setActiveJob(job);

        if (job.status === "ready" || job.status === "failed" || job.status === "expired") {
          window.clearInterval(pollInterval);
          fetchRecentJobs();
        }
      } catch {
        // Continue polling
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(pollInterval);
    };
  }, [activeJobId, experimentId, fetchRecentJobs]);

  const handleCreateExport = async () => {
    if (!preflight) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch(`/api/experiments/${experimentId}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          policy,
          source_fingerprint: preflight.source_fingerprint,
          acknowledge_warnings: acknowledgeWarnings,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (res.status === 409) {
          // Stale fingerprint, refresh preflight
          await fetchPreflight();
        }
        throw new Error(err.detail || "Failed to start export job");
      }

      const job: ExportJobItem = await res.json();
      setActiveJobId(job.id);
      setActiveJob(job);
      fetchRecentJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create export");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (jobId: string) => {
    try {
      const res = await apiFetch(`/api/experiments/${experimentId}/exports/${jobId}/download`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Could not generate download URL");
      }
      const data = await res.json();
      const anchor = document.createElement("a");
      anchor.href = data.download_url;
      anchor.download = data.filename;
      anchor.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const hasWarnings = (preflight?.warnings.length ?? 0) > 0;
  const canSubmit =
    !submitting &&
    !preflightLoading &&
    preflight !== null &&
    (mode === "complete" || !hasWarnings || acknowledgeWarnings);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(16, 42, 50, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        className="glass-panel animate-fade-in"
        style={{
          width: "100%",
          maxWidth: "800px",
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
          border: "1px solid var(--border-color)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", marginBottom: "4px" }}>Export Dataset</h2>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>
              Generate an auditable, self-contained snapshot for <strong>{experimentName}</strong>
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: "6px", borderRadius: "50%" }}
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "var(--danger-soft)",
              border: "1px solid var(--danger)",
              borderRadius: "8px",
              color: "var(--danger)",
              fontSize: "0.9rem",
            }}
          >
            {error}
          </div>
        )}

        {/* Active Job Progress View */}
        {activeJob && (
          <div
            style={{
              padding: "20px",
              borderRadius: "12px",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {activeJob.status === "queued" && <Clock size={20} className="text-secondary" />}
                {activeJob.status === "running" && <RefreshCw size={20} className="animate-spin text-primary" />}
                {activeJob.status === "ready" && <CheckCircle2 size={20} style={{ color: "var(--mint-strong)" }} />}
                {activeJob.status === "failed" && <AlertTriangle size={20} style={{ color: "var(--danger)" }} />}
                <h3 style={{ fontSize: "1.15rem", margin: 0 }}>
                  {activeJob.status === "queued" && "Export Queued"}
                  {activeJob.status === "running" && "Generating ZIP Archive..."}
                  {activeJob.status === "ready" && "Export Ready for Download"}
                  {activeJob.status === "failed" && "Export Failed"}
                  {activeJob.status === "expired" && "Export Expired"}
                </h3>
              </div>
              <span
                style={{
                  padding: "4px 8px",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  backgroundColor: activeJob.status === "ready" ? "var(--mint-soft)" : "var(--bg-primary)",
                  color: activeJob.status === "ready" ? "var(--mint-strong)" : "var(--text-secondary)",
                }}
              >
                {activeJob.mode} mode
              </span>
            </div>

            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
              {activeJob.status === "queued" && "Your request is in the generation queue. It will begin packaging shortly."}
              {activeJob.status === "running" && "Packaging media files, computing quality-weighted consensus, and assembling ZIP archive..."}
              {activeJob.status === "ready" && `Archive generated successfully (${formatBytes(activeJob.size_bytes || 0)}). SHA-256: ${activeJob.sha256?.slice(0, 16)}...`}
              {activeJob.status === "failed" && (activeJob.error_message || "An unexpected error occurred during generation.")}
            </p>

            <div style={{ display: "flex", gap: "10px" }}>
              {activeJob.status === "ready" && (
                <button className="btn btn-primary" onClick={() => handleDownload(activeJob.id)}>
                  <Download size={16} /> Download ZIP Archive
                </button>
              )}
              {(activeJob.status === "ready" || activeJob.status === "failed") && (
                <button className="btn btn-secondary" onClick={() => setActiveJob(null)}>
                  New Export
                </button>
              )}
            </div>
          </div>
        )}

        {/* Configuration and Preflight (Hidden when active job is running) */}
        {(!activeJob || activeJob.status === "ready" || activeJob.status === "failed") && (
          <>
            {/* Mode Selection Cards */}
            <div>
              <label style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)", display: "block", marginBottom: "8px" }}>
                Select Export Mode
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                {/* Complete Archive Option */}
                <div
                  onClick={() => setMode("complete")}
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    border: mode === "complete" ? "2px solid var(--accent-strong)" : "1px solid var(--border-color)",
                    backgroundColor: mode === "complete" ? "rgba(48, 175, 255, 0.05)" : "var(--bg-card)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <FileArchive size={18} style={{ color: "var(--accent-strong)" }} />
                      <strong style={{ fontSize: "1rem" }}>Complete Archive</strong>
                    </div>
                    <span style={{ fontSize: "0.75rem", padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--bg-secondary)" }}>
                      Audit & Research
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Original media, sample metadata, gold references, every submitted annotation, annotator quality metrics, and item agreements.
                  </p>
                </div>

                {/* Consensus Dataset Option */}
                <div
                  onClick={() => setMode("consensus")}
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    border: mode === "consensus" ? "2px solid var(--accent-strong)" : "1px solid var(--border-color)",
                    backgroundColor: mode === "consensus" ? "rgba(48, 175, 255, 0.05)" : "var(--bg-card)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Layers size={18} style={{ color: "var(--accent-strong)" }} />
                      <strong style={{ fontSize: "1rem" }}>Consensus Dataset</strong>
                    </div>
                    <span style={{ fontSize: "0.75rem", padding: "2px 6px", borderRadius: "4px", backgroundColor: "var(--mint-soft)", color: "var(--mint-strong)", fontWeight: 600 }}>
                      Training Ready
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    One final quality-weighted answer per accepted sample, with raw evidence, exclusions, and reproducibility contracts.
                  </p>
                </div>
              </div>
            </div>

            {/* Guardrails / Policy Settings (Visible for Consensus mode) */}
            {mode === "consensus" && (
              <div style={{ border: "1px solid var(--border-color)", borderRadius: "10px", padding: "16px", backgroundColor: "var(--bg-secondary)" }}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <Settings2 size={16} />
                    <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>Consensus Guardrails Policy</span>
                  </div>
                  <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: "0.8rem" }}>
                    {showAdvanced ? "Hide settings" : "Configure guardrails"}
                  </button>
                </div>

                {showAdvanced && (
                  <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>
                        Min annotations for consensus
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={policy.min_annotations_for_consensus}
                        onChange={(e) => setPolicy({ ...policy, min_annotations_for_consensus: parseInt(e.target.value) || 2 })}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>
                        Low evidence threshold
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={policy.low_evidence_threshold}
                        onChange={(e) => setPolicy({ ...policy, low_evidence_threshold: parseInt(e.target.value) || 3 })}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>
                        Min gold items before exclusion
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={policy.min_gold_items}
                        onChange={(e) => setPolicy({ ...policy, min_gold_items: parseIntegerThreshold(e.target.value, 5, 0) })}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>
                        Min gold score threshold
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={policy.min_gold_score}
                        onChange={(e) => setPolicy({ ...policy, min_gold_score: parseFloatThreshold(e.target.value, 0.7, 0, 1) })}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.8rem", display: "block", marginBottom: "4px" }}>
                        Min item agreement
                      </label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={policy.min_agreement}
                        onChange={(e) => setPolicy({ ...policy, min_agreement: parseFloatThreshold(e.target.value, 0.6, 0, 1) })}
                        style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-color)" }}
                      />

                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "20px" }}>
                      <input
                        type="checkbox"
                        id="include_low_evidence"
                        checked={policy.include_low_evidence}
                        onChange={(e) => setPolicy({ ...policy, include_low_evidence: e.target.checked })}
                      />
                      <label htmlFor="include_low_evidence" style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                        Include low evidence items in final dataset
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Preflight Statistics */}
            {preflight && (
              <div style={{ border: "1px solid var(--border-color)", borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <strong style={{ fontSize: "0.95rem" }}>Preflight Summary</strong>
                  <span
                    style={{
                      fontSize: "0.8rem",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      backgroundColor: preflight.training_ready ? "var(--mint-soft)" : "var(--gold-soft)",
                      color: preflight.training_ready ? "var(--mint-strong)" : "var(--gold-primary)",
                      fontWeight: 600,
                    }}
                  >
                    {preflight.training_ready ? "Training Ready" : "Warnings Present"}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", textAlign: "center" }}>
                  <div style={{ padding: "8px", backgroundColor: "var(--bg-primary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Total Samples</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{preflight.counts.total_samples}</div>
                  </div>
                  <div style={{ padding: "8px", backgroundColor: "var(--bg-primary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Consensus Ready</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--mint-strong)" }}>
                      {preflight.counts.consensus_accepted_samples}
                    </div>
                  </div>
                  <div style={{ padding: "8px", backgroundColor: "var(--bg-primary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Need Review</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700, color: hasWarnings ? "var(--gold-primary)" : "inherit" }}>
                      {calculateNeedReviewCount(preflight.counts, policy.include_low_evidence)}
                    </div>
                  </div>


                  <div style={{ padding: "8px", backgroundColor: "var(--bg-primary)", borderRadius: "6px" }}>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Est. Archive Size</div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{formatBytes(preflight.estimated_size_bytes)}</div>
                  </div>
                </div>

                {/* Warnings Section */}
                {hasWarnings && (
                  <div
                    style={{
                      marginTop: "16px",
                      padding: "12px",
                      borderRadius: "8px",
                      backgroundColor: "var(--gold-soft)",
                      border: "1px solid var(--gold-primary)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--gold-primary)", marginBottom: "6px" }}>
                      <ShieldAlert size={16} />
                      <strong style={{ fontSize: "0.85rem" }}>Quality Guardrail Warnings</strong>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.85rem", color: "var(--text-primary)" }}>
                      {preflight.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>

                    {mode === "consensus" && (
                      <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <input
                          type="checkbox"
                          id="acknowledge_warnings"
                          checked={acknowledgeWarnings}
                          onChange={(e) => setAcknowledgeWarnings(e.target.checked)}
                        />
                        <label
                          htmlFor="acknowledge_warnings"
                          style={{ fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "var(--text-primary)" }}
                        >
                          I acknowledge these quality warnings and want to proceed with consensus generation.
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateExport}
                disabled={!canSubmit}
                style={{ minWidth: "160px" }}
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Queuing...
                  </>
                ) : (
                  <>
                    <Download size={16} /> Generate {mode === "consensus" ? "Consensus" : "Complete"} ZIP
                  </>
                )}
              </button>
            </div>

            {/* Recent Exports History */}
            {recentJobs.length > 0 && (
              <div style={{ marginTop: "16px", borderTop: "1px solid var(--border-color)", paddingTop: "16px" }}>
                <h4 style={{ fontSize: "0.95rem", marginBottom: "8px" }}>Recent Exports</h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "150px", overflowY: "auto" }}>
                  {recentJobs.map((j) => (
                    <div
                      key={j.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        backgroundColor: "var(--bg-primary)",
                        borderRadius: "6px",
                        fontSize: "0.85rem",
                      }}
                    >
                      <div>
                        <strong>{j.mode}</strong> · {new Date(j.created_at).toLocaleTimeString()}{" "}
                        {j.size_bytes ? `(${formatBytes(j.size_bytes)})` : ""}
                        <span
                          style={{
                            marginLeft: "8px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            backgroundColor: j.status === "ready" ? "var(--mint-soft)" : "var(--bg-secondary)",
                            color: j.status === "ready" ? "var(--mint-strong)" : "inherit",
                          }}
                        >
                          {j.status}
                        </span>
                      </div>
                      {j.status === "ready" && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: "4px 8px", fontSize: "0.8rem" }}
                          onClick={() => handleDownload(j.id)}
                        >
                          <Download size={14} /> Download
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
