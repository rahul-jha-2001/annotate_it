import { Component, Suspense, useEffect, useReducer, useState, type ErrorInfo, type ReactNode } from "react";

import { getAnnotationPlugin, supportsAnnotationModule } from "../../plugins/annotations/registry";
import { getMediaPlugin } from "../../plugins/media/registry";
import AnnotationControl from "./AnnotationControl";
import type { AnnotationAnswer, LabelSchema } from "./types";

interface Props {
  modality: string;
  schema: LabelSchema;
  answer: AnnotationAnswer;
  onChange: (answer: AnnotationAnswer) => void;
  mediaUrl: string;
  mediaKey?: string;
  controlHeading?: string;
  onMediaStateChange?: (ready: boolean) => void;
}

interface BoundaryProps { children: ReactNode; resetKey: string }
interface BoundaryState { failed: boolean; retry: number }

export interface MediaLoadState { error: string | null; retry: number }
export type MediaLoadAction =
  | { type: "failed"; message: string }
  | { type: "retry" }
  | { type: "reset" };

export function reduceMediaLoadState(state: MediaLoadState, action: MediaLoadAction): MediaLoadState {
  if (action.type === "failed") return { ...state, error: action.message };
  if (action.type === "retry") return { error: null, retry: state.retry + 1 };
  return { error: null, retry: 0 };
}

export class MediaErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, retry: 0 };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false, retry: 0 });
    }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {}

  render() {
    if (this.state.failed) return <div className="glass-panel media-preview-error">
      <p>This media preview could not be loaded.</p>
      <button type="button" className="btn btn-secondary" onClick={() => this.setState(state => ({ failed: false, retry: state.retry + 1 }))}>Retry preview</button>
    </div>;
    return <div key={this.state.retry}>{this.props.children}</div>;
  }
}

export function resolveAnnotationExperience(
  modality: string,
  schema: LabelSchema,
  answer: AnnotationAnswer,
  onChange: (answer: AnnotationAnswer) => void,
) {
  const mediaPlugin = getMediaPlugin(modality);
  const annotationModule = getAnnotationPlugin(schema.annotation_type);
  if (!mediaPlugin) return { error: `Unsupported media modality: ${modality}` };
  if (!annotationModule) return { error: `Unsupported annotation type: ${schema.annotation_type}` };
  if (!supportsAnnotationModule(mediaPlugin, annotationModule)) {
    return { error: `${annotationModule.key} annotations are not compatible with ${mediaPlugin.name.toLowerCase()}` };
  }
  const preparedAnswer = annotationModule.prepareAnswer(schema, answer);
  return {
    annotationModule,
    mediaPlugin,
    preparedAnswer,
    interaction: annotationModule.createInteraction(schema, preparedAnswer, onChange),
  };
}

export function AnnotationExperience({
  modality, schema, answer, onChange, mediaUrl, mediaKey, controlHeading, onMediaStateChange,
}: Props) {
  const resolved = resolveAnnotationExperience(modality, schema, answer, onChange);
  const [mediaLoad, dispatchMediaLoad] = useReducer(reduceMediaLoadState, { error: null, retry: 0 });
  const [mediaReady, setMediaReady] = useState(false);
  const resetKey = (mediaKey ?? "media") + ":" + mediaUrl;

  useEffect(() => {
    dispatchMediaLoad({ type: "reset" });
    setMediaReady(false);
  }, [resetKey]);

  useEffect(() => {
    onMediaStateChange?.(mediaReady && !mediaLoad.error);
  }, [mediaReady, mediaLoad.error, onMediaStateChange]);

  if (resolved.error) return <div className="glass-panel">{resolved.error}</div>;
  const MediaRenderer = resolved.mediaPlugin!.AnnotationRenderer;
  return <>
    {mediaLoad.error ? <div className="glass-panel media-preview-error">
      <p>This media preview could not be loaded: {mediaLoad.error}</p>
      <button type="button" className="btn btn-secondary" onClick={() => {
        setMediaReady(false);
        dispatchMediaLoad({ type: "retry" });
      }}>Retry preview</button>
    </div> : <MediaErrorBoundary resetKey={resetKey + ":" + mediaLoad.retry}>
      <Suspense fallback={<div className="glass-panel">Loading media tools…</div>}>
        <MediaRenderer
          key={(mediaKey ?? "media") + ":" + mediaLoad.retry}
          mediaUrl={mediaUrl}
          interaction={resolved.interaction!}
          onReady={() => setMediaReady(true)}
          onError={message => {
            setMediaReady(false);
            dispatchMediaLoad({ type: "failed", message });
          }}
        />
      </Suspense>
    </MediaErrorBoundary>}
    <div className="glass-panel">
      {controlHeading && <h3 style={{ marginBottom: "16px" }}>{controlHeading}</h3>}
      <AnnotationControl schema={schema} answer={resolved.preparedAnswer!} onChange={onChange} />
    </div>
  </>;
}
