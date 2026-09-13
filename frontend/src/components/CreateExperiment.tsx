import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Settings, Trash2, UploadCloud } from "lucide-react";
import AnnotationControl from "./annotator/AnnotationControl";
import type { AnnotationAnswer, LabelSchema } from "./annotator/types";
import AnnotationOverlaySelector, { buildOverlayOptions } from "./AnnotationOverlaySelector";
import { getAnnotationPlugin } from "../plugins/annotations/registry";
import { getMediaPlugin, listMediaPlugins, supportsAnnotation } from "../plugins/media/registry";
import { apiFetch } from "../api";
import {
  parseDatasetBundle,
  validateGold,
  type MetadataFieldDefinition,
  type ParsedDatasetRow,
} from "./datasetBundle";
import {
  isDatasetAssemblyCurrent,
  schemaFingerprint,
} from "./experimentDraft";

interface AnnotationTypeInfo {
  key: string;
  name: string;
  compatible_modalities: string[];
  supports_choices: boolean;
  supports_multi_select: boolean;
  required_interaction: string;
}

interface QualificationQuestion {
  key: string;
  label: string;
  type: "single_choice" | "multi_choice" | "boolean" | "number" | "text";
  required: boolean;
  options: string[];
  minimum?: number;
  maximum?: number;
}

interface RoutingRule {
  metadata_field: string;
  operator: "equals" | "in" | "gte";
  question_key: string;
}

const steps = ["Basics", "Task", "Dataset bundle", "Dataset preview", "Qualifications", "Review"];

const routingOperatorFor = (
  field: MetadataFieldDefinition | undefined,
  question: QualificationQuestion | undefined,
): RoutingRule["operator"] | null => {
  if (!field || !question) return null;
  if (field.type === "number" && question.type === "number") return "gte";
  if (field.type === "boolean" && question.type === "boolean") return "equals";
  if (["text", "choice"].includes(field.type) && question.type === "multi_choice") return "in";
  if (["text", "choice"].includes(field.type) && question.type === "single_choice") return "equals";
  return null;
};

