import { type FormEvent, Suspense, useCallback, useEffect, useState } from "react";
import { SignInButton, useAuth } from "@clerk/react";
import { LogIn, Send, UserRound } from "lucide-react";
import AnnotationControl, { isAnswerComplete } from "./annotator/AnnotationControl";
import QualificationForm from "./annotator/QualificationForm";
import type { AnnotationAnswer, AnnotationSession } from "./annotator/types";
import { getAnnotationPlugin } from "../plugins/annotations/registry";
import { getMediaPlugin, supportsAnnotation } from "../plugins/media/registry";
import { apiFetch } from "../api";

interface NextItem {
  data_unit_id: string;
  media_url: string;
}

interface AnnotatorConfiguration {
  experiment_name: string;
  access_mode: "sign_in_required" | "guest_name" | "anonymous";
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body.detail === "string" ? body.detail : fallback;
  } catch {
    return fallback;
  }
}

export default function Annotator({ shareToken }: { shareToken: string }) {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const [configuration, setConfiguration] = useState<AnnotatorConfiguration | null>(null);
  const [session, setSession] = useState<AnnotationSession | null>(null);
  const [nextItem, setNextItem] = useState<NextItem | null>(null);
  const [answer, setAnswer] = useState<AnnotationAnswer>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [queueExhausted, setQueueExhausted] = useState(false);
  const [completionMessage, setCompletionMessage] = useState("There are no more items left for you to annotate. Thank you!");
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");

  const fetchNextItem = useCallback(async (sessionToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`/api/annotate/${shareToken}/next`, window.location.origin);
      url.searchParams.set("session_token", sessionToken);
      const response = await apiFetch(url);
      if (!response.ok) throw new Error(await responseError(response, "Could not load the next item"));
      const data = await response.json();
      if (data.message) {
        setNextItem(null);
        setQueueExhausted(true);
        setCompletionMessage(data.message);
      } else {
        setNextItem(data);
        setQueueExhausted(false);
        setAnswer({});
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the next item");
    } finally {
      setLoading(false);
    }
  }, [shareToken]);

  const startSession = useCallback(async (
    accessMode: AnnotatorConfiguration["access_mode"],
    displayName?: string,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const savedToken = localStorage.getItem(`annotate_session_${shareToken}`);
      const url = new URL(`/api/annotate/${shareToken}/session`, window.location.origin);
      if (savedToken && !displayName?.trim()) url.searchParams.set("session_token", savedToken);
      let response = displayName?.trim()
        ? await apiFetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_token: savedToken,
              display_name: displayName.trim(),
            }),
          })
        : await apiFetch(url);
      if (response.status === 401 && savedToken && accessMode === "sign_in_required") {
        localStorage.removeItem(`annotate_session_${shareToken}`);
        url.searchParams.delete("session_token");
        response = await apiFetch(url);
      }
      if (!response.ok) {
        if (accessMode === "guest_name" && response.status === 422) {
          localStorage.removeItem(`annotate_session_${shareToken}`);
          setLoading(false);
          return;
        }
        throw new Error(await responseError(response, "Could not initialize session"));
      }
      const data: AnnotationSession = await response.json();
      localStorage.setItem(`annotate_session_${shareToken}`, data.session_token);
      setSession(data);
      if (!data.requires_qualification) await fetchNextItem(data.session_token);
      else setLoading(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not initialize session");
      setLoading(false);
    }
  }, [fetchNextItem, shareToken]);

  useEffect(() => {
    if (!authLoaded) return;
    const initialize = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/annotate/${shareToken}/configuration`);
        if (!response.ok) throw new Error(await responseError(response, "Could not load experiment"));
        const config: AnnotatorConfiguration = await response.json();
        setConfiguration(config);
        const savedToken = localStorage.getItem(`annotate_session_${shareToken}`);
        if (config.access_mode === "sign_in_required" && !isSignedIn) {
          setLoading(false);
          return;
        }
        if (config.access_mode === "guest_name" && !savedToken) {
          setLoading(false);
          return;
        }
        await startSession(config.access_mode);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not load experiment");
        setLoading(false);
      }
    };
    initialize();
  }, [authLoaded, isSignedIn, shareToken, startSession]);

  const submitGuestName = async (event: FormEvent) => {
    event.preventDefault();
    if (!configuration || !guestName.trim()) return;
    await startSession(configuration.access_mode, guestName);
  };

  const submitAnnotation = async () => {
    if (!session || !nextItem || !isAnswerComplete(session.label_schema, answer)) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = new URL(
        `/api/annotate/${shareToken}/items/${nextItem.data_unit_id}/annotations`,
        window.location.origin,
      );
      url.searchParams.set("session_token", session.session_token);
      const response = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
      if (response.status === 409) {
        await fetchNextItem(session.session_token);
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Failed to submit annotation"));
      await fetchNextItem(session.session_token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to submit annotation");
    } finally {
      setSubmitting(false);
    }
  };

  const submitQualifications = async (answers: Record<string, unknown>) => {
    if (!session) return;
    setSubmitting(true);
    setError(null);
    try {
      const url = new URL(`/api/annotate/${shareToken}/qualifications`, window.location.origin);
      url.searchParams.set("session_token", session.session_token);
      const response = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not save qualifications"));
      setSession(current => current ? { ...current, requires_qualification: false } : current);
      await fetchNextItem(session.session_token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save qualifications");
    } finally {
      setSubmitting(false);
    }
  };

  if (!authLoaded || loading) return <div className="container text-center">Loading…</div>;
  if (configuration?.access_mode === "sign_in_required" && !isSignedIn) {
    return <div className="container animate-fade-in" style={{ maxWidth: "560px" }}><div className="glass-panel join-experiment-card"><LogIn size={34} className="app-logo-icon" /><h1>Sign in to annotate</h1><p><strong>{configuration.experiment_name}</strong> requires a verified account so your work can be attributed to you.</p><SignInButton mode="modal"><button className="btn btn-primary">Sign in and continue</button></SignInButton></div></div>;
  }
  if (configuration?.access_mode === "guest_name" && !session) {
    return <div className="container animate-fade-in" style={{ maxWidth: "560px" }}><form className="glass-panel join-experiment-card" onSubmit={submitGuestName}><UserRound size={34} className="app-logo-icon" /><h1>Enter your name</h1><p>Your name will be shown to the creator of <strong>{configuration.experiment_name}</strong>. No account is required.</p><div className="form-group"><label className="form-label" htmlFor="guest-name">Display name</label><input id="guest-name" className="form-input" autoFocus maxLength={120} value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="Your name" /></div>{error && <p className="form-error">{error}</p>}<button className="btn btn-primary" type="submit" disabled={!guestName.trim() || submitting}>Continue</button></form></div>;
  }
  if (session?.requires_qualification) {
    return (
      <QualificationForm
        questions={session.qualification_form}
        submitting={submitting}
        onSubmit={submitQualifications}
        error={error}
      />
    );
  }
  if (error && !nextItem) return <div className="container text-center">Error: {error}</div>;
  if (queueExhausted || !nextItem || !session) {
    return (
      <div className="container text-center animate-fade-in glass-panel">
        <h2>All Done!</h2>
        <p>{completionMessage}</p>
      </div>
    );
  }

  const mediaPlugin = getMediaPlugin(session.modality);
  const annotationPlugin = getAnnotationPlugin(session.label_schema.annotation_type);
  const compatible = Boolean(
    mediaPlugin && annotationPlugin && supportsAnnotation(mediaPlugin, annotationPlugin.requiredInteraction),
  );
  const preparedAnswer = annotationPlugin?.prepareAnswer(session.label_schema, answer) ?? answer;
  const interaction = annotationPlugin?.createInteraction(session.label_schema, preparedAnswer, setAnswer) ?? { kind: "none" as const };
  const MediaRenderer = mediaPlugin?.AnnotationRenderer;
  return (
    <div className="container animate-fade-in" style={{ width: "100%", maxWidth: "1000px" }}>
      <div className="glass-panel" style={{ marginBottom: "20px" }}>
        <h2>Instructions</h2>
        <p>{session.instructions || "Review the item and provide your annotation."}</p>
      </div>
      {compatible && MediaRenderer ? (
        <Suspense fallback={<div className="glass-panel">Loading media tools…</div>}>
          <MediaRenderer
            key={nextItem.data_unit_id}
            mediaUrl={nextItem.media_url}
            interaction={interaction}
          />
        </Suspense>
      ) : (
        <div className="glass-panel">
          {!mediaPlugin
            ? `Unsupported media modality: ${session.modality}`
            : !annotationPlugin
              ? `Unsupported annotation type: ${session.label_schema.annotation_type}`
              : `${annotationPlugin.key} annotations are not compatible with ${mediaPlugin.name.toLowerCase()}`}
        </div>
      )}
      <div className="glass-panel">
        <h3 style={{ marginBottom: "16px" }}>Submit Annotation</h3>
        <AnnotationControl schema={session.label_schema} answer={answer} onChange={setAnswer} />
        {error && <p style={{ color: "var(--danger)", marginTop: "16px" }}>{error}</p>}
        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: "20px" }}
          onClick={submitAnnotation}
          disabled={submitting || !compatible || !isAnswerComplete(session.label_schema, answer)}
        >
          <Send size={18} /> {submitting ? "Submitting…" : "Submit & Next"}
        </button>
      </div>
    </div>
  );
}
