import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Pause, Play, RefreshCw, Settings, Users, Share2, Layers, BookOpen, Award, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { apiFetch } from "../api";
import ExportDatasetModal from "./ExportDatasetModal";
import {
  ExperimentStatusBanner,
  ExperimentDeploySection,
  ExperimentDatasetSection,
  ExperimentQualificationsSection,
  ExperimentTeachingSection,
} from "./ExperimentConfigurationSections";

interface ExperimentDetail {
  id: string;
  name: string;
  instructions: string;
  modality: string;
  label_schema: any;
  metadata_schema: any[];
  access_mode: "sign_in_required" | "guest_name" | "anonymous";
  overlap_n: number;
  gold_ratio: number;
  status: string;
  share_token: string;
  qualification_form: any[];
  routing_rules: any[];
  teaching_examples: any[];
  pending_metadata: any[];
  pending_gold_manifest: any[];
  configuration_locked: boolean;
  created_at: string;
}

interface DashboardData {
  completion: {
    completed_assignments: number;
    required_assignments: number;
    percent: number;
    items_remaining: number;
  };
  active_annotators: number;
  annotators: Array<{
    id: string;
    display_name: string;
    email: string | null;
    identity_type: "signed_in" | "guest" | "anonymous";
    status: "active" | "paused";
    items_completed: number;
    gold_items_seen: number;
    rolling_gold_accuracy: number | null;
    rolling_agreement_score: number | null;
    qualification_answers: Record<string, unknown>;
    qualified_at: string | null;
    last_activity_at: string;
  }>;
  items: Array<{ data_unit_id: string; agreement_score: number; n_annotations: number }>;
}

const formatScore = (score: number | null) => (score == null ? "—" : `${(score * 100).toFixed(0)}%`);
const formatAnswer = (answer: unknown) => {
  if (Array.isArray(answer)) return answer.join(", ");
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  return String(answer ?? "—");
};
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "—";