export default function CreateExperiment() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    modality: "audio",
    instructions: "",
    overlap_n: 2,
    gold_ratio: 0.1,
    access_mode: "guest_name",
  });
  const [annotationTypes, setAnnotationTypes] = useState<AnnotationTypeInfo[]>([]);
  const [annotationSchema, setAnnotationSchema] = useState<LabelSchema>(() =>
    getAnnotationPlugin("categorical")!.defaultSchema(getMediaPlugin("audio")!.moduleContext),
  );
  const annotationType = annotationSchema.annotation_type;
  const [previewAnswer, setPreviewAnswer] = useState<AnnotationAnswer>({});
  const [files, setFiles] = useState<File[]>([]);
  const [metadataFields, setMetadataFields] = useState<MetadataFieldDefinition[]>([]);
  const [metadataCsv, setMetadataCsv] = useState("");
  const [datasetRows, setDatasetRows] = useState<ParsedDatasetRow[]>([]);
  const [datasetErrors, setDatasetErrors] = useState<string[]>([]);
  const [assembledSchemaFingerprint, setAssembledSchemaFingerprint] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<QualificationQuestion[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [goldManifest, setGoldManifest] = useState("");
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      && supportsAnnotation(mediaPlugin, plugin.requiredInteraction),
    );
  });
  const currentType = availableTypes.find(type => type.key === annotationType);
  const annotationPlugin = getAnnotationPlugin(annotationType);
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

  useEffect(() => {
    const urls = Object.fromEntries(files.map(file => [file.name, URL.createObjectURL(file)]));
    setMediaUrls(urls);
    return () => Object.values(urls).forEach(url => URL.revokeObjectURL(url));
  }, [files]);

  const goldAnswerShape = annotationPlugin?.goldAnswerShape(annotationSchema) ?? "Unknown answer format";
  const goldFileExample = JSON.stringify([{
    filename: mediaPlugin?.exampleFilename ?? "sample.bin",
    answer: annotationPlugin?.createGoldExample(annotationSchema) ?? {},
  }], null, 2);

  const duplicateFiles = useMemo(() => {
    const names = files.map(file => file.name);
    return new Set(names.filter((name, index) => names.indexOf(name) !== index));
  }, [files]);
  const goldCount = datasetRows.filter(row => row.goldAnswer).length;
  const regularCount = datasetRows.length - goldCount;
  const datasetAssemblyCurrent = isDatasetAssemblyCurrent(
    assembledSchemaFingerprint,
    annotationSchema,
  );

  const addQuestion = () => {
    let index = questions.length + 1;
    while (questions.some(question => question.key === `question_${index}`)) index += 1;
    const field = metadataFields[0];
    const metadataValues = field
      ? [...new Set(datasetRows.map(row => row.metadata[field.key]).filter(value => value !== undefined).map(String))]
      : [];
    const isLanguage = field?.key === "language";
    const type: QualificationQuestion["type"] = field?.type === "number"
      ? "number"
      : field?.type === "boolean"
        ? "boolean"
        : "multi_choice";
    const label = !field
      ? "Which skills or languages do you have?"
      : isLanguage
        ? "Which languages can you understand?"
        : field.type === "number"
          ? `What is the highest ${field.label.toLowerCase()} you can handle?`
          : field.type === "boolean"
            ? `Can you work with samples where ${field.label.toLowerCase()} is required?`
            : `Which ${field.label.toLowerCase()} options can you work with?`;
    setQuestions(current => [...current, {
      key: `question_${index}`,
      label,
      type,
      required: true,
      options: type.includes("choice") ? (field?.options.length ? field.options : metadataValues) : [],
      minimum: type === "number" ? 0 : undefined,
      maximum: type === "number" ? Math.max(5, ...metadataValues.map(Number).filter(Number.isFinite)) : undefined,
    }]);
  };

  const updateQuestion = (index: number, patch: Partial<QualificationQuestion>) => {
    setQuestions(current => current.map((question, position) => position === index ? { ...question, ...patch } : question));
  };

  const addRule = () => {
    if (!metadataFields.length || !questions.length) return;
    const pair = metadataFields.flatMap(field => questions.map(question => ({ field, question })))
      .find(({ field, question }) => routingOperatorFor(field, question));
    if (!pair) return;
    setRules(current => [...current, {
      metadata_field: pair.field.key,
      operator: routingOperatorFor(pair.field, pair.question)!,
      question_key: pair.question.key,
    }]);
  };

  const canContinue = (() => {
    if (step === 0) return Boolean(form.name.trim() && form.instructions.trim());
    if (step === 1) return Boolean(annotationPlugin && currentType && annotationPlugin.validateSchema(annotationSchema).length === 0);
    if (step === 2) return files.length > 0 && duplicateFiles.size === 0;
    if (step === 3) return datasetAssemblyCurrent && datasetRows.length > 0 && datasetErrors.length === 0 && datasetRows.every(row => row.errors.length === 0);
    if (step === 4) return questions.every(question => question.label.trim() && (!question.type.includes("choice") || question.options.length > 0));
    return true;
  })();

  const assembleDataset = () => {
    setError(null);
    try {
      const parsed = parseDatasetBundle(files.map(file => file.name), metadataCsv, goldManifest, { schema: annotationSchema });
      setMetadataFields(parsed.metadataFields);
      setDatasetRows(parsed.rows);
      setDatasetErrors(parsed.errors);
      setAssembledSchemaFingerprint(schemaFingerprint(annotationSchema));
      setRules([]);
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read the dataset bundle");
    }
  };

  const updateRowMetadata = (filename: string, key: string, value: string | number | boolean | undefined) => {
    setDatasetRows(current => current.map(row => {
      if (row.filename !== filename) return row;
      const metadata = { ...row.metadata };
      if (value === undefined) delete metadata[key];
      else metadata[key] = value;
      return {
        ...row,
        metadata,
        errors: row.errors.filter(message => message !== "No metadata row matches this media file"),
      };
    }));
  };

  const updateRowGold = (filename: string, text: string) => {
    setDatasetRows(current => current.map(row => {
      if (row.filename !== filename) return row;
      const metadataErrors = row.errors.filter(message => message === "No metadata row matches this media file");
      if (!text.trim()) return { ...row, goldAnswer: null, errors: metadataErrors };
      try {
        const answer = JSON.parse(text) as Record<string, unknown>;
        return {
          ...row,
          goldAnswer: answer,
          errors: [...metadataErrors, ...validateGold(answer, { schema: annotationSchema })],
        };
      } catch {
        return { ...row, errors: [...metadataErrors, "Gold answer is not valid JSON"] };
      }
    }));
  };

  const deploy = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (!datasetRows.length || datasetErrors.length || datasetRows.some(row => row.errors.length)) {
        throw new Error("Return to the dataset preview and resolve its validation errors");
      }
      if (!datasetAssemblyCurrent) {
        throw new Error("The annotation task changed. Reassemble the dataset so its gold answers are validated against the current task");
      }
      if (form.gold_ratio > 0 && goldCount === 0) {
        throw new Error('Add at least one gold answer or set quality-check frequency to "None"');
      }
      const datasetByFilename = new Map(datasetRows.map(row => [row.filename, row]));

      const experimentResponse = await apiFetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          status: "draft",
          label_schema: annotationSchema,
          metadata_schema: metadataFields,
          qualification_form: questions,
          routing_rules: rules,
        }),
      });
      const experimentBody = await experimentResponse.json();
      if (!experimentResponse.ok) throw new Error(typeof experimentBody.detail === "string" ? experimentBody.detail : "Invalid experiment configuration");

      const presignResponse = await apiFetch("/api/uploads/presign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames: files.map(file => file.name) }),
      });
      if (!presignResponse.ok) throw new Error("Could not prepare file uploads");
      const presigned = (await presignResponse.json()).urls;
      const dataUnits = await Promise.all(files.map(async file => {
        const target = presigned.find((item: any) => item.filename === file.name);
        if (!target) throw new Error(`Missing upload URL for ${file.name}`);
        setUploadStatus(current => ({ ...current, [file.name]: "Uploading" }));
        const response = await fetch(target.upload_url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!response.ok) throw new Error(`Upload failed: ${file.name}`);
        setUploadStatus(current => ({ ...current, [file.name]: "Uploaded" }));
        return { raw_uri: target.s3_uri, metadata: datasetByFilename.get(file.name)?.metadata ?? {} };
      }));

      const unitsResponse = await apiFetch(`/api/experiments/${experimentBody.id}/data-units`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: dataUnits }),
      });
      if (!unitsResponse.ok) throw new Error((await unitsResponse.json()).detail || "Could not register dataset");

      const goldEntries = datasetRows
        .filter(row => row.goldAnswer)
        .map(row => ({ filename: row.filename, answer: row.goldAnswer }));
      if (goldEntries.length) {
        const goldResponse = await apiFetch(`/api/experiments/${experimentBody.id}/gold-manifest`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: goldEntries }),
        });
        const result = await goldResponse.json();
        if (!goldResponse.ok || result.errors?.length) throw new Error(result.errors?.[0]?.error || "Could not apply gold answers");
      }

      const deployResponse = await apiFetch(`/api/experiments/${experimentBody.id}/deploy`, { method: "POST" });
      if (!deployResponse.ok) throw new Error((await deployResponse.json()).detail || "Could not deploy experiment");
      window.location.assign(`/experiments/${experimentBody.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create experiment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="wizard-shell">
      <div className="wizard-steps">
        {steps.map((label, index) => (
          <div key={label} className={`wizard-step ${index === step ? "current" : ""} ${index < step ? "complete" : ""}`}>
            <span>{index < step ? <Check size={15} /> : index + 1}</span>{label}
          </div>
        ))}
      </div>

      <div className="glass-panel wizard-panel">
        <div className="wizard-title"><Settings size={24} className="app-logo-icon" /><div><h2>{steps[step]}</h2><p>{[
          "Name the experiment, explain the work, and choose how annotators join.",
          "Choose what annotators will submit.",
          "Add media, metadata, and gold answers together.",
          "Inspect every assembled sample before upload.",
          "Decide which annotators are eligible for each type of sample.",
          "Confirm quality settings and deploy.",
        ][step]}</p></div></div>

        {step === 0 && <div className="flex-col">
          <div className="form-group"><label className="form-label">Experiment name</label><input className="form-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Hindi speech quality" /></div>
          <div className="form-group"><label className="form-label">Instructions for annotators</label><textarea className="form-textarea" value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} placeholder="Explain what a good annotation looks like…" /></div>
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
                  onClick={() => setForm({ ...form, access_mode: option.value })}
                >
                  <strong>{option.title}</strong><span>{option.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="form-group"><label className="form-label">Media type</label><select className="form-select" value={form.modality} onChange={event => { setForm({ ...form, modality: event.target.value }); setFiles([]); setDatasetRows([]); }}>{listMediaPlugins().map(plugin => <option key={plugin.key} value={plugin.key}>{plugin.name}</option>)}</select></div>
        </div>}

        {step === 1 && <div className="task-config-layout">
          <div className="flex-col">
            <div className="task-type-grid">{availableTypes.map(type => { const plugin = getAnnotationPlugin(type.key); return <button type="button" key={type.key} className={`task-type-card ${annotationType === type.key ? "selected" : ""}`} onClick={() => { if (plugin && mediaPlugin) setAnnotationSchema(plugin.defaultSchema(mediaPlugin.moduleContext)); }}><strong>{type.name}</strong><span>{plugin?.description(mediaPlugin?.name ?? "media")}</span></button>; })}</div>
            {annotationPlugin && <annotationPlugin.ConfigurationEditor schema={annotationSchema} onChange={setAnnotationSchema} />}
            <div className="config-preview">
              <span>Interactive annotator preview</span>
              {annotationPlugin?.PreviewInteractionEditor && <annotationPlugin.PreviewInteractionEditor schema={annotationSchema} answer={previewAnswer} onChange={setPreviewAnswer} />}
              <AnnotationControl
                schema={annotationSchema}
                answer={previewAnswer}
                onChange={setPreviewAnswer}
              />
              <div className="preview-payload">
                <span>Answer payload</span>
                <code>{JSON.stringify(previewAnswer)}</code>
              </div>
            </div>
          </div>
          <aside className="gold-format-panel" aria-label="Required gold dataset format">
            <span className="gold-format-kicker">Gold data format</span>
            <h3>JSON file required</h3>
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
          <div className="bundle-grid">
            <label className="dropzone"><UploadCloud className="dropzone-icon" /><strong>1. {mediaPlugin?.uploadTitle ?? "Choose media files"}</strong><span>{mediaPlugin?.uploadHelp ?? "Choose supported media files"}</span><input type="file" multiple accept={mediaPlugin?.accept} hidden onChange={event => { setFiles(Array.from(event.target.files ?? [])); setDatasetRows([]); }} /></label>
            <label className="dropzone compact"><UploadCloud className="dropzone-icon" /><strong>2. Upload metadata CSV (optional)</strong><span>{metadataCsv ? "CSV loaded — choose another to replace it" : 'Must contain a "filename" column'}</span><input type="file" accept=".csv,text/csv" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setMetadataCsv(await file.text()); setDatasetRows([]); } }} /></label>
            <label className="dropzone compact"><UploadCloud className="dropzone-icon" /><strong>3. Upload gold answers JSON (optional)</strong><span>{goldManifest ? "JSON loaded — choose another to replace it" : "Only include samples used as quality checks"}</span><input type="file" accept=".json,application/json" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setGoldManifest(await file.text()); setDatasetRows([]); } }} /></label>
          </div>
          {(metadataCsv || goldManifest) && <div className="bundle-actions">{metadataCsv && <button type="button" className="btn btn-secondary" onClick={() => { setMetadataCsv(""); setDatasetRows([]); }}>Remove metadata CSV</button>}{goldManifest && <button type="button" className="btn btn-secondary" onClick={() => { setGoldManifest(""); setDatasetRows([]); }}>Remove gold JSON</button>}</div>}
          {files.length > 0 && <div className="file-list">{files.map(file => <div key={`${file.name}-${file.size}`}><span>{file.name}</span><span>{uploadStatus[file.name] || `${(file.size / 1024).toFixed(0)} KB`}</span></div>)}</div>}
          {duplicateFiles.size > 0 && <p className="form-error">Duplicate filenames are not allowed: {[...duplicateFiles].join(", ")}</p>}
          <details><summary>Input formats</summary><p className="help-text">Metadata CSV example: <code>filename,language,difficulty</code>. Gold JSON uses the format shown on the Task step; for this modality an example filename is <code>{mediaPlugin?.exampleFilename}</code>. Filenames must match the selected media exactly.</p></details>
          {error && <p className="form-error">{error}</p>}
        </div>}

        {step === 3 && <div className="flex-col">
          {!datasetAssemblyCurrent && <p className="form-error">The annotation task changed after this dataset was assembled. Go back to “Dataset bundle” and select “Assemble &amp; preview” again to revalidate every gold answer.</p>}
          <div className="dataset-summary">
            <div><strong>{datasetRows.length}</strong><span>samples</span></div>
            <div><strong>{metadataFields.length}</strong><span>metadata fields</span></div>
            <div><strong>{goldCount}</strong><span>gold samples</span></div>
            <div><strong>{datasetErrors.length + datasetRows.filter(row => row.errors.length).length}</strong><span>issues</span></div>
          </div>
          {datasetErrors.map(message => <p className="form-error" key={message}>{message}</p>)}
          <div className="dataset-table-wrap"><table className="dataset-table"><thead><tr><th>Sample</th><th>Preview</th>{metadataFields.map(field => <th key={field.key}>{field.label}</th>)}<th>Gold answer</th><th>Status</th></tr></thead><tbody>
            {datasetRows.map(row => <tr key={row.filename} className={row.errors.length ? "invalid" : ""}>
              <td><strong>{row.filename}</strong></td>
              <td>{mediaPlugin ? row.goldAnswer
                ? <AnnotationOverlaySelector modality={form.modality} schema={annotationSchema} mediaUrl={mediaUrls[row.filename]} title={row.filename} options={buildOverlayOptions(row.goldAnswer as AnnotationAnswer, [])} />
                : <mediaPlugin.PreviewRenderer mediaUrl={mediaUrls[row.filename]} title={row.filename} />
                : <span>Unsupported media</span>}</td>
              {metadataFields.map(field => <td key={field.key}>
                {field.type === "choice" ? <select className="table-input" value={String(row.metadata[field.key] ?? "")} onChange={event => updateRowMetadata(row.filename, field.key, event.target.value || undefined)}><option value="">—</option>{field.options.map(option => <option key={option}>{option}</option>)}</select>
                  : field.type === "boolean" ? <select className="table-input" value={String(row.metadata[field.key] ?? "")} onChange={event => updateRowMetadata(row.filename, field.key, event.target.value ? event.target.value === "true" : undefined)}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select>
                    : <input className="table-input" type={field.type === "number" ? "number" : "text"} value={String(row.metadata[field.key] ?? "")} onChange={event => updateRowMetadata(row.filename, field.key, event.target.value ? (field.type === "number" ? event.target.valueAsNumber : event.target.value) : undefined)} />}
              </td>)}
              <td><textarea className="table-input gold-cell" defaultValue={row.goldAnswer ? JSON.stringify(row.goldAnswer) : ""} placeholder="Not gold" onBlur={event => updateRowGold(row.filename, event.target.value)} /></td>
              <td>{row.errors.length ? <span className="status-error" title={row.errors.join("; ")}>Needs attention</span> : <span className="status-ready">Ready</span>}{row.errors.map(message => <small className="row-error" key={message}>{message}</small>)}</td>
            </tr>)}
          </tbody></table></div>
          <p className="help-text">Metadata cells and gold JSON can be corrected here. Use “Back” to replace any source file.</p>
        </div>}

        {step === 4 && <div className="flex-col">
          <div className="qualification-guide">
            <strong>Who is qualified to annotate each sample?</strong>
            <p>First ask the annotator about a skill, language, or proficiency. Then connect their answer to a metadata column from your dataset.</p>
            <span>Example: ask “Which languages can you understand?” → only serve a Hindi sample when Hindi is among their answers.</span>
          </div>

          <div className="section-heading"><div><h3>1. Questions for the annotator</h3><p>These are shown once, before the annotator receives any samples.</p></div><button type="button" className="btn btn-secondary" onClick={addQuestion}><Plus size={16} /> Add question</button></div>
          {questions.length === 0 && <div className="empty-builder"><strong>No qualification questions yet.</strong><span>Add a question if some samples require a particular language or skill. Otherwise, you can continue and all annotators will be eligible.</span></div>}
          {questions.map((question, index) => <div className="builder-card qualification-card" key={question.key}>
            <div className="card-heading"><strong>Question {index + 1}</strong><button type="button" className="icon-button" aria-label={`Delete question ${index + 1}`} onClick={() => { setQuestions(current => current.filter((_, position) => position !== index)); setRules(current => current.filter(rule => rule.question_key !== question.key)); }}><Trash2 size={17} /></button></div>
            <div className="qualification-question-grid">
              <div className="form-group"><label className="form-label">Question shown to the annotator</label><input className="form-input" value={question.label} onChange={event => updateQuestion(index, { label: event.target.value })} placeholder="Which languages can you understand?" /></div>
              <div className="form-group"><label className="form-label">How should they answer?</label><select className="form-select" value={question.type} onChange={event => { const type = event.target.value as QualificationQuestion["type"]; updateQuestion(index, { type, options: type.includes("choice") ? question.options : [] }); setRules(current => current.filter(rule => rule.question_key !== question.key)); }}><option value="single_choice">Choose one option</option><option value="multi_choice">Choose all that apply</option><option value="boolean">Yes or No</option><option value="number">Numeric proficiency level</option><option value="text">Free-text response (not for routing)</option></select></div>
            </div>
            {question.type.includes("choice") && <div className="form-group"><label className="form-label">Answer options <span>— separate with commas</span></label><input className="form-input" value={question.options.join(", ")} onChange={event => updateQuestion(index, { options: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })} placeholder="Hindi, English, Marathi" /></div>}
            {question.type === "number" && <div className="qualification-range"><div className="form-group"><label className="form-label">Lowest answer allowed</label><input className="form-input" type="number" value={question.minimum ?? 0} onChange={event => updateQuestion(index, { minimum: event.target.valueAsNumber })} /></div><div className="form-group"><label className="form-label">Highest answer allowed</label><input className="form-input" type="number" value={question.maximum ?? 5} onChange={event => updateQuestion(index, { maximum: event.target.valueAsNumber })} /></div></div>}
            {question.type === "text" && <p className="non-routing-note">Free-text answers are collected with the annotator profile for review. They cannot be selected in matching rules.</p>}
            {!question.label.trim() && <p className="form-error">Write the question that the annotator will see.</p>}
            {question.type.includes("choice") && question.options.length === 0 && <p className="form-error">Add at least one answer option.</p>}
            <label className="required-toggle"><input type="checkbox" checked={question.required} onChange={event => updateQuestion(index, { required: event.target.checked })} />Annotator must answer this question</label>
          </div>)}

          {metadataFields.length === 0 && questions.length > 0 && <div className="routing-note">Your dataset has no metadata columns, so answers cannot be used to route particular samples. The questions will only be recorded as annotator qualifications.</div>}
          {metadataFields.length > 0 && questions.length > 0 && <>
            <div className="section-heading"><div><h3>2. Match answers to samples</h3><p>A sample is served only when every rule below matches.</p></div><button type="button" className="btn btn-secondary" onClick={addRule} disabled={!metadataFields.some(field => questions.some(question => routingOperatorFor(field, question)))}><Plus size={16} /> Add matching rule</button></div>
            {rules.length === 0 && <div className="empty-builder"><strong>No matching rules yet.</strong><span>The questions will be recorded, but they will not restrict which samples an annotator receives.</span></div>}
            {rules.map((rule, index) => {
              const selectedField = metadataFields.find(field => field.key === rule.metadata_field);
              const selectedQuestion = questions.find(question => question.key === rule.question_key);
              const operatorText = rule.operator === "in" ? "is included in" : rule.operator === "gte" ? "is at or below" : "exactly equals";
              return <div className="routing-card" key={index}>
                <div className="card-heading"><strong>Matching rule {index + 1}</strong><button type="button" className="icon-button" aria-label={`Delete matching rule ${index + 1}`} onClick={() => setRules(current => current.filter((_, position) => position !== index))}><Trash2 size={17} /></button></div>
                <div className="routing-sentence"><span>Serve a sample when its</span><select className="form-select" aria-label="Sample metadata field" value={rule.metadata_field} onChange={event => { const field = metadataFields.find(item => item.key === event.target.value); const compatibleQuestion = questions.find(question => routingOperatorFor(field, question)) ?? selectedQuestion; const operator = routingOperatorFor(field, compatibleQuestion); if (compatibleQuestion && operator) setRules(current => current.map((value, position) => position === index ? { ...value, metadata_field: field!.key, question_key: compatibleQuestion.key, operator } : value)); }}>{metadataFields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select><strong>{operatorText}</strong><span>the annotator’s answer to</span><select className="form-select" aria-label="Qualification question" value={rule.question_key} onChange={event => { const question = questions.find(item => item.key === event.target.value); const compatibleField = metadataFields.find(field => routingOperatorFor(field, question)) ?? selectedField; const operator = routingOperatorFor(compatibleField, question); if (compatibleField && question && operator) setRules(current => current.map((value, position) => position === index ? { ...value, metadata_field: compatibleField.key, question_key: question.key, operator } : value)); }}>{questions.filter(question => routingOperatorFor(selectedField, question)).map(question => <option key={question.key} value={question.key}>{question.label}</option>)}</select></div>
                <p className="routing-meaning">For example, a sample with <strong>{selectedField?.label ?? "metadata"}</strong> will be served only when it matches the answer to “{selectedQuestion?.label ?? "the selected question"}”.</p>
              </div>;
            })}
          </>}
        </div>}

        {step === 5 && <div className="flex-col">
          <div className="quality-grid"><div className="form-group"><label className="form-label">People per regular sample</label><input className="form-input" type="number" min="1" max="100" value={form.overlap_n} onChange={event => setForm({ ...form, overlap_n: event.target.valueAsNumber })} /></div><div className="form-group"><label className="form-label">Quality-check frequency</label><select className="form-select" value={form.gold_ratio} onChange={event => setForm({ ...form, gold_ratio: Number(event.target.value) })}><option value="0">None</option><option value="0.05">Light — 5%</option><option value="0.1">Recommended — 10%</option><option value="0.2">Strict — 20%</option></select></div></div>
          <div className="workload-card"><strong>Estimated regular assignments</strong><span>{regularCount} regular samples × {form.overlap_n} people</span><h2>{regularCount * form.overlap_n}</h2></div>
          <div className="review-grid"><div><span>Name</span><strong>{form.name}</strong></div><div><span>Task</span><strong>{currentType?.name}</strong></div><div><span>Annotator access</span><strong>{form.access_mode === "sign_in_required" ? "Sign-in required" : form.access_mode === "guest_name" ? "Name required" : "Fully anonymous"}</strong></div><div><span>Samples</span><strong>{datasetRows.length} ({goldCount} gold)</strong></div><div><span>Metadata fields</span><strong>{metadataFields.length}</strong></div><div><span>Qualification questions</span><strong>{questions.length}</strong></div><div><span>Routing rules</span><strong>{rules.length}</strong></div></div>
          {form.gold_ratio > 0 && goldCount === 0 && <p className="form-error">Add at least one gold answer or set quality-check frequency to “None”.</p>}
          {error && <p className="form-error">{error}</p>}
        </div>}

        <div className="wizard-actions">
          <button type="button" className="btn btn-secondary" disabled={step === 0 || submitting} onClick={() => setStep(value => value - 1)}><ArrowLeft size={17} /> Back</button>
          {step < steps.length - 1 ? <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={step === 2 ? assembleDataset : () => setStep(value => value + 1)}>{step === 2 ? "Assemble & preview" : "Continue"} <ArrowRight size={17} /></button> : <button type="button" className="btn btn-primary" disabled={submitting || (form.gold_ratio > 0 && goldCount === 0)} onClick={deploy}>{submitting ? "Creating experiment…" : "Create & deploy"} <Check size={17} /></button>}
        </div>
      </div>
    </div>
  );
}
