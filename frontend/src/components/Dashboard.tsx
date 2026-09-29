import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Plus, Activity, ExternalLink, Eye, Share2 } from "lucide-react";
import { apiFetch } from "../api";

export default function Dashboard() {
  const [experiments, setExperiments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchExperiments = async () => {
      try {
        const res = await apiFetch("/api/experiments");
        const data = await res.json();
        setExperiments(data.experiments || []);
      } catch (err) {
        console.error("Failed to fetch experiments", err);
      } finally {
        setLoading(false);
      }
    };
    fetchExperiments();
  }, []);

  const copyLink = async (token: string) => {
    const link = `${window.location.origin}/annotate/${token}`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        alert("Share link copied to clipboard!");
        return;
      }
    } catch {
      // Fall through to execCommand fallback
    }

    try {
      const textarea = document.createElement("textarea");
      textarea.value = link;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (successful) {
        alert("Share link copied to clipboard!");
        return;
      }
    } catch {
      // Fall through to prompt fallback
    }

    window.prompt("Copy this share link:", link);
  };

  return (
    <div className="container animate-fade-in" style={{ width: "100%", maxWidth: "1200px" }}>
      <div className="flex-row" style={{ justifyContent: "space-between", marginBottom: "40px" }}>
        <div>
          <h1 style={{ fontSize: "2rem", marginBottom: "8px" }}>Dashboard</h1>
          <p style={{ margin: 0 }}>Manage your annotation experiments and track live progress.</p>
        </div>
        <Link href="/experiments/new">
          <button className="btn btn-primary" style={{ padding: "12px 24px" }}>
            <Plus size={18} /> New Experiment
          </button>
        </Link>
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: "40px" }}>Loading experiments...</div>
      ) : experiments.length === 0 ? (
        <div className="glass-panel text-center" style={{ padding: "60px 20px" }}>
          <Activity size={48} className="app-logo-icon" style={{ margin: "0 auto 16px", opacity: 0.5 }} />
          <h3>No experiments yet</h3>
          <p>Create your first experiment to get started with live annotation tracking.</p>
          <Link href="/experiments/new">
            <button className="btn btn-primary" style={{ marginTop: "16px" }}>
              <Plus size={18} /> Create Experiment
            </button>
          </Link>
        </div>
      ) : (
        <div className="flex-col" style={{ gap: "20px" }}>
          {experiments.map((exp) => (
            <div key={exp.id} className="glass-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "24px" }}>
              <div>
                <h3 style={{ margin: "0 0 8px 0", fontSize: "1.25rem" }}>{exp.name}</h3>
                <div className="flex-row" style={{ gap: "16px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--accent-primary)" }}></span>
                    {exp.status === "draft" ? "Draft" : "Active"}
                  </span>
                  <span>Created: {new Date(exp.created_at).toLocaleDateString()}</span>
                  <span>ID: {exp.id.split("-")[0]}...</span>
                </div>
              </div>
              <div className="flex-row" style={{ gap: "12px" }}>
                <button className="btn btn-secondary" disabled={exp.status === "draft"} onClick={() => copyLink(exp.share_token)} title="Copy Share Link">
                  <Share2 size={16} />
                </button>
                <Link href={`/experiments/${exp.id}`}>
                  <button className="btn btn-secondary">
                    View Stats <ExternalLink size={16} />
                  </button>
                </Link>
                <Link href={`/experiments/${exp.id}/review`}>
                  <button className="btn btn-secondary">
                    Review <Eye size={16} />
                  </button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
