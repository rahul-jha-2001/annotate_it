import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileArchive,
  Info,
  Layers,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sliders,
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

export const DEFAULT_POLICY: ExportPolicy = {
  min_annotations_for_consensus: 2,
  low_evidence_threshold: 3,
  min_gold_items: 5,
  min_gold_score: 0.7,
  min_agreement: 0.6,
  include_low_evidence: false,
  prior_strength: 2.0,
};

export interface PolicyValidationErrors {
  min_annotations_for_consensus?: string;
  low_evidence_threshold?: string;
  min_gold_items?: string;
  min_gold_score?: string;
  min_agreement?: string;
  prior_strength?: string;
}

export function validatePolicy(policy: ExportPolicy): PolicyValidationErrors {
  const errors: PolicyValidationErrors = {};
  if (!Number.isInteger(policy.min_annotations_for_consensus) || policy.min_annotations_for_consensus < 1) {
    errors.min_annotations_for_consensus = "Must be an integer ≥ 1";
  }
  if (!Number.isInteger(policy.low_evidence_threshold) || policy.low_evidence_threshold < 1) {
    errors.low_evidence_threshold = "Must be an integer ≥ 1";
  }
  if (!Number.isInteger(policy.min_gold_items) || policy.min_gold_items < 0) {
    errors.min_gold_items = "Must be an integer ≥ 0";
  }
  if (
    typeof policy.min_gold_score !== "number" ||
    Number.isNaN(policy.min_gold_score) ||
    policy.min_gold_score < 0 ||
    policy.min_gold_score > 1
  ) {
    errors.min_gold_score = "Must be between 0.0 and 1.0";
  }
  if (
    typeof policy.min_agreement !== "number" ||
    Number.isNaN(policy.min_agreement) ||
    policy.min_agreement < 0 ||
    policy.min_agreement > 1
  ) {
    errors.min_agreement = "Must be between 0.0 and 1.0";
  }
  if (
    typeof policy.prior_strength !== "number" ||
    Number.isNaN(policy.prior_strength) ||
    policy.prior_strength < 0
  ) {
    errors.prior_strength = "Must be ≥ 0.0";
  }
  return errors;
}

export function parseIntegerThreshold(value: string, defaultValue: number = 0, min?: number): number {
  const val = parseInt(value, 10);
  if (Number.isNaN(val)) return defaultValue;
  return typeof min === "number" ? Math.max(min, val) : val;
}

export function parseFloatThreshold(value: string, defaultValue: number = 0, min?: number, max?: number): number {
  const val = parseFloat(value);
  if (Number.isNaN(val)) return defaultValue;
  let res = val;
  if (typeof min === "number") res = Math.max(min, res);
  if (typeof max === "number") res = Math.min(max, res);
  return res;
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

export function isFieldVeryPermissive(
  field: keyof ExportPolicy,
  value: number | boolean
): boolean {
  if (typeof value !== "number") return false;
  switch (field) {
    case "min_annotations_for_consensus":
      return value === 1;
    case "min_gold_items":
      return value <= 1;
    case "min_gold_score":
      return value <= 0.3;
    case "min_agreement":
      return value <= 0.3;
    case "prior_strength":
      return value === 0;
    default:
      return false;
  }
}

export function PermissiveBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "0.70rem",
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: "4px",
        backgroundColor: "var(--gold-soft)",
        color: "var(--gold-primary)",
        border: "1px solid rgba(255, 179, 0, 0.35)",
        lineHeight: "1.2",
      }}
      title="This threshold is set to an aggressively permissive level"
    >
      <span
        style={{
          width: "5px",
          height: "5px",
          borderRadius: "50%",
          backgroundColor: "var(--gold-primary)",
        }}
      />
      very permissive
    </span>
  );
}

export function HelpTag({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }}
        aria-label="More information"
        title={content}
        style={{
          background: "none",
          border: "none",
          padding: "2px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: isOpen ? "var(--accent-strong)" : "var(--text-secondary)",
          borderRadius: "50%",
          lineHeight: 1,
        }}
      >
        <Info size={13} />
      </button>

      {isOpen && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border-color)",
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.3)",
            borderRadius: "6px",
            padding: "8px 12px",
            width: "max-content",
            maxWidth: "280px",
            fontSize: "0.78rem",
            lineHeight: "1.4",
            color: "var(--text-primary)",
            zIndex: 100,
            whiteSpace: "normal",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

