import { useEffect, useState } from "react";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { Link } from "wouter";

import { getAnnotationPlugin } from "../../plugins/annotations/registry";
import { getCatalogPreset } from "../../plugins/catalog/registry";
import type { ValidatedCatalogPreset } from "../../plugins/catalog/types";
import CatalogPreview from "./CatalogPreview";

type DetailModel = { kind: "ready"; preset: ValidatedCatalogPreset } | { kind: "not-found" };
type Tab = "dataset" | "metadata" | "gold" | "scoring";

export function buildCatalogDetail(slug: string): DetailModel {
  const preset = getCatalogPreset(slug);
  return preset ? { kind: "ready", preset } : { kind: "not-found" };
}

export default function AnnotationCatalogDetail({ presetSlug }: { presetSlug: string }) {
  const model = buildCatalogDetail(presetSlug);
  const [tab, setTab] = useState<Tab>("dataset");
  const [rawMetadata, setRawMetadata] = useState("");
  const [rawGold, setRawGold] = useState("");

  useEffect(() => {
    if (model.kind !== "ready") return;
    let active = true;
    Promise.all([
      fetch(model.preset.metadataPath).then(response => response.ok ? response.text() : Promise.reject()),
      fetch(model.preset.goldAnswersPath).then(response => response.ok ? response.text() : Promise.reject()),
    ]).then(([metadata, gold]) => {
      if (active) { setRawMetadata(metadata); setRawGold(gold); }
    }).catch(() => {
      if (active) { setRawMetadata("Raw metadata could not be loaded."); setRawGold("Raw gold answers could not be loaded."); }
    });
    return () => { active = false; };
  }, [presetSlug]);

  if (model.kind === "not-found") return <div className="container text-center catalog-not-found">
    <h2>404 - Not Found</h2><p>This catalog entry no longer exists.</p>
    <Link href="/catalog" className="btn btn-secondary"><ArrowLeft size={16} /> Back to catalog</Link>
  </div>;

  const { preset } = model;
  const module = getAnnotationPlugin(preset.annotationType)!;
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "dataset", label: "Dataset bundle" }, { key: "metadata", label: "Metadata" },
    { key: "gold", label: "Gold answers" }, { key: "scoring", label: "Scoring" },
  ];
  return <div className="container catalog-detail animate-fade-in">
    <Link href="/catalog" className="catalog-back"><ArrowLeft size={16} /> Annotation catalog</Link>
    <header className="catalog-detail-header">
      <div><span className="catalog-eyebrow">{preset.family} · {preset.modalityName}</span><h1>{preset.title}</h1><p>{preset.summary}</p>
        <div className="catalog-chip-row">{preset.useCases.map(item => <span key={item}>{item}</span>)}</div>
      </div>
      <Link href={`/experiments/new?modality=${encodeURIComponent(preset.modality)}&annotation_type=${encodeURIComponent(preset.annotationType)}`} className="btn btn-primary"><Plus size={17} /> Create experiment</Link>
    </header>

    <section className="catalog-live-section">
      <span className="catalog-step">Interactive preview</span><h2>What the annotator sees</h2>
      <p>Try the actual production controls. Nothing you do here is saved.</p>
      <CatalogPreview key={preset.slug} preset={preset} />
    </section>

    <section className="catalog-data-section">
      <div className="catalog-tabs" role="tablist">{tabs.map(item => <button type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? "selected" : ""} onClick={() => setTab(item.key)} key={item.key}>{item.label}</button>)}</div>
      <div className="glass-panel catalog-tab-panel">
        {tab === "dataset" && <><div className="catalog-tab-title"><div><h2>Example dataset bundle</h2><p>Media, metadata, and gold answers joined by exact filename.</p></div><a className="btn btn-secondary" href={preset.exampleBundlePath} download><Download size={16} /> Download bundle</a></div>
          <div className="dataset-table-wrap"><table className="dataset-table"><thead><tr><th>Filename</th><th>Metadata</th><th>Gold answer</th></tr></thead><tbody>{preset.samples.map(sample => <tr key={sample.filename}><td><strong>{sample.filename}</strong></td><td><code>{JSON.stringify(sample.metadata)}</code></td><td><code>{sample.goldAnswer ? JSON.stringify(sample.goldAnswer) : "See gold_answers.json"}</code></td></tr>)}</tbody></table></div></>}
        {tab === "metadata" && <><h2>Metadata</h2><p>{preset.metadataDescription}</p><pre className="catalog-code"><code>{rawMetadata || "Loading metadata…"}</code></pre><a href={preset.metadataPath}>Open raw metadata.csv</a></>}
        {tab === "gold" && <><h2>Gold answers</h2><p>Required answer shape: <code>{module.goldAnswerShape(preset.schema)}</code></p><ul>{module.goldInstructions(preset.schema).map(item => <li key={item}>{item}</li>)}</ul><pre className="catalog-code"><code>{rawGold || "Loading gold answers…"}</code></pre><a href={preset.goldAnswersPath}>Open raw gold_answers.json</a></>}
        {tab === "scoring" && <><h2>Scoring</h2><p>{preset.scoringDescription}</p><div className="catalog-score-grid"><div><strong>Gold score</strong><p>Compares an annotator answer with the known answer for quality monitoring.</p></div><div><strong>Agreement</strong><p>Compares independent annotators on the same sample, including gold samples.</p></div></div></>}
      </div>
    </section>
  </div>;
}
