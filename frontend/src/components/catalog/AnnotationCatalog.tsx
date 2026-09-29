import { useMemo, useState } from "react";
import { ArrowRight, AudioLines, Box, Image, Search, Video } from "lucide-react";
import "./catalog.css";
import { Link } from "wouter";

import { COMING_SOON } from "../../plugins/catalog/comingSoon";
import {
  catalogModalityCounts,
  filterCatalog,
  type CatalogModality,
} from "../../plugins/catalog/filter";
import { listCatalogPresets } from "../../plugins/catalog/registry";

const modalities: Array<{ key: CatalogModality; label: string; icon: typeof Box }> = [
  { key: "all", label: "All", icon: Box },
  { key: "audio", label: "Audio", icon: AudioLines },
  { key: "image", label: "Image", icon: Image },
  { key: "video", label: "Video", icon: Video },
];

export default function AnnotationCatalog() {
  const entries = useMemo(() => listCatalogPresets(), []);
  const counts = useMemo(() => catalogModalityCounts(entries), [entries]);
  const [modality, setModality] = useState<CatalogModality>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterCatalog(entries, modality, query), [entries, modality, query]);

  return <div className="container catalog-page animate-fade-in">
    <header className="catalog-hero">
      <span className="catalog-eyebrow">Annotation catalog</span>
      <h1>Explore the task before you build it.</h1>
      <p>Try the real annotation tools, inspect example datasets, and choose the right structure for your experiment.</p>
    </header>

    <section aria-labelledby="catalog-modality-title">
      <div className="catalog-section-heading">
        <div><span className="catalog-step">01</span><h2 id="catalog-modality-title">Choose a modality</h2></div>
        <p>Start with the kind of media your annotators will inspect.</p>
      </div>
      <div className="catalog-modality-grid">
        {modalities.map(option => {
          const Icon = option.icon;
          return <button
            type="button"
            key={option.key}
            className={`catalog-modality-button ${modality === option.key ? "selected" : ""}`}
            aria-pressed={modality === option.key}
            onClick={() => setModality(option.key)}
          >
            <Icon size={22} />
            <span>{option.label}</span>
            <strong>{counts[option.key]}</strong>
          </button>;
        })}
      </div>
    </section>

    <section aria-labelledby="catalog-types-title">
      <div className="catalog-section-heading catalog-types-heading">
        <div><span className="catalog-step">02</span><h2 id="catalog-types-title">Choose an annotation type</h2></div>
        <label className="catalog-search">
          <Search size={18} />
          <span className="sr-only">Search annotation types</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks or use cases" />
        </label>
      </div>
      {visible.length ? <div className="catalog-card-grid">
        {visible.map(entry => <Link key={entry.slug} href={`/catalog/${entry.slug}`} className="catalog-card">
          <div className="catalog-card-top"><span>{entry.family}</span><span>{entry.modalityName}</span></div>
          <h3>{entry.title}</h3>
          <p>{entry.summary}</p>
          <div className="catalog-chip-row">{entry.useCases.slice(0, 2).map(useCase => <span key={useCase}>{useCase}</span>)}</div>
          <strong className="catalog-card-link">Explore example <ArrowRight size={16} /></strong>
        </Link>)}
      </div> : <div className="glass-panel catalog-empty">No working annotation types match this filter.</div>}
    </section>

    <section className="catalog-coming-soon" aria-labelledby="catalog-coming-title">
      <div className="catalog-section-heading">
        <div><span className="catalog-step">Next</span><h2 id="catalog-coming-title">Coming soon</h2></div>
        <p>Planned experiences that are not available for experiment creation yet.</p>
      </div>
      <div className="catalog-card-grid">
        {COMING_SOON.map(entry => <article className="catalog-card catalog-card-disabled" key={entry.slug}>
          <div className="catalog-card-top"><span>{entry.family}</span><span>{entry.modalities.join(", ")}</span></div>
          <h3>{entry.title}</h3><p>{entry.summary}</p>
          <strong className="catalog-coming-badge">Coming soon</strong>
        </article>)}
      </div>
    </section>
  </div>;
}