export default function ExportDatasetModal({
  experimentId,
  experimentName,
  onClose,
}: ExportDatasetModalProps) {
  const [mode, setMode] = useState<"complete" | "consensus">("complete");
  const [policy, setPolicy] = useState<ExportPolicy>(DEFAULT_POLICY);
  const [showAdvancedPrior, setShowAdvancedPrior] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ExportJobItem | null>(null);
  const [recentJobs, setRecentJobs] = useState<ExportJobItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policyErrors = validatePolicy(policy);
  const isPolicyValid = Object.keys(policyErrors).length === 0;

  const fetchPreflight = useCallback(
    async (targetPolicy: ExportPolicy = policy) => {
      setPreflightLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/experiments/${experimentId}/exports/preflight`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, policy: targetPolicy }),
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
    },
    [experimentId, mode, policy]
  );

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
    fetchRecentJobs();
  }, [fetchRecentJobs]);

  useEffect(() => {
    if (!isPolicyValid) return;

    if (mode === "complete") {
      fetchPreflight(policy);
      return;
    }

    const timer = window.setTimeout(() => {
      fetchPreflight(policy);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [experimentId, mode, policy, isPolicyValid, fetchPreflight]);

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
    (mode === "complete" || isPolicyValid) &&
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

            {/* Consensus Thresholds & Policy Panel (Visible for Consensus mode) */}
            {mode === "consensus" && (
              <div
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: "10px",
                  padding: "16px",
                  backgroundColor: "var(--bg-secondary)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                {/* Panel Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <Sliders size={18} style={{ color: "var(--accent-strong)" }} />
                      <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
                        Consensus Guardrail Thresholds
                      </h3>
                    </div>
                    <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                      Tune consensus and reliability criteria for this export. Adjusting thresholds recalculates the live preview below without altering raw annotations or previous exports.
                    </p>
                    <p style={{ margin: "6px 0 0 0", fontSize: "0.80rem", color: "var(--text-primary)" }}>
                      <strong>Lower thresholds accept more data with less certainty it's correct. Higher thresholds are stricter and flag more items for manual review.</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPolicy(DEFAULT_POLICY)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 8px",
                      fontSize: "0.75rem",
                      whiteSpace: "nowrap",
                    }}
                    title="Reset all thresholds to system defaults"
                  >
                    <RotateCcw size={12} />
                    Reset to defaults
                  </button>
                </div>

                {/* Primary Thresholds Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px" }}>
                  {/* 1. min_annotations_for_consensus */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <label htmlFor="min_annotations_for_consensus" style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                          Min annotations for consensus
                        </label>
                        <HelpTag content="The minimum number of people who must have labeled an item before the system will attempt to produce a single answer for it. Items with fewer submissions than this are automatically sent to manual review." />
                        {isFieldVeryPermissive("min_annotations_for_consensus", policy.min_annotations_for_consensus) && (
                          <PermissiveBadge />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: 2</span>
                        <button
                          type="button"
                          onClick={() => setPolicy({ ...policy, min_annotations_for_consensus: DEFAULT_POLICY.min_annotations_for_consensus })}
                          disabled={policy.min_annotations_for_consensus === DEFAULT_POLICY.min_annotations_for_consensus}
                          aria-label="Reset min_annotations_for_consensus to default"
                          title="Reset to default (2)"
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px",
                            cursor: policy.min_annotations_for_consensus === DEFAULT_POLICY.min_annotations_for_consensus ? "default" : "pointer",
                            opacity: policy.min_annotations_for_consensus === DEFAULT_POLICY.min_annotations_for_consensus ? 0.3 : 1,
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "4px",
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      id="min_annotations_for_consensus"
                      type="number"
                      min="1"
                      step="1"
                      value={policy.min_annotations_for_consensus}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          min_annotations_for_consensus: parseIntegerThreshold(e.target.value, 2),
                        })
                      }
                      style={{
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: policyErrors.min_annotations_for_consensus ? "1px solid var(--danger)" : "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        fontSize: "0.9rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Floor for attempting consensus at all on an item
                    </span>
                    {policyErrors.min_annotations_for_consensus && (
                      <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{policyErrors.min_annotations_for_consensus}</span>
                    )}
                  </div>

                  {/* 2. low_evidence_threshold */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <label htmlFor="low_evidence_threshold" style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                          Low evidence threshold
                        </label>
                        <HelpTag content="Even if an item is accepted, it's still marked 'low evidence' if fewer than this many people annotated it. Use the 'Include low evidence items' toggle below to decide whether these count as training-ready." />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: 3</span>
                        <button
                          type="button"
                          onClick={() => setPolicy({ ...policy, low_evidence_threshold: DEFAULT_POLICY.low_evidence_threshold })}
                          disabled={policy.low_evidence_threshold === DEFAULT_POLICY.low_evidence_threshold}
                          aria-label="Reset low_evidence_threshold to default"
                          title="Reset to default (3)"
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px",
                            cursor: policy.low_evidence_threshold === DEFAULT_POLICY.low_evidence_threshold ? "default" : "pointer",
                            opacity: policy.low_evidence_threshold === DEFAULT_POLICY.low_evidence_threshold ? 0.3 : 1,
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "4px",
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      id="low_evidence_threshold"
                      type="number"
                      min="1"
                      step="1"
                      value={policy.low_evidence_threshold}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          low_evidence_threshold: parseIntegerThreshold(e.target.value, 3),
                        })
                      }
                      style={{
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: policyErrors.low_evidence_threshold ? "1px solid var(--danger)" : "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        fontSize: "0.9rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Below this count, item is marked low-evidence even if accepted
                    </span>
                    {policyErrors.low_evidence_threshold && (
                      <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{policyErrors.low_evidence_threshold}</span>
                    )}
                  </div>

                  {/* 3. min_gold_items */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <label htmlFor="min_gold_items" style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                          Min gold items before exclusion
                        </label>
                        <HelpTag content="How many gold (known-correct) items an annotator needs to have completed before their accuracy score is trusted. Someone who's only seen one or two gold items might just be lucky or unlucky — this sets how much evidence you need before judging them." />
                        {isFieldVeryPermissive("min_gold_items", policy.min_gold_items) && (
                          <PermissiveBadge />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: 5</span>
                        <button
                          type="button"
                          onClick={() => setPolicy({ ...policy, min_gold_items: DEFAULT_POLICY.min_gold_items })}
                          disabled={policy.min_gold_items === DEFAULT_POLICY.min_gold_items}
                          aria-label="Reset min_gold_items to default"
                          title="Reset to default (5)"
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px",
                            cursor: policy.min_gold_items === DEFAULT_POLICY.min_gold_items ? "default" : "pointer",
                            opacity: policy.min_gold_items === DEFAULT_POLICY.min_gold_items ? 0.3 : 1,
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "4px",
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      id="min_gold_items"
                      type="number"
                      min="0"
                      step="1"
                      value={policy.min_gold_items}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          min_gold_items: parseIntegerThreshold(e.target.value, 5),
                        })
                      }
                      style={{
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: policyErrors.min_gold_items ? "1px solid var(--danger)" : "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        fontSize: "0.9rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Minimum gold exposures before an annotator's reliability weight is trusted
                    </span>
                    {policyErrors.min_gold_items && (
                      <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{policyErrors.min_gold_items}</span>
                    )}
                  </div>

                  {/* 4. min_gold_score */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <label htmlFor="min_gold_score" style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                          Min gold score threshold
                        </label>
                        <HelpTag content="The minimum accuracy (compared to the correct answer) an annotator needs on gold items to stay eligible. Annotators below this score are excluded from consensus, even if they submitted a lot of work." />
                        {isFieldVeryPermissive("min_gold_score", policy.min_gold_score) && (
                          <PermissiveBadge />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: 0.70</span>
                        <button
                          type="button"
                          onClick={() => setPolicy({ ...policy, min_gold_score: DEFAULT_POLICY.min_gold_score })}
                          disabled={policy.min_gold_score === DEFAULT_POLICY.min_gold_score}
                          aria-label="Reset min_gold_score to default"
                          title="Reset to default (0.7)"
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px",
                            cursor: policy.min_gold_score === DEFAULT_POLICY.min_gold_score ? "default" : "pointer",
                            opacity: policy.min_gold_score === DEFAULT_POLICY.min_gold_score ? 0.3 : 1,
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "4px",
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      id="min_gold_score"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={policy.min_gold_score}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          min_gold_score: parseFloatThreshold(e.target.value, 0.7),
                        })
                      }
                      style={{
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: policyErrors.min_gold_score ? "1px solid var(--danger)" : "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        fontSize: "0.9rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Minimum gold accuracy for an annotator to be export-eligible
                    </span>
                    {policyErrors.min_gold_score && (
                      <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{policyErrors.min_gold_score}</span>
                    )}
                  </div>

                  {/* 5. min_agreement */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <label htmlFor="min_agreement" style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                          Min item agreement
                        </label>
                        <HelpTag content="How much independent annotators need to agree with each other before their answer is accepted automatically. Below this, the item is flagged for manual review instead of being resolved automatically." />
                        {isFieldVeryPermissive("min_agreement", policy.min_agreement) && (
                          <PermissiveBadge />
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: 0.60</span>
                        <button
                          type="button"
                          onClick={() => setPolicy({ ...policy, min_agreement: DEFAULT_POLICY.min_agreement })}
                          disabled={policy.min_agreement === DEFAULT_POLICY.min_agreement}
                          aria-label="Reset min_agreement to default"
                          title="Reset to default (0.6)"
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px",
                            cursor: policy.min_agreement === DEFAULT_POLICY.min_agreement ? "default" : "pointer",
                            opacity: policy.min_agreement === DEFAULT_POLICY.min_agreement ? 0.3 : 1,
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "4px",
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      id="min_agreement"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={policy.min_agreement}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          min_agreement: parseFloatThreshold(e.target.value, 0.6),
                        })
                      }
                      style={{
                        padding: "7px 10px",
                        borderRadius: "6px",
                        border: policyErrors.min_agreement ? "1px solid var(--danger)" : "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-primary)",
                        color: "var(--text-primary)",
                        fontSize: "0.9rem",
                      }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Minimum item agreement score to accept a consensus answer outright
                    </span>
                    {policyErrors.min_agreement && (
                      <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{policyErrors.min_agreement}</span>
                    )}
                  </div>

                  {/* 6. include_low_evidence */}
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "6px", paddingTop: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <input
                          type="checkbox"
                          id="include_low_evidence"
                          checked={policy.include_low_evidence}
                          onChange={(e) => setPolicy({ ...policy, include_low_evidence: e.target.checked })}
                          style={{ width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <label htmlFor="include_low_evidence" style={{ fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "var(--text-primary)" }}>
                          Include low evidence items in final dataset
                        </label>
                        <HelpTag content="Items marked 'low evidence' (see above) still have an answer — this toggle decides whether that answer is included in your final training-ready export, or left out until you've collected more annotations." />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: No</span>
                        <button
                          type="button"
                          onClick={() => setPolicy({ ...policy, include_low_evidence: DEFAULT_POLICY.include_low_evidence })}
                          disabled={policy.include_low_evidence === DEFAULT_POLICY.include_low_evidence}
                          aria-label="Reset include_low_evidence to default"
                          title="Reset to default (No)"
                          style={{
                            background: "none",
                            border: "none",
                            padding: "2px",
                            cursor: policy.include_low_evidence === DEFAULT_POLICY.include_low_evidence ? "default" : "pointer",
                            opacity: policy.include_low_evidence === DEFAULT_POLICY.include_low_evidence ? 0.3 : 1,
                            color: "var(--text-secondary)",
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "4px",
                          }}
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    </div>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", paddingLeft: "24px" }}>
                      Whether low-evidence accepted items are included in the training-ready set
                    </span>
                  </div>
                </div>

                {/* Collapsible Advanced Toggle */}
                <div style={{ borderTop: "1px dashed var(--border-color)", paddingTop: "10px" }}>
                  <button
                    type="button"
                    onClick={() => setShowAdvancedPrior(!showAdvancedPrior)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "var(--accent-strong)",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {showAdvancedPrior ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showAdvancedPrior ? "Hide Advanced Settings" : "Advanced Settings (Bayesian Prior Strength)"}
                  </button>

                  {showAdvancedPrior && (
                    <div style={{ marginTop: "10px", maxWidth: "420px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <label htmlFor="prior_strength" style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-primary)" }}>
                            Prior Strength
                          </label>
                          <HelpTag content="This controls how much the system leans on a general assumption of 'average' reliability versus an individual annotator's own gold-item track record. A higher number means more annotators need to prove themselves wrong before their score drops — useful when gold items are few. A lower number reacts faster to each individual's actual performance, but is noisier with limited data." />
                          {isFieldVeryPermissive("prior_strength", policy.prior_strength) && (
                            <PermissiveBadge />
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Default: 2.0</span>
                          <button
                            type="button"
                            onClick={() => setPolicy({ ...policy, prior_strength: DEFAULT_POLICY.prior_strength })}
                            disabled={policy.prior_strength === DEFAULT_POLICY.prior_strength}
                            aria-label="Reset prior_strength to default"
                            title="Reset to default (2.0)"
                            style={{
                              background: "none",
                              border: "none",
                              padding: "2px",
                              cursor: policy.prior_strength === DEFAULT_POLICY.prior_strength ? "default" : "pointer",
                              opacity: policy.prior_strength === DEFAULT_POLICY.prior_strength ? 0.3 : 1,
                              color: "var(--text-secondary)",
                              display: "inline-flex",
                              alignItems: "center",
                              borderRadius: "4px",
                            }}
                          >
                            <RotateCcw size={11} />
                          </button>
                        </div>
                      </div>
                      <input
                        id="prior_strength"
                        type="number"
                        min="0"
                        step="0.5"
                        value={policy.prior_strength}
                        onChange={(e) =>
                          setPolicy({
                            ...policy,
                            prior_strength: parseFloatThreshold(e.target.value, 2.0),
                          })
                        }
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: policyErrors.prior_strength ? "1px solid var(--danger)" : "1px solid var(--border-color)",
                          backgroundColor: "var(--bg-primary)",
                          color: "var(--text-primary)",
                          fontSize: "0.9rem",
                        }}
                      />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", display: "block", marginTop: "4px" }}>
                        Bayesian shrinkage weight toward the prior for reliability estimation
                      </span>
                      {policyErrors.prior_strength && (
                        <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{policyErrors.prior_strength}</span>
                      )}

                      {/* Persistent Risk Note (Spec Section 3) */}
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          backgroundColor: policy.prior_strength === 0 ? "var(--gold-soft)" : "rgba(255, 179, 0, 0.08)",
                          border: "1px solid var(--gold-primary)",
                          fontSize: "0.75rem",
                          lineHeight: "1.4",
                          color: "var(--text-primary)",
                          display: "flex",
                          gap: "6px",
                          alignItems: "flex-start",
                        }}
                      >
                        <AlertTriangle size={14} style={{ color: "var(--gold-primary)", flexShrink: 0, marginTop: "2px" }} />
                        <span>
                          <strong>At 0, an annotator's reliability is based purely on the gold items they've personally seen — risky if most annotators have seen only one or two. Higher values protect against judging someone too early; the default (2.0) is a reasonable balance for most experiments.</strong>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Preflight Statistics & Live Preview Card */}
            {preflight && (
              <div style={{ border: "1px solid var(--border-color)", borderRadius: "10px", padding: "16px", backgroundColor: "var(--bg-card)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "0.95rem" }}>Preflight Summary</strong>
                    {preflightLoading && (
                      <span style={{ fontSize: "0.78rem", color: "var(--accent-strong)", display: "flex", alignItems: "center", gap: "4px" }}>
                        <RefreshCw size={12} className="animate-spin" /> Recalculating...
                      </span>
                    )}
                  </div>
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
                    {preflight.training_ready ? "Training Ready" : "Quality Warnings Present"}
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

                {/* At these settings breakdown (Spec section 2) */}
                {mode === "consensus" && (
                  <div
                    style={{
                      marginTop: "14px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      backgroundColor: "var(--bg-secondary)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      At these settings:
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px", fontSize: "0.88rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "var(--mint-strong)", fontWeight: 700 }}>•</span>
                        <span>
                          <strong>{preflight.counts.consensus_accepted_samples}</strong> {preflight.counts.consensus_accepted_samples === 1 ? "sample" : "samples"} →{" "}
                          <span style={{ color: "var(--mint-strong)", fontWeight: 600 }}>training-ready</span>
                        </span>
                      </div>

                      {preflight.counts.tied_samples > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--gold-primary)", fontWeight: 700 }}>•</span>
                          <span>
                            <strong>{preflight.counts.tied_samples}</strong> {preflight.counts.tied_samples === 1 ? "sample" : "samples"} →{" "}
                            <span style={{ color: "var(--gold-primary)" }}>needs review (tie)</span>
                          </span>
                        </div>
                      )}

                      {preflight.counts.insufficient_overlap_samples > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--gold-primary)", fontWeight: 700 }}>•</span>
                          <span>
                            <strong>{preflight.counts.insufficient_overlap_samples}</strong> {preflight.counts.insufficient_overlap_samples === 1 ? "sample" : "samples"} →{" "}
                            <span style={{ color: "var(--gold-primary)" }}>needs review (insufficient overlap)</span>
                          </span>
                        </div>
                      )}

                      {preflight.counts.low_agreement_samples > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--gold-primary)", fontWeight: 700 }}>•</span>
                          <span>
                            <strong>{preflight.counts.low_agreement_samples}</strong> {preflight.counts.low_agreement_samples === 1 ? "sample" : "samples"} →{" "}
                            <span style={{ color: "var(--gold-primary)" }}>needs review (low agreement)</span>
                          </span>
                        </div>
                      )}

                      {!policy.include_low_evidence && preflight.counts.low_evidence_samples > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>•</span>
                          <span>
                            <strong>{preflight.counts.low_evidence_samples}</strong> {preflight.counts.low_evidence_samples === 1 ? "sample" : "samples"} →{" "}
                            <span style={{ color: "var(--text-secondary)" }}>needs review (low evidence)</span>
                          </span>
                        </div>
                      )}

                      {preflight.counts.unannotated_samples > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--text-secondary)", fontWeight: 700 }}>•</span>
                          <span>
                            <strong>{preflight.counts.unannotated_samples}</strong> {preflight.counts.unannotated_samples === 1 ? "sample" : "samples"} →{" "}
                            <span style={{ color: "var(--text-secondary)" }}>unannotated</span>
                          </span>
                        </div>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: preflight.annotator_summary.insufficient_gold_annotators > 0 ? "var(--gold-primary)" : "var(--text-secondary)", fontWeight: 700 }}>•</span>
                        <span>
                          <strong>{preflight.annotator_summary.insufficient_gold_annotators}</strong> {preflight.annotator_summary.insufficient_gold_annotators === 1 ? "annotator" : "annotators"} →{" "}
                          <span>excluded (insufficient gold evidence)</span>
                        </span>
                      </div>

                      {Math.max(0, preflight.annotator_summary.excluded_annotators - preflight.annotator_summary.insufficient_gold_annotators) > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ color: "var(--danger)", fontWeight: 700 }}>•</span>
                          <span>
                            <strong>{Math.max(0, preflight.annotator_summary.excluded_annotators - preflight.annotator_summary.insufficient_gold_annotators)}</strong> annotators →{" "}
                            <span style={{ color: "var(--danger)" }}>excluded (low gold accuracy)</span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

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

            {/* Audit & Immutability Notice (Spec section 4) */}
            <div
              style={{
                fontSize: "0.78rem",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "4px",
              }}
            >
              <Info size={14} style={{ flexShrink: 0 }} />
              <span>
                Each generated export is a new, independently fingerprinted and timestamped snapshot. Prior exports are never modified.
              </span>
            </div>


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
