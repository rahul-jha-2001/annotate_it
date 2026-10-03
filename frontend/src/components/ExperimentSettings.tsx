import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, LockKeyhole, Save, Settings, Trash2, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { apiFetch } from "../api";

type AccessMode = "sign_in_required" | "guest_name" | "anonymous";

interface ExperimentSettingsData {
  id: string;
  name: string;
  instructions: string;
  modality: string;
  annotation_type: string;
  access_mode: AccessMode;
  overlap_n: number;
  gold_ratio: number;
  configuration_locked: boolean;
}

const accessModes: Array<{ value: AccessMode; title: string; description: string }> = [
  { value: "sign_in_required", title: "Sign-in required", description: "Every annotator must use a verified Clerk account." },
  { value: "guest_name", title: "Name required", description: "Anyone with the link can join after entering a display name." },
  { value: "anonymous", title: "Fully anonymous", description: "Anyone with the link can join without giving a name." },
];

async function errorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return typeof body?.detail === "string" ? body.detail : fallback;
}

export default function ExperimentSettings({ experimentId }: { experimentId: string }) {
  const [, navigate] = useLocation();
  const [settings, setSettings] = useState<ExperimentSettingsData | null>(null);
  const [persistedName, setPersistedName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDeleteToast, setShowDeleteToast] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/settings`);
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load experiment settings"));
      const data: ExperimentSettingsData = await response.json();
      setSettings(data);
      setPersistedName(data.name);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load experiment settings");
    } finally {
      setLoading(false);
    }
  }, [experimentId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!settings || !settings.name.trim()) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: settings.name,
          instructions: settings.instructions,
          access_mode: settings.access_mode,
          overlap_n: settings.overlap_n,
          gold_ratio: settings.gold_ratio,
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not save experiment settings"));
      const data: ExperimentSettingsData = await response.json();
      setSettings(data);
      setPersistedName(data.name);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save experiment settings");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!showDeleteToast) return;
    const timeout = window.setTimeout(() => setShowDeleteToast(false), 6500);
    return () => window.clearTimeout(timeout);
  }, [showDeleteToast]);

  const beginDelete = () => {
    setDeleteOpen(true);
    setDeleteConfirmation("");
    setShowDeleteToast(true);
  };

  const deleteExperiment = async () => {
    if (deleteConfirmation !== persistedName) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/experiments/${experimentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experiment_name: deleteConfirmation }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not delete experiment"));
      navigate("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete experiment");
      setDeleting(false);
    }
  };

  if (loading) return <div className="container text-center">Loading settings…</div>;
  if (!settings) return <div className="container text-center">{error || "Experiment not found"}</div>;

  return (
    <div className="container animate-fade-in" style={{ maxWidth: "900px" }}>
      {showDeleteToast && <div className="warning-toast" role="status" aria-live="polite"><AlertTriangle size={20} /><div><strong>Collected annotations will also be removed</strong><span>Deleting this experiment removes access to its samples, annotators, scores, and annotations.</span></div><button type="button" aria-label="Dismiss warning" onClick={() => setShowDeleteToast(false)}><X size={17} /></button></div>}
      <div className="page-heading">
        <div><p className="sample-number">Experiment configuration</p><h1 style={{ fontSize: "2rem" }}>Settings</h1><p style={{ margin: 0 }}>{settings.name}</p></div>
        <Link href={`/experiments/${experimentId}`} className="btn btn-secondary"><ArrowLeft size={16} /> Back to experiment</Link>
      </div>

      <div className="glass-panel settings-form">
        <div className="wizard-title"><Settings size={23} className="app-logo-icon" /><div><h2>General details</h2><p>The name and instructions can be updated at any time.</p></div></div>
        <div className="form-group"><label className="form-label">Experiment name</label><input className="form-input" value={settings.name} maxLength={200} onChange={event => setSettings({ ...settings, name: event.target.value })} /></div>
        <div className="form-group"><label className="form-label">Instructions for annotators</label><textarea className="form-textarea" value={settings.instructions} maxLength={10000} onChange={event => setSettings({ ...settings, instructions: event.target.value })} /></div>

        <div className="settings-section-heading"><div><h2>Annotator access</h2><p>Choose how people identify themselves when opening the share link.</p></div>{settings.configuration_locked && <span className="locked-chip"><LockKeyhole size={14} /> Locked</span>}</div>
        <div className="access-mode-grid">
          {accessModes.map(mode => <button type="button" key={mode.value} disabled={settings.configuration_locked} className={`access-mode-card ${settings.access_mode === mode.value ? "selected" : ""}`} onClick={() => setSettings({ ...settings, access_mode: mode.value })}><strong>{mode.title}</strong><span>{mode.description}</span></button>)}
        </div>

        <div className="settings-section-heading"><div><h2>Quality settings</h2><p>These affect assignment and scoring behavior.</p></div>{settings.configuration_locked && <span className="locked-chip"><LockKeyhole size={14} /> Locked</span>}</div>
        <div className="quality-grid">
          <div className="form-group"><label className="form-label">People per regular sample</label><input className="form-input" type="number" min="1" max="100" disabled={settings.configuration_locked} value={settings.overlap_n} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) setSettings({ ...settings, overlap_n: value }); }} /></div>
          <div className="form-group"><label className="form-label">Gold-check frequency</label><input className="form-input" type="number" min="0" max="1" step="0.01" disabled={settings.configuration_locked} value={settings.gold_ratio} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) setSettings({ ...settings, gold_ratio: value }); }} /><span className="help-text">Use a value from 0 to 1. For example, 0.1 means 10%.</span></div>
        </div>
        {settings.configuration_locked && <div className="settings-lock-notice"><LockKeyhole size={18} /><p>Access and quality settings are locked because annotations have been submitted. This protects assignment history and score consistency.</p></div>}

        <div className="read-only-summary"><div><span>Media type</span><strong>{settings.modality}</strong></div><div><span>Annotation type</span><strong>{settings.annotation_type}</strong></div></div>
        {error && <p className="form-error">{error}</p>}
        {saved && <p className="form-success">Experiment settings saved.</p>}
        <div className="settings-actions"><button className="btn btn-primary" disabled={saving || !settings.name.trim()} onClick={save}><Save size={17} /> {saving ? "Saving…" : "Save changes"}</button></div>

        <section className="danger-zone">
          <div className="danger-zone-heading"><div><h2>Delete experiment</h2><p>Remove this experiment and all collected work from normal product access.</p></div><Trash2 size={22} /></div>
          {!deleteOpen ? (
            <button type="button" className="btn btn-danger" onClick={beginDelete}><Trash2 size={17} /> Delete experiment</button>
          ) : (
            <div className="delete-confirmation">
              <div className="delete-warning"><AlertTriangle size={19} /><p>This also removes access to every collected annotation, sample, annotator profile, and score. The records are retained internally as soft-deleted data and are not physically erased.</p></div>
              <div className="form-group"><label className="form-label" htmlFor="delete-experiment-name">Enter <strong>{persistedName}</strong> to confirm</label><input id="delete-experiment-name" className="form-input" autoComplete="off" value={deleteConfirmation} onChange={event => setDeleteConfirmation(event.target.value)} placeholder={persistedName} /></div>
              <div className="delete-actions"><button type="button" className="btn btn-secondary" disabled={deleting} onClick={() => { setDeleteOpen(false); setDeleteConfirmation(""); }}>Cancel</button><button type="button" className="btn btn-danger" disabled={deleting || deleteConfirmation !== persistedName} onClick={deleteExperiment}><Trash2 size={17} /> {deleting ? "Deleting…" : "Delete experiment"}</button></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
