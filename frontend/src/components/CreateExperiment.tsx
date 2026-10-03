import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileArchive,
  Files,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Settings,
  UploadCloud,
  X,
} from "lucide-react";
import AnnotationControl from "./annotator/AnnotationControl";
import type { AnnotationAnswer, LabelSchema } from "./annotator/types";
import { getAnnotationPlugin, supportsAnnotationModule } from "../plugins/annotations/registry";
import { getMediaPlugin, listMediaPlugins } from "../plugins/media/registry";
import { apiFetch } from "../api";
import {
  clearUploadCache,
  type MultipartProgress,
  uploadMultipartFile,
} from "../services/multipartUpload";
import { parseCsv } from "./datasetBundle";
import { resolveExperimentPreset } from "./experimentDraft";

interface AnnotationTypeInfo {
  key: string;
  name: string;
  compatible_modalities: string[];
  supports_choices: boolean;
  supports_multi_select: boolean;
  required_interaction: string;
}

const steps = ["Basics", "Task", "Dataset upload"];

export default function CreateExperiment() {
  const [step, setStep] = useState(0);
  const [initialPreset] = useState(() => resolveExperimentPreset(window.location.search));
  const [form, setForm] = useState(() => ({
    name: "",
    modality: initialPreset.modality,
    instructions: "",
    overlap_n: 2,
    gold_ratio: 0.1,
    access_mode: "guest_name",
  }));
  const [annotationTypes, setAnnotationTypes] = useState<AnnotationTypeInfo[]>([]);
  const [annotationSchema, setAnnotationSchema] = useState<LabelSchema>(() => initialPreset.schema);
  const annotationType = annotationSchema.annotation_type;
  const [previewAnswer, setPreviewAnswer] = useState<AnnotationAnswer>({});
  const [files, setFiles] = useState<File[]>([]);
  const [metadataCsv, setMetadataCsv] = useState("");
  const [goldManifest, setGoldManifest] = useState("");
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [uploadMode, setUploadMode] = useState<"files" | "bundle">("files");
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [bundleUploadStatus, setBundleUploadStatus] = useState<"idle" | "uploading" | "paused" | "completed" | "failed">("idle");
  const [bundleProgress, setBundleProgress] = useState<MultipartProgress | null>(null);
  const [bundleAbortController, setBundleAbortController] = useState<AbortController | null>(null);
  const [createdExperimentId, setCreatedExperimentId] = useState<string | null>(null);
  const bundleUploadPromiseRef = useRef<Promise<void> | null>(null);
  const createdExperimentIdRef = useRef<string | null>(null);
  const [bundleJobId, setBundleJobId] = useState<string | null>(null);
  const [bundleJobStatus, setBundleJobStatus] = useState<"queued" | "processing" | "completed" | "failed" | null>(null);
  const [bundleJobProgress, setBundleJobProgress] = useState<{ files_processed: number; files_total: number } | null>(null);
  const [bundleJobApplied, setBundleJobApplied] = useState<string[]>([]);
  const [bundleJobErrors, setBundleJobErrors] = useState<Array<{ filename: string; error: string }>>([]);
  const [showBundleErrorDetails, setShowBundleErrorDetails] = useState(false);

  useEffect(() => {
    if (!createdExperimentId || !bundleJobId) return;
    if (bundleJobStatus !== "queued" && bundleJobStatus !== "processing") return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/experiments/${createdExperimentId}/bundle-upload/${bundleJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        setBundleJobStatus(data.status);
        if (data.progress) {
          setBundleJobProgress({
            files_processed: data.progress.files_processed,
            files_total: data.progress.files_total,
          });
        }
        if (data.result?.applied) {
          setBundleJobApplied(data.result.applied);
          if (data.status === "completed" && data.result.applied.length > 0) {
            setFiles(data.result.applied.map((fn: string) => new File([""], fn, { type: "application/octet-stream" })));
          }
        }
        if (data.result?.errors) {
          setBundleJobErrors(data.result.errors);
        }
      } catch (pollErr) {
        console.error("Bundle status poll error:", pollErr);
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [createdExperimentId, bundleJobId, bundleJobStatus]);


  useEffect(() => {
    apiFetch("/api/annotation-types").then(response => response.json()).then(setAnnotationTypes)
      .catch(() => setError("Could not load annotation types"));
  }, []);

  const mediaPlugin = getMediaPlugin(form.modality);
  const availableTypes = annotationTypes.filter(type => {
    const plugin = getAnnotationPlugin(type.key);
    return Boolean(
      plugin
      && mediaPlugin
      && type.required_interaction === plugin.requiredInteraction
      && type.compatible_modalities.includes(form.modality)
      && supportsAnnotationModule(mediaPlugin, plugin),
    );
  });
  const currentType = availableTypes.find(type => type.key === annotationType);
  const annotationPlugin = getAnnotationPlugin(annotationType);
  const preparedPreviewAnswer = annotationPlugin?.prepareAnswer(annotationSchema, previewAnswer) ?? previewAnswer;
  useEffect(() => {
    const selectedMedia = getMediaPlugin(form.modality);
    setAnnotationSchema(current => {
      const selectedModule = getAnnotationPlugin(current.annotation_type);
      return selectedMedia && selectedModule
        ? selectedModule.schemaForContext(current, selectedMedia.moduleContext)
        : current;
    });
  }, [form.modality]);
  useEffect(() => {
    if (availableTypes.length && !availableTypes.some(type => type.key === annotationType)) {
      const next = getAnnotationPlugin(availableTypes[0].key);
      if (next && mediaPlugin) setAnnotationSchema(next.defaultSchema(mediaPlugin.moduleContext));
    }
  }, [annotationType, availableTypes, mediaPlugin]);
  useEffect(() => {
    setPreviewAnswer(annotationPlugin?.createInitialAnswer(annotationSchema) ?? {});
  }, [annotationPlugin, annotationSchema]);



  const goldAnswerShape = annotationPlugin?.goldAnswerShape(annotationSchema) ?? "Unknown answer format";
  const goldFileExample = JSON.stringify([{
    filename: mediaPlugin?.exampleFilename ?? "sample.bin",
    answer: annotationPlugin?.createGoldExample(annotationSchema) ?? {},
  }], null, 2);

  const duplicateFiles = useMemo(() => {
    const names = files.map(file => file.name);
    return new Set(names.filter((name, index) => names.indexOf(name) !== index));
  }, [files]);


  const startBundleUpload = (fileToUpload: File) => {
    const promise = (async () => {
      setError(null);
      setBundleFile(fileToUpload);
      setBundleJobErrors([]);
      setBundleJobStatus(null);

      let expId = createdExperimentId || createdExperimentIdRef.current;
      if (!expId) {
        try {
          const expRes = await apiFetch("/api/experiments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...form,
              name: form.name.trim() || `Experiment ${new Date().toLocaleDateString()}`,
              instructions: form.instructions.trim() || "Instructions",
              status: "draft",
              label_schema: annotationSchema,
              metadata_schema: [],
              qualification_form: [],
              routing_rules: [],
            }),
          });
          const expData = await expRes.json();
          if (!expRes.ok) {
            throw new Error(typeof expData.detail === "string" ? expData.detail : "Could not create initial experiment draft");
          }
          expId = expData.id;
          createdExperimentIdRef.current = expData.id;
          setCreatedExperimentId(expData.id);
        } catch (createErr) {
          setBundleUploadStatus("failed");
          setError(createErr instanceof Error ? createErr.message : "Failed to initialize experiment for bundle upload");
          return;
        }
      }

      const controller = new AbortController();
      setBundleAbortController(controller);
      setBundleUploadStatus("uploading");

      try {
        const uploadRes = await uploadMultipartFile({
          file: fileToUpload,
          experimentId: expId,
          onProgress: setBundleProgress,
          abortSignal: controller.signal,
        });

        setBundleUploadStatus("completed");

        const jobRes = await apiFetch(`/api/experiments/${expId}/bundle-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ s3_key: uploadRes.s3_key }),
        });
        const jobData = await jobRes.json();
        if (!jobRes.ok) {
          throw new Error(jobData.detail || "Failed to queue bundle extraction job");
        }

        setBundleJobId(jobData.job_id);
        setBundleJobStatus("queued");
      } catch (uploadErr) {
        if (controller.signal.aborted) {
          setBundleUploadStatus("paused");
        } else {
          setBundleUploadStatus("failed");
          setError(uploadErr instanceof Error ? uploadErr.message : "Multipart upload failed");
        }
      }
    })();
    bundleUploadPromiseRef.current = promise;
    return promise;
  };

  const pauseBundleUpload = () => {
    bundleAbortController?.abort();
    setBundleUploadStatus("paused");
  };

  const resumeBundleUpload = () => {
    if (bundleFile) {
      startBundleUpload(bundleFile);
    }
  };

  const cancelBundleUpload = () => {
    bundleAbortController?.abort();
    if (bundleFile) {
      clearUploadCache(bundleFile);
    }
    setBundleFile(null);
    setBundleProgress(null);
    setBundleUploadStatus("idle");
    setBundleJobId(null);
    setBundleJobStatus(null);
    setBundleJobProgress(null);
    setBundleJobErrors([]);
  };

  const canContinue = (() => {
    if (step === 0) return Boolean(form.name.trim() && form.instructions.trim());
    if (step === 1) return Boolean(annotationPlugin && currentType && annotationPlugin.validateSchema(annotationSchema).length === 0);
    if (step === 2) {
      if (uploadMode === "bundle") {
        return Boolean(bundleFile && bundleUploadStatus !== "failed");
      }
      return files.length > 0 && duplicateFiles.size === 0;
    }
    return true;
  })();

  const continueGuidance = (() => {
    if (canContinue) return null;
    if (step === 0) {
      if (!form.name.trim() && !form.instructions.trim()) return "Add an experiment name and annotator instructions to continue.";
      if (!form.name.trim()) return "Add an experiment name to continue.";
      return "Add annotator instructions to continue.";
    }
    if (step === 1) return "Complete the task configuration to continue.";
    return uploadMode === "bundle"
      ? "Choose a dataset archive to finish setup."
      : "Choose at least one media file to finish setup.";
  })();

  const handleFinishSetup = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (uploadMode === "bundle") {
        if (!bundleFile) {
          throw new Error("Please select an archive file to upload");
        }
        if (bundleUploadPromiseRef.current) {
          await bundleUploadPromiseRef.current;
        }
        const expId = createdExperimentId || createdExperimentIdRef.current;
        if (!expId) {
          throw new Error("Experiment draft was not created yet. Please wait a moment and try again.");
        }
        try {
          await apiFetch(`/api/experiments/${expId}/settings`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: form.name.trim(),
              instructions: form.instructions.trim(),
              overlap_n: form.overlap_n,
              gold_ratio: form.gold_ratio,
              access_mode: form.access_mode,
            }),
          });
        } catch (settingsErr) {
          console.warn("Could not patch settings on finish setup", settingsErr);
        }

        // Ensure metadata CSV is synced
        if (metadataCsv) {
          try {
            const parsed = parseCsv(metadataCsv.replace(/^\uFEFF/, ""));
            if (parsed.length > 1) {
              const headers = parsed[0].map(h => h.trim());
              const fnIdx = headers.indexOf("filename");
              if (fnIdx >= 0) {
                const rows = parsed.slice(1).map(r => {
                  const fn = r[fnIdx]?.trim();
                  const attrs: Record<string, any> = {};
                  headers.forEach((h, i) => { if (i !== fnIdx && r[i]) attrs[h] = r[i]; });
                  return { filename: fn, attributes: attrs };
                }).filter(r => Boolean(r.filename));
                await apiFetch(`/api/experiments/${expId}/reupload-metadata`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rows }),
                });
              }
            }
          } catch (metaErr) {
            console.warn("Could not sync metadata CSV on finish setup", metaErr);
          }
        }

        // Ensure gold manifest is synced
        if (goldManifest) {
          try {
            const manifestObj = JSON.parse(goldManifest);
            if (Array.isArray(manifestObj) && manifestObj.length > 0) {
              await apiFetch(`/api/experiments/${expId}/gold-manifest`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manifest: manifestObj }),
              });
            }
          } catch (goldErr) {
            console.warn("Could not sync gold manifest on finish setup", goldErr);
          }
        }

        window.location.assign(`/experiments/${expId}`);
        return;
      }

      // Individual files mode
      if (!files.length) {
        throw new Error("Please select at least one media file");
      }
      if (duplicateFiles.size > 0) {
        throw new Error(`Duplicate filenames are not allowed: ${[...duplicateFiles].join(", ")}`);
      }

      const inferredMetadataSchema: Array<{ key: string; label: string; type: string; options: string[] }> = [];
      if (metadataCsv) {
        try {
          const parsed = parseCsv(metadataCsv.replace(/^\uFEFF/, ""));
          if (parsed.length > 0) {
            const headers = parsed[0].map(h => h.trim()).filter(h => h && h !== "filename");
            for (const h of headers) {
              inferredMetadataSchema.push({
                key: h,
                label: h.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                type: "text",
                options: [],
              });
            }
          }
        } catch (e) {
          console.warn("Could not parse metadata headers for schema", e);
        }
      }

      const experimentResponse = await apiFetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          instructions: form.instructions.trim(),
          status: "draft",
          label_schema: annotationSchema,
          metadata_schema: inferredMetadataSchema,
          qualification_form: [],
          routing_rules: [],
        }),
      });
      const experimentBody = await experimentResponse.json();
      if (!experimentResponse.ok) {
        throw new Error(typeof experimentBody.detail === "string" ? experimentBody.detail : "Invalid experiment configuration");
      }
      const expId = experimentBody.id;

      const presignResponse = await apiFetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: files.map(file => file.name), experiment_id: expId }),
      });
      if (!presignResponse.ok) throw new Error("Could not prepare file uploads");
      const presigned = (await presignResponse.json()).urls;

      const metadataByFilename = new Map<string, Record<string, any>>();
      if (metadataCsv) {
        try {
          const parsed = parseCsv(metadataCsv.replace(/^\uFEFF/, ""));
          if (parsed.length > 1) {
            const headers = parsed[0].map(h => h.trim());
            const fnIdx = headers.indexOf("filename");
            if (fnIdx >= 0) {
              parsed.slice(1).forEach(r => {
                const fn = r[fnIdx]?.trim();
                if (fn) {
                  const attrs: Record<string, any> = {};
                  headers.forEach((h, i) => { if (i !== fnIdx && r[i]) attrs[h] = r[i]; });
                  metadataByFilename.set(fn, attrs);
                }
              });
            }
          }
        } catch (e) {
          console.error("Error parsing metadata CSV for individual files", e);
        }
      }

      const dataUnits = await Promise.all(files.map(async file => {
        const target = presigned.find((item: any) => item.filename === file.name);
        if (!target) throw new Error(`Missing upload URL for ${file.name}`);
        setUploadStatus(current => ({ ...current, [file.name]: "Uploading" }));
        const response = await fetch(target.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!response.ok) throw new Error(`Upload failed: ${file.name}`);
        setUploadStatus(current => ({ ...current, [file.name]: "Uploaded" }));
        return { raw_uri: target.s3_uri, metadata: metadataByFilename.get(file.name) ?? {} };
      }));

      const unitsResponse = await apiFetch(`/api/experiments/${expId}/data-units`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: dataUnits }),
      });
      const unitsData = await unitsResponse.json();
      if (!unitsResponse.ok) throw new Error(unitsData.detail || "Could not register dataset");

      if (metadataCsv) {
        try {
          const parsed = parseCsv(metadataCsv.replace(/^\uFEFF/, ""));
          if (parsed.length > 1) {
            const headers = parsed[0].map(h => h.trim());
            const fnIdx = headers.indexOf("filename");
            if (fnIdx >= 0) {
              const rows = parsed.slice(1).map(r => {
                const fn = r[fnIdx]?.trim();
                const attrs: Record<string, any> = {};
                headers.forEach((h, i) => { if (i !== fnIdx && r[i]) attrs[h] = r[i]; });
                return { filename: fn, attributes: attrs };
              }).filter(r => Boolean(r.filename));
              await apiFetch(`/api/experiments/${expId}/reupload-metadata`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows }),
              });
            }
          }
        } catch (e) {
          console.error("Error saving pending metadata for individual files", e);
        }
      }

      if (goldManifest) {
        try {
          const manifestObj = JSON.parse(goldManifest);
          if (Array.isArray(manifestObj) && manifestObj.length > 0) {
            await apiFetch(`/api/experiments/${expId}/gold-manifest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ manifest: manifestObj }),
            });
          }
        } catch (e) {
          console.error("Error saving gold manifest", e);
        }
      }

      window.location.assign(`/experiments/${expId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create experiment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wizard-shell">
      <nav className="wizard-progress" aria-label="Experiment setup progress">
        <ol className="wizard-steps">
        {steps.map((label, index) => (
          <li
            key={label}
            className={`wizard-step ${index === step ? "current" : ""} ${index < step ? "complete" : ""}`}
            aria-current={index === step ? "step" : undefined}
            aria-label={`${label}, ${index === step ? "current" : index < step ? "completed" : "upcoming"} step`}
          >
            <span aria-hidden="true">{index < step ? <Check size={15} /> : index + 1}</span>
            <span className="wizard-step-label">{label}</span>
          </li>
        ))}
        </ol>
      </nav>

      <div className="glass-panel wizard-panel">
        <div className="wizard-title"><Settings size={24} className="app-logo-icon" aria-hidden="true" /><div><span className="wizard-step-count">Step {step + 1} of {steps.length}</span><h2>{steps[step]}</h2><p>{[
          "Name the experiment, explain the work, and choose how annotators join.",
          "Choose what annotators will submit.",
          "Add media files or an archive, optional metadata, and gold answers.",
        ][step]}</p></div></div>

        {/* Sticky Bundle Status Banner */}
        {uploadMode === "bundle" && bundleJobStatus && (
          <div className={`bundle-status-banner ${bundleJobStatus}`}>
            <div className="bundle-banner-content">
              <div className="bundle-banner-icon">
                {(bundleJobStatus === "processing" || bundleJobStatus === "queued") && (
                  <Loader2 size={24} className="spin-animate text-blue-600" />
                )}
                {bundleJobStatus === "completed" && (
                  <Check size={24} className="text-emerald-600" />
                )}
                {bundleJobStatus === "failed" && (
                  <AlertCircle size={24} className="text-rose-600" />
                )}
              </div>
              <div className="bundle-banner-text">
                {(bundleJobStatus === "processing" || bundleJobStatus === "queued") && (
                  <>
                    <strong>Dataset Archive Processing in Background</strong>
                    <p>
                      Extracting &amp; registering files ({bundleJobProgress?.files_processed ?? 0}/{bundleJobProgress?.files_total ?? "?"} files).
                      You can continue configuring qualifications, teaching examples, and routing rules below.
                    </p>
                  </>
                )}
                {bundleJobStatus === "completed" && (
                  <>
                    <strong>Dataset Archive Ready</strong>
                    <p>
                      Extraction complete! {bundleJobApplied.length} files successfully registered.
                      You can optionally upload metadata CSV or gold answers in Step 3.
                    </p>
                  </>
                )}
                {bundleJobStatus === "failed" && (
                  <>
                    <strong>Dataset Archive Processing Encountered Errors</strong>
                    <p>
                      {bundleJobErrors.length} error(s) detected. Review the error details below or retry upload.
                    </p>
                  </>
                )}
              </div>
            </div>
            {bundleJobStatus === "failed" && (
              <div className="bundle-banner-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowBundleErrorDetails(prev => !prev)}
                >
                  {showBundleErrorDetails ? "Hide Errors" : "View Errors"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    if (bundleFile) {
                      startBundleUpload(bundleFile);
                    } else {
                      cancelBundleUpload();
                    }
                    setStep(2);
                  }}
                >
                  <RefreshCw size={15} /> Retry Upload
                </button>
              </div>
            )}
          </div>
        )}

        {step === 0 && <div className="flex-col">
          <div className="wizard-basics-grid">
            <div className="form-group"><label className="form-label" htmlFor="experiment-name">Experiment name</label><input id="experiment-name" className="form-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Hindi speech quality" /></div>
            <div className="form-group"><label className="form-label" htmlFor="experiment-media-type">Media type</label><select id="experiment-media-type" className="form-select" value={form.modality} onChange={event => { setForm({ ...form, modality: event.target.value }); setFiles([]); }}>{listMediaPlugins().map(plugin => <option key={plugin.key} value={plugin.key}>{plugin.name}</option>)}</select></div>
          </div>
          <div className="form-group"><label className="form-label" htmlFor="experiment-instructions">Instructions for annotators</label><textarea id="experiment-instructions" className="form-textarea wizard-instructions" value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} placeholder="Explain what a good annotation looks like…" /></div>
          <div className="form-group">
            <label className="form-label">How should annotators join?</label>
            <div className="access-mode-grid">
              {[
                { value: "sign_in_required", title: "Sign-in required", description: "Verified Clerk account. Best for controlled teams and reliable identity." },
                { value: "guest_name", title: "Name required", description: "No account needed. The annotator enters a name and is tracked by session." },
                { value: "anonymous", title: "Fully anonymous", description: "No account or name. Only a private session identifier is recorded." },
              ].map(option => (
                <button
                  type="button"
                  key={option.value}
                  className={`access-mode-card ${form.access_mode === option.value ? "selected" : ""}`}
                  aria-pressed={form.access_mode === option.value}
                  onClick={() => setForm({ ...form, access_mode: option.value })}
                >
                  <span className="selection-card-heading"><strong>{option.title}</strong>{form.access_mode === option.value && <CheckCircle2 size={17} aria-hidden="true" />}</span><span>{option.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>}

        {step === 1 && <div className="task-config-layout">
          <div className="flex-col">
            <div className="task-type-grid">{availableTypes.map(type => { const plugin = getAnnotationPlugin(type.key); const selected = annotationType === type.key; return <button type="button" key={type.key} className={`task-type-card ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => { if (plugin && mediaPlugin) setAnnotationSchema(plugin.defaultSchema(mediaPlugin.moduleContext)); }}><span className="selection-card-heading"><strong>{type.name}</strong>{selected && <CheckCircle2 size={17} aria-hidden="true" />}</span><span>{plugin?.description(mediaPlugin?.name ?? "media")}</span></button>; })}</div>
            {annotationPlugin && <annotationPlugin.ConfigurationEditor schema={annotationSchema} onChange={setAnnotationSchema} />}
            <div className="config-preview">
              <span>Interactive annotator preview</span>
              {annotationPlugin?.PreviewInteractionEditor && <annotationPlugin.PreviewInteractionEditor schema={annotationSchema} answer={preparedPreviewAnswer} onChange={setPreviewAnswer} />}
              <AnnotationControl
                schema={annotationSchema}
                answer={preparedPreviewAnswer}
                onChange={setPreviewAnswer}
              />
              <div className="preview-payload">
                <span>Answer payload</span>
                <code>{JSON.stringify(preparedPreviewAnswer)}</code>
              </div>
            </div>
          </div>
          <aside className="gold-format-panel" aria-label="Optional gold answer format">
            <div className="gold-format-heading"><h3>Gold answer format</h3><span>Optional</span></div>
            <p>Upload one JSON array. Each gold sample needs its exact media filename and the known correct answer.</p>
            <div className="gold-format-field"><span>Top level</span><code>Array&lt;GoldSample&gt;</code></div>
            <div className="gold-format-field"><span>Each item</span><code>{`{ filename, answer }`}</code></div>
            <div className="gold-format-field"><span>Answer</span><code>{goldAnswerShape}</code></div>
            <pre className="gold-format-example"><code>{goldFileExample}</code></pre>
            <ul>
              <li><code>filename</code> must exactly match an uploaded media filename.</li>
              {annotationPlugin?.goldInstructions(annotationSchema).map(instruction => <li key={instruction}>{instruction}</li>)}
              <li>Only include samples that should act as quality checks.</li>
            </ul>
          </aside>
        </div>}

        {step === 2 && <div className="flex-col">
          <div className="upload-mode-selector">
            <button
              type="button"
              className={`upload-mode-card ${uploadMode === "files" ? "active" : ""}`}
              aria-pressed={uploadMode === "files"}
              onClick={() => {
                setUploadMode("files");
                setError(null);
              }}
            >
              <span className="upload-mode-heading"><Files size={18} aria-hidden="true" /><strong>Individual Media Files</strong>{uploadMode === "files" && <CheckCircle2 size={17} aria-hidden="true" />}</span>
              <span>Upload media files directly from your computer (best for small datasets &lt; 50MB)</span>
            </button>
            <button
              type="button"
              className={`upload-mode-card ${uploadMode === "bundle" ? "active" : ""}`}
              aria-pressed={uploadMode === "bundle"}
              onClick={() => {
                setUploadMode("bundle");
                setError(null);
              }}
            >
              <span className="upload-mode-heading"><FileArchive size={18} aria-hidden="true" /><strong>Single Archive (.zip) for Large Datasets</strong>{uploadMode === "bundle" && <CheckCircle2 size={17} aria-hidden="true" />}</span>
              <span>Resumable, chunked parallel upload with background extraction (supports multi-GB)</span>
            </button>
          </div>

          {uploadMode === "files" ? (
            <>
              <div className="bundle-grid">
                <label className={`dropzone ${files.length ? "loaded" : ""}`}>{files.length ? <CheckCircle2 className="dropzone-icon" /> : <UploadCloud className="dropzone-icon" />}<strong>1. {files.length ? `${files.length} media file${files.length === 1 ? "" : "s"} selected` : mediaPlugin?.uploadTitle ?? "Choose media files"}</strong><span>{files.length ? "Choose again to replace this selection" : mediaPlugin?.uploadHelp ?? "Choose supported media files"}</span><input type="file" multiple accept={mediaPlugin?.accept} hidden onChange={event => { setFiles(Array.from(event.target.files ?? [])); }} /></label>
                <label className={`dropzone compact ${metadataCsv ? "loaded" : ""}`}>{metadataCsv ? <CheckCircle2 className="dropzone-icon" /> : <UploadCloud className="dropzone-icon" />}<strong>2. Upload metadata CSV (optional)</strong><span>{metadataCsv ? "CSV loaded — choose another to replace it" : 'Must contain a "filename" column'}</span><input type="file" accept=".csv,text/csv" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setMetadataCsv(await file.text()); } }} /></label>
                <label className={`dropzone compact ${goldManifest ? "loaded" : ""}`}>{goldManifest ? <CheckCircle2 className="dropzone-icon" /> : <UploadCloud className="dropzone-icon" />}<strong>3. Upload gold answers JSON (optional)</strong><span>{goldManifest ? "JSON loaded — choose another to replace it" : "Only include samples used as quality checks"}</span><input type="file" accept=".json,application/json" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setGoldManifest(await file.text()); } }} /></label>
              </div>
              {(metadataCsv || goldManifest) && <div className="bundle-actions">{metadataCsv && <button type="button" className="btn btn-secondary" onClick={() => { setMetadataCsv(""); }}>Remove metadata CSV</button>}{goldManifest && <button type="button" className="btn btn-secondary" onClick={() => { setGoldManifest(""); }}>Remove gold JSON</button>}</div>}
              {files.length > 0 && <div className="file-list">{files.map(file => <div key={`${file.name}-${file.size}`}><span>{file.name}</span><span>{uploadStatus[file.name] || `${(file.size / 1024).toFixed(0)} KB`}</span></div>)}</div>}
              {duplicateFiles.size > 0 && <p className="form-error">Duplicate filenames are not allowed: {[...duplicateFiles].join(", ")}</p>}
              <details><summary>Input formats</summary><p className="help-text">Metadata CSV example: <code>filename,language,difficulty</code>. Gold JSON uses the format shown on the Task step; for this modality an example filename is <code>{mediaPlugin?.exampleFilename}</code>. Filenames must match the selected media exactly.</p></details>
            </>
          ) : (
            <>
              {!bundleFile ? (
                <label className="dropzone archive-dropzone">
                  <FileArchive className="dropzone-icon archive-icon" />
                  <strong>Choose a Dataset Archive (.zip)</strong>
                  <span>Archive must contain a top-level <code>media/</code> folder. Up to several GB supported.</span>
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    hidden
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (file) {
                        startBundleUpload(file);
                      }
                    }}
                  />
                </label>
              ) : (
                <div className="bundle-upload-card">
                  <div className="bundle-file-info">
                    <strong>{bundleFile.name}</strong>
                    <span>{(bundleFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                  </div>

                  <div className="bundle-progress-track">
                    <div
                      className="bundle-progress-fill"
                      style={{ transform: `scaleX(${(bundleProgress?.percent ?? 0) / 100})` }}
                    />
                  </div>

                  <div className="bundle-progress-meta">
                    <span>
                      {bundleUploadStatus === "uploading" && `Uploading: ${bundleProgress?.percent.toFixed(1) ?? "0"}%`}
                      {bundleUploadStatus === "paused" && "Upload paused"}
                      {bundleUploadStatus === "completed" && (
                        bundleJobStatus === "processing" || bundleJobStatus === "queued"
                          ? "Archive uploaded. Extracting files in background..."
                          : bundleJobStatus === "failed"
                            ? "Archive extraction encountered errors"
                            : "Upload completed"
                      )}
                      {bundleUploadStatus === "failed" && "Upload encountered an error"}
                      {bundleUploadStatus === "idle" && "Ready to upload"}
                    </span>
                    <span>
                      {((bundleProgress?.uploadedBytes ?? 0) / (1024 * 1024)).toFixed(1)} MB / {(bundleFile.size / (1024 * 1024)).toFixed(1)} MB
                      {bundleProgress ? ` (${bundleProgress.completedParts}/${bundleProgress.totalParts} chunks)` : ""}
                    </span>
                  </div>

                  {error && (bundleUploadStatus === "failed" || bundleJobStatus === "failed") && (
                    <div className="bundle-inline-error">
                      <AlertCircle size={15} />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="bundle-upload-controls">
                    {bundleUploadStatus === "uploading" && (
                      <button type="button" className="btn btn-secondary" onClick={pauseBundleUpload}>
                        <Pause size={15} /> Pause
                      </button>
                    )}
                    {bundleUploadStatus === "paused" && (
                      <button type="button" className="btn btn-primary" onClick={resumeBundleUpload}>
                        <Play size={15} /> Resume Upload
                      </button>
                    )}
                    {(bundleUploadStatus === "failed" || bundleJobStatus === "failed" || bundleUploadStatus === "idle") && (
                      <button type="button" className="btn btn-primary" onClick={resumeBundleUpload}>
                        <RefreshCw size={15} /> Retry Upload
                      </button>
                    )}
                    {(bundleUploadStatus === "failed" || bundleJobStatus === "failed" || bundleUploadStatus === "idle") ? (
                      <button type="button" className="btn btn-secondary" onClick={cancelBundleUpload}>
                        <X size={15} /> Select Another Archive
                      </button>
                    ) : (
                      (bundleUploadStatus === "uploading" || bundleUploadStatus === "paused") && (
                        <button type="button" className="btn btn-secondary" onClick={cancelBundleUpload}>
                          <X size={15} /> Cancel
                        </button>
                      )
                    )}
                  </div>

                  {bundleJobErrors.length > 0 && (
                    <div className="bundle-error-panel">
                      <strong className="bundle-error-title">
                        Archive Processing Errors ({bundleJobErrors.length})
                      </strong>
                      <table className="bundle-error-table">
                        <thead>
                          <tr>
                            <th>File</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bundleJobErrors.map((err, idx) => (
                            <tr key={idx}>
                              <td>{err.filename}</td>
                              <td>{err.error}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="bundle-followups">
                    <p className="help-text bundle-followup-intro">
                      <strong>Optional Follow-ups:</strong> Add metadata attributes or gold answers referencing the files in your archive.
                    </p>
                    <div className="bundle-grid bundle-followup-grid">
                      <label className="dropzone compact">
                        <UploadCloud className="dropzone-icon" />
                        <strong>Upload metadata CSV (optional)</strong>
                        <span>{metadataCsv ? "CSV loaded — choose another to replace it" : 'Must contain a "filename" column'}</span>
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          hidden
                          onChange={async event => {
                            const file = event.target.files?.[0];
                            if (file) {
                              const text = await file.text();
                              setMetadataCsv(text);
                              const targetExpId = createdExperimentId || createdExperimentIdRef.current;
                              if (targetExpId) {
                                try {
                                  const parsed = parseCsv(text.replace(/^\uFEFF/, ""));
                                  if (parsed.length > 1) {
                                    const headers = parsed[0].map(h => h.trim());
                                    const fnIdx = headers.indexOf("filename");
                                    if (fnIdx >= 0) {
                                      const rows = parsed.slice(1).map(r => {
                                        const fn = r[fnIdx]?.trim();
                                        const attrs: Record<string, any> = {};
                                        headers.forEach((h, i) => { if (i !== fnIdx && r[i]) attrs[h] = r[i]; });
                                        return { filename: fn, attributes: attrs };
                                      }).filter(r => Boolean(r.filename));
                                      await apiFetch(`/api/experiments/${targetExpId}/reupload-metadata`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ rows }),
                                      });
                                    }
                                  }
                                } catch (e) {
                                  console.error("Failed to sync reupload-metadata", e);
                                }
                              }
                            }
                          }}
                        />
                      </label>
                      <label className="dropzone compact">
                        <UploadCloud className="dropzone-icon" />
                        <strong>Upload gold answers JSON (optional)</strong>
                        <span>{goldManifest ? "JSON loaded — choose another to replace it" : "Only include samples used as quality checks"}</span>
                        <input
                          type="file"
                          accept=".json,application/json"
                          hidden
                          onChange={async event => {
                            const file = event.target.files?.[0];
                            if (file) {
                              const text = await file.text();
                              setGoldManifest(text);
                              const targetExpId = createdExperimentId || createdExperimentIdRef.current;
                              if (targetExpId) {
                                try {
                                  const manifestObj = JSON.parse(text);
                                  if (Array.isArray(manifestObj)) {
                                    await apiFetch(`/api/experiments/${targetExpId}/gold-manifest`, {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ manifest: manifestObj }),
                                    });
                                  }
                                } catch (e) {
                                  console.error("Failed to sync gold manifest", e);
                                }
                              }
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>}
        <div className="wizard-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={step === 0 || submitting}
            onClick={() => setStep(value => value - 1)}
          >
            <ArrowLeft size={17} /> Back
          </button>
          <div className="wizard-action-primary">
            {continueGuidance && <p id="wizard-action-guidance" className="wizard-action-guidance" aria-live="polite">{continueGuidance}</p>}
            {step < steps.length - 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canContinue}
                aria-describedby={!canContinue ? "wizard-action-guidance" : undefined}
                onClick={() => setStep(value => value + 1)}
              >
                Continue <ArrowRight size={17} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || !canContinue}
                aria-describedby={!canContinue ? "wizard-action-guidance" : undefined}
                onClick={handleFinishSetup}
              >
                {submitting ? <><Loader2 size={17} className="spin-animate" /> Saving setup…</> : <>Finish setup <Check size={17} /></>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
