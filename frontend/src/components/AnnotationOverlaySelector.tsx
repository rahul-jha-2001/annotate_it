import { Suspense, useEffect, useState } from "react";

import { getAnnotationPlugin } from "../plugins/annotations/registry";
import type { MediaInteraction } from "../plugins/contracts";
import { getMediaPlugin, supportsAnnotation } from "../plugins/media/registry";
import type { AnnotationAnswer, LabelSchema } from "./annotator/types";

export interface OverlayOption {
  id: string;
  label: string;
  answer: AnnotationAnswer;
}

interface SubmissionOverlay {
  id: string;
  label: string;
  answer: AnnotationAnswer;
}

export function buildOverlayOptions(
  goldAnswer: AnnotationAnswer | null,
  submissions: SubmissionOverlay[],
): OverlayOption[] {
  return [
    ...(goldAnswer ? [{ id: "gold", label: "Gold answer", answer: goldAnswer }] : []),
    ...submissions.map(submission => ({ ...submission })),
  ];
}

export function selectedOverlay(options: OverlayOption[], id: string): OverlayOption | null {
  return options.find(option => option.id === id) ?? options[0] ?? null;
}

export function readonlyInteractionFor(
  schema: LabelSchema,
  answer: unknown,
): MediaInteraction | null {
  const module = getAnnotationPlugin(schema.annotation_type);
  return module
    ? module.createReadonlyInteraction(schema, answer as AnnotationAnswer)
    : null;
}

interface AnnotationOverlaySelectorProps {
  modality: string;
  schema: LabelSchema;
  mediaUrl: string;
  title?: string;
  options: OverlayOption[];
}

export default function AnnotationOverlaySelector({
  modality,
  schema,
  mediaUrl,
  title,
  options,
}: AnnotationOverlaySelectorProps) {
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? "");
  const selected = selectedOverlay(options, selectedId);
  const mediaPlugin = getMediaPlugin(modality);
  const annotationPlugin = getAnnotationPlugin(schema.annotation_type);
  const interaction = selected ? readonlyInteractionFor(schema, selected.answer) : null;

  useEffect(() => {
    if (!options.some(option => option.id === selectedId)) {
      setSelectedId(options[0]?.id ?? "");
    }
  }, [options, selectedId]);

  if (!mediaPlugin) return <code>{selected ? JSON.stringify(selected.answer) : `Unsupported media: ${modality}`}</code>;
  if (!selected || !annotationPlugin || !interaction || !supportsAnnotation(mediaPlugin, annotationPlugin.requiredInteraction)) {
    const Preview = mediaPlugin.PreviewRenderer;
    return <div>
      <Preview mediaUrl={mediaUrl} title={title} />
      {selected && <code>{JSON.stringify(selected.answer)}</code>}
    </div>;
  }

  const Renderer = mediaPlugin.AnnotationRenderer;
  return <div className="annotation-overlay-review">
    {options.length > 1 && <label className="overlay-selector-label">
      <span>Overlay shown</span>
      <select className="form-select" value={selected.id} onChange={event => setSelectedId(event.target.value)}>
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>}
    <Suspense fallback={<div className="media-preview">Loading annotation overlay…</div>}>
      <Renderer mediaUrl={mediaUrl} interaction={interaction} />
    </Suspense>
  </div>;
}
