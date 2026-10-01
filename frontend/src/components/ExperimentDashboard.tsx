import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Pause, Play, RefreshCw, Settings, Users } from "lucide-react";
import { Link } from "wouter";
import { apiFetch } from "../api";
import ExportDatasetModal from "./ExportDatasetModal";

interface DashboardData {
  experiment: {
    id: string;
    name: string;
    share_token: string;
    access_mode: "sign_in_required" | "guest_name" | "anonymous";
    qualification_form: Array<{ key: string; label: string; type: string }>;
  };
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

const formatScore = (score: number | null) => score == null ? "—" : `${(score * 100).toFixed(0)}%`;
const formatAnswer = (answer: unknown) => {
  if (Array.isArray(answer)) return answer.join(", ");
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  return String(answer ?? "—");
};
const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "—";

export default function ExperimentDashboard({ experimentId }: { experimentId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/dashboard`);
      if (!response.ok) throw new Error("Could not load experiment statistics");
      setData(await response.json());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load experiment statistics");
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const toggleAnnotator = async (id: string, status: "active" | "paused") => {
    const response = await apiFetch(`/api/annotators/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status === "active" ? "paused" : "active" }),
    });
    if (!response.ok) setError("Could not update annotator status");
    await refresh();
  };

  if (loading) return <div className="container text-center">Loading statistics…</div>;
  if (!data) return <div className="container text-center">{error || "Experiment not found"}</div>;

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "1200px" }}>
      <div className="flex-row" style={{ justifyContent: "space-between", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "2rem" }}>{data.experiment.name}</h1>
          <p style={{ margin: 0 }}>Live quality and completion statistics · {data.experiment.access_mode === "sign_in_required" ? "Sign-in required" : data.experiment.access_mode === "guest_name" ? "Guest names required" : "Anonymous access"}</p>
        </div>
        <div className="flex-row">
          <Link href={`/experiments/${experimentId}/settings`} className="btn btn-secondary"><Settings size={16} /> Settings</Link>
          <Link href={`/experiments/${experimentId}/annotators`} className="btn btn-secondary"><Users size={16} /> Annotators</Link>
          <Link href={`/experiments/${experimentId}/review`} className="btn btn-secondary"><Eye size={16} /> Review annotations</Link>
          <button className="btn btn-secondary" onClick={refresh}><RefreshCw size={16} /> Refresh</button>
          <button className="btn btn-primary" onClick={() => setShowExportModal(true)}>
            <Download size={16} /> Export dataset
          </button>
        </div>
      </div>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        <div className="glass-panel"><p>Completion</p><h2>{data.completion.percent.toFixed(0)}%</h2></div>
        <div className="glass-panel"><p>Assignments</p><h2>{data.completion.completed_assignments}/{data.completion.required_assignments}</h2></div>
        <div className="glass-panel"><p>Items remaining</p><h2>{data.completion.items_remaining}</h2></div>
        <div className="glass-panel"><p>Active annotators</p><h2>{data.active_annotators}</h2></div>
      </div>
      <div className="glass-panel" style={{ marginBottom: "24px", overflowX: "auto" }}>
        <div className="section-heading-inline">
          <div><h2>Annotator activity</h2><p>Quick quality overview</p></div>
          <Link href={`/experiments/${experimentId}/annotators`} className="btn btn-secondary">View all annotators</Link>
        </div>
        <table className="data-table">
          <thead><tr><th>Annotator</th><th>Status</th><th>Questionnaire</th><th>Items</th><th>Gold accuracy</th><th>Agreement</th><th>Last activity</th><th /></tr></thead>
          <tbody>
            {data.annotators.map(annotator => (
              <tr key={annotator.id}>
                <td><Link href={`/experiments/${experimentId}/annotators/${annotator.id}`} className="anonymous-id">{annotator.display_name}</Link></td><td>{annotator.status}</td>
                <td>{annotator.qualified_at ? <details className="annotator-profile"><summary>View answers</summary><dl>{data.experiment.qualification_form.map(question => <div key={question.key}><dt>{question.label}</dt><dd>{formatAnswer(annotator.qualification_answers[question.key])}</dd></div>)}</dl></details> : data.experiment.qualification_form.length ? "Not completed" : "Not required"}</td>
                <td>{annotator.items_completed}</td>
                <td>{formatScore(annotator.rolling_gold_accuracy)} (n={annotator.gold_items_seen})</td>
                <td>{formatScore(annotator.rolling_agreement_score)}</td>
                <td title={formatDate(annotator.last_activity_at)}>{formatDate(annotator.last_activity_at)}</td>
                <td><button className="btn btn-secondary" onClick={() => toggleAnnotator(annotator.id, annotator.status)}>
                  {annotator.status === "active" ? <Pause size={15} /> : <Play size={15} />}
                  {annotator.status === "active" ? "Pause" : "Resume"}
                </button></td>
              </tr>
            ))}
            {data.annotators.length === 0 && <tr><td colSpan={8}>No annotators yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="glass-panel">
        <h2>Completed overlap items</h2>
        <p>{data.items.length} item(s) have an agreement score.</p>
        {data.items.length > 0 && (
          <p>Mean agreement: {formatScore(data.items.reduce((sum, item) => sum + item.agreement_score, 0) / data.items.length)}</p>
        )}
      </div>

      {showExportModal && (
        <ExportDatasetModal
          experimentId={experimentId}
          experimentName={data.experiment.name}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
}