export default function ExperimentDashboard({ experimentId }: { experimentId: string }) {
  const [experiment, setExperiment] = useState<ExperimentDetail | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "dataset" | "qualifications" | "teaching" | "settings">("overview");

  const loadExperiment = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/experiments/${experimentId}`);
      if (!res.ok) throw new Error("Could not load experiment details");
      const exp: ExperimentDetail = await res.json();
      setExperiment(exp);

      if (exp.status !== "active") {
        setActiveTab("dataset");
      }

      if (exp.status === "active") {
        const statsRes = await apiFetch(`/api/experiments/${experimentId}/dashboard`);
        if (statsRes.ok) {
          setDashboardData(await statsRes.json());
        }
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load experiment");
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    loadExperiment();
    const interval = window.setInterval(loadExperiment, 5000);
    return () => window.clearInterval(interval);
  }, [loadExperiment]);

  const toggleAnnotator = async (id: string, status: "active" | "paused") => {
    const response = await apiFetch(`/api/annotators/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status === "active" ? "paused" : "active" }),
    });
    if (!response.ok) setError("Could not update annotator status");
    await loadExperiment();
  };

  const copyShareLink = async () => {
    if (!experiment) return;
    const link = `${window.location.origin}/annotate/${experiment.share_token}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        alert("Share link copied to clipboard!");
        return;
      }
    } catch {}
    window.prompt("Copy share link:", link);
  };

  if (loading) return <div className="container text-center" style={{ padding: "40px" }}>Loading experiment…</div>;
  if (!experiment) return <div className="container text-center" style={{ padding: "40px" }}>{error || "Experiment not found"}</div>;

  const isDeployed = experiment.status === "active";

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "1200px" }}>
      {/* Status Banner */}
      <ExperimentStatusBanner
        status={experiment.status}
        onReuploadMedia={async () => {
          try {
            await apiFetch(`/api/experiments/${experimentId}/reupload-media`, { method: "POST" });
            await loadExperiment();
          } catch (e) {
            console.error("Reupload media failed", e);
          }
        }}
      />

      {/* Top Header */}
      <div className="flex-row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <h1 style={{ fontSize: "2rem", margin: 0 }}>{experiment.name}</h1>
            {isDeployed ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600, background: "rgba(16, 185, 129, 0.12)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.25)" }}>
                <CheckCircle size={12} /> Active
              </span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 600, background: "rgba(100, 116, 139, 0.12)", color: "#94a3b8", border: "1px solid rgba(100, 116, 139, 0.25)" }}>
                Draft
              </span>
            )}
          </div>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Modality: <strong>{experiment.modality}</strong> · Access: <strong>{experiment.access_mode}</strong> · Overlap: <strong>{experiment.overlap_n}</strong>
          </p>
        </div>
        <div className="flex-row" style={{ gap: "10px" }}>
          {isDeployed && (
            <>
              <button className="btn btn-secondary" onClick={copyShareLink} title="Copy Share Link">
                <Share2 size={16} /> Share link
              </button>
              <Link href={`/experiments/${experimentId}/annotators`} className="btn btn-secondary">
                <Users size={16} /> Annotators
              </Link>
              <Link href={`/experiments/${experimentId}/review`} className="btn btn-secondary">
                <Eye size={16} /> Review
              </Link>
              <button className="btn btn-primary" onClick={() => setShowExportModal(true)}>
                <Download size={16} /> Export
              </button>
            </>
          )}
          <Link href={`/experiments/${experimentId}/settings`} className="btn btn-secondary">
            <Settings size={16} /> Settings
          </Link>
          <button className="btn btn-secondary" onClick={loadExperiment} title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "16px" }}>{error}</p>}

      {/* Deploy Section (prominent at top when not deployed) */}
      {!isDeployed && (
        <ExperimentDeploySection
          experimentId={experimentId}
          status={experiment.status}
          onDeployed={loadExperiment}
        />
      )}

      {/* Navigation Tabs */}
      <div className="review-filter-tabs" style={{ marginBottom: "20px", display: "flex", gap: "8px", borderBottom: "1px solid var(--border-color)", paddingBottom: "8px" }}>
        {isDeployed && (
          <button
            type="button"
            className={`btn ${activeTab === "overview" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("overview")}
          >
            Overview &amp; Live Stats
          </button>
        )}
        <button
          type="button"
          className={`btn ${activeTab === "dataset" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("dataset")}
        >
          <Layers size={15} /> Dataset &amp; Gold
        </button>
        <button
          type="button"
          className={`btn ${activeTab === "qualifications" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("qualifications")}
        >
          <Award size={15} /> Qualifications ({experiment.qualification_form?.length ?? 0})
        </button>
        <button
          type="button"
          className={`btn ${activeTab === "teaching" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("teaching")}
        >
          <BookOpen size={15} /> Teaching Examples ({experiment.teaching_examples?.length ?? 0})
        </button>
      </div>

      {/* Tab 1: Overview & Live Stats (when active) */}
      {isDeployed && activeTab === "overview" && dashboardData && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            <div className="glass-panel"><p>Completion</p><h2>{dashboardData.completion.percent.toFixed(0)}%</h2></div>
            <div className="glass-panel"><p>Assignments</p><h2>{dashboardData.completion.completed_assignments}/{dashboardData.completion.required_assignments}</h2></div>
            <div className="glass-panel"><p>Items remaining</p><h2>{dashboardData.completion.items_remaining}</h2></div>
            <div className="glass-panel"><p>Active annotators</p><h2>{dashboardData.active_annotators}</h2></div>
          </div>
          <div className="glass-panel" style={{ marginBottom: "24px", overflowX: "auto" }}>
            <div className="section-heading-inline">
              <div><h2>Annotator activity</h2><p>Quick quality overview</p></div>
              <Link href={`/experiments/${experimentId}/annotators`} className="btn btn-secondary">View all annotators</Link>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Annotator</th>
                  <th>Status</th>
                  <th>Questionnaire</th>
                  <th>Items</th>
                  <th>Gold accuracy</th>
                  <th>Agreement</th>
                  <th>Last activity</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dashboardData.annotators.map(annotator => (
                  <tr key={annotator.id}>
                    <td><Link href={`/experiments/${experimentId}/annotators/${annotator.id}`} className="anonymous-id">{annotator.display_name}</Link></td>
                    <td>{annotator.status}</td>
                    <td>
                      {annotator.qualified_at ? (
                        <details className="annotator-profile">
                          <summary>View answers</summary>
                          <dl>
                            {experiment.qualification_form.map((q: any) => (
                              <div key={q.key}>
                                <dt>{q.label}</dt>
                                <dd>{formatAnswer(annotator.qualification_answers[q.key])}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : experiment.qualification_form.length ? (
                        "Not completed"
                      ) : (
                        "Not required"
                      )}
                    </td>
                    <td>{annotator.items_completed}</td>
                    <td>{formatScore(annotator.rolling_gold_accuracy)} (n={annotator.gold_items_seen})</td>
                    <td>{formatScore(annotator.rolling_agreement_score)}</td>
                    <td title={formatDate(annotator.last_activity_at)}>{formatDate(annotator.last_activity_at)}</td>
                    <td>
                      <button className="btn btn-secondary" onClick={() => toggleAnnotator(annotator.id, annotator.status)}>
                        {annotator.status === "active" ? <Pause size={15} /> : <Play size={15} />}
                        {annotator.status === "active" ? "Pause" : "Resume"}
                      </button>
                    </td>
                  </tr>
                ))}
                {dashboardData.annotators.length === 0 && <tr><td colSpan={8}>No annotators yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="glass-panel">
            <h2>Completed overlap items</h2>
            <p>{dashboardData.items.length} item(s) have an agreement score.</p>
            {dashboardData.items.length > 0 && (
              <p>Mean agreement: {formatScore(dashboardData.items.reduce((sum, item) => sum + item.agreement_score, 0) / dashboardData.items.length)}</p>
            )}
          </div>
        </>
      )}

      {/* Tab 2: Dataset & Gold */}
      {activeTab === "dataset" && (
        <ExperimentDatasetSection
          experimentId={experimentId}
          modality={experiment.modality}
          labelSchema={experiment.label_schema}
          status={experiment.status}
          onUpdated={loadExperiment}
        />
      )}

      {/* Tab 3: Qualifications */}
      {activeTab === "qualifications" && (
        <ExperimentQualificationsSection
          experimentId={experimentId}
          initialQuestions={experiment.qualification_form}
          initialRules={experiment.routing_rules}
          metadataFields={experiment.metadata_schema}
          onSaved={loadExperiment}
        />
      )}

      {/* Tab 4: Teaching Examples */}
      {activeTab === "teaching" && (
        <ExperimentTeachingSection
          experimentId={experimentId}
          modality={experiment.modality}
          labelSchema={experiment.label_schema}
          initialExamples={experiment.teaching_examples}
          onSaved={loadExperiment}
        />
      )}

      {showExportModal && (
        <ExportDatasetModal
          experimentId={experimentId}
          experimentName={experiment.name}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}
