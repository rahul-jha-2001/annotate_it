import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Settings, Trash2, UploadCloud } from "lucide-react";
import AnnotationControl from "./annotator/AnnotationControl";
import type { AnnotationAnswer, LabelSchema } from "./annotator/types";
import {
  parseDatasetBundle,
  validateGold,
  type MetadataFieldDefinition,
  type ParsedDatasetRow,
} from "./datasetBundle";

interface AnnotationTypeInfo {
  key: string;
  name: string;
  compatible_modalities: string[];
  supports_choices: boolean;
  supports_multi_select: boolean;
}

interface QualificationQuestion {
  key: string;
  label: string;
  type: "single_choice" | "multi_choice" | "boolean" | "number";
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

export default function CreateExperiment() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", modality: "audio", instructions: "", overlap_n: 2, gold_ratio: 0.1 });
  const [annotationTypes, setAnnotationTypes] = useState<AnnotationTypeInfo[]>([]);
  const [annotationType, setAnnotationType] = useState("categorical");
  const [labels, setLabels] = useState(["Good", "Noisy", "Unusable"]);
  const [labelInput, setLabelInput] = useState("");
  const [multiSelect, setMultiSelect] = useState(false);
  const [previewAnswer, setPreviewAnswer] = useState<AnnotationAnswer>({});
  const [files, setFiles] = useState<File[]>([]);
  const [metadataFields, setMetadataFields] = useState<MetadataFieldDefinition[]>([]);
  const [metadataCsv, setMetadataCsv] = useState("");
  const [datasetRows, setDatasetRows] = useState<ParsedDatasetRow[]>([]);
  const [datasetErrors, setDatasetErrors] = useState<string[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<QualificationQuestion[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [goldManifest, setGoldManifest] = useState("");
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/annotation-types").then(response => response.json()).then(setAnnotationTypes)
      .catch(() => setError("Could not load annotation types"));
  }, []);

  const availableTypes = annotationTypes.filter(type => type.compatible_modalities.includes(form.modality));
  const currentType = annotationTypes.find(type => type.key === annotationType);
  useEffect(() => {
    if (currentType && !currentType.supports_multi_select) setMultiSelect(false);
  }, [currentType]);

  useEffect(() => {
    setPreviewAnswer(annotationType === "segment" ? { regions: [] } : {});
  }, [annotationType, multiSelect, labels]);

  useEffect(() => {
    const urls = Object.fromEntries(files.map(file => [file.name, URL.createObjectURL(file)]));
    setMediaUrls(urls);
    return () => Object.values(urls).forEach(url => URL.revokeObjectURL(url));
  }, [files]);

  const previewSchema: LabelSchema = {
    annotation_type: annotationType,
    choices: labels,
    multi_select: multiSelect,
  };

  const duplicateFiles = useMemo(() => {
    const names = files.map(file => file.name);
    return new Set(names.filter((name, index) => names.indexOf(name) !== index));
  }, [files]);
  const goldCount = datasetRows.filter(row => row.goldAnswer).length;
  const regularCount = datasetRows.length - goldCount;

  const addLabel = () => {
    const value = labelInput.trim();
    if (value && !labels.includes(value)) setLabels(current => [...current, value]);
    setLabelInput("");
  };

  const addQuestion = () => {
    const index = questions.length + 1;
    setQuestions(current => [...current, { key: `question_${index}`, label: `Qualification question ${index}`, type: "single_choice", required: true, options: ["Option 1"] }]);
  };

  const updateQuestion = (index: number, patch: Partial<QualificationQuestion>) => {
    setQuestions(current => current.map((question, position) => position === index ? { ...question, ...patch } : question));
  };

  const addRule = () => {
    if (!metadataFields.length || !questions.length) return;
    const question = questions[0];
    setRules(current => [...current, {
      metadata_field: metadataFields[0].key,
      operator: question.type === "multi_choice" ? "in" : "equals",
      question_key: question.key,
    }]);
  };

  const canContinue = (() => {
    if (step === 0) return Boolean(form.name.trim() && form.instructions.trim());
    if (step === 1) return Boolean(annotationType && labels.length);
    if (step === 2) return files.length > 0 && duplicateFiles.size === 0;
    if (step === 3) return datasetErrors.length === 0 && datasetRows.every(row => row.errors.length === 0);
    return true;
  })();

  const assembleDataset = () => {
    setError(null);
    try {
      const parsed = parseDatasetBundle(files.map(file => file.name), metadataCsv, goldManifest, {
        annotationType,
        labels,
        multiSelect,
      });
      setMetadataFields(parsed.metadataFields);
      setDatasetRows(parsed.rows);
      setDatasetErrors(parsed.errors);
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
          errors: [...metadataErrors, ...validateGold(answer, { annotationType, labels, multiSelect })],
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
      if (form.gold_ratio > 0 && goldCount === 0) {
        throw new Error('Add at least one gold answer or set quality-check frequency to "None"');
      }
      const datasetByFilename = new Map(datasetRows.map(row => [row.filename, row]));

      const experimentResponse = await fetch("/api/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          status: "draft",
          label_schema: { annotation_type: annotationType, choices: labels, multi_select: multiSelect },
          metadata_schema: metadataFields,
          qualification_form: questions,
          routing_rules: rules,
        }),
      });
      const experimentBody = await experimentResponse.json();
      if (!experimentResponse.ok) throw new Error(typeof experimentBody.detail === "string" ? experimentBody.detail : "Invalid experiment configuration");

      const presignResponse = await fetch("/api/uploads/presign", {
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

      const unitsResponse = await fetch(`/api/experiments/${experimentBody.id}/data-units`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: dataUnits }),
      });
      if (!unitsResponse.ok) throw new Error((await unitsResponse.json()).detail || "Could not register dataset");

      const goldEntries = datasetRows
        .filter(row => row.goldAnswer)
        .map(row => ({ filename: row.filename, answer: row.goldAnswer }));
      if (goldEntries.length) {
        const goldResponse = await fetch(`/api/experiments/${experimentBody.id}/gold-manifest`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: goldEntries }),
        });
        const result = await goldResponse.json();
        if (!goldResponse.ok || result.errors?.length) throw new Error(result.errors?.[0]?.error || "Could not apply gold answers");
      }

      const deployResponse = await fetch(`/api/experiments/${experimentBody.id}/deploy`, { method: "POST" });
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
          "Name the experiment and explain the work.",
          "Choose what annotators will submit.",
          "Add media, metadata, and gold answers together.",
          "Inspect every assembled sample before upload.",
          "Ask qualification questions and route matching samples.",
          "Confirm quality settings and deploy.",
        ][step]}</p></div></div>

        {step === 0 && <div className="flex-col">
          <div className="form-group"><label className="form-label">Experiment name</label><input className="form-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Hindi speech quality" /></div>
          <div className="form-group"><label className="form-label">Instructions for annotators</label><textarea className="form-textarea" value={form.instructions} onChange={event => setForm({ ...form, instructions: event.target.value })} placeholder="Explain what a good annotation looks like…" /></div>
          <div className="form-group"><label className="form-label">Media type</label><select className="form-select" value={form.modality} onChange={event => setForm({ ...form, modality: event.target.value })}><option value="audio">Audio</option></select></div>
        </div>}

        {step === 1 && <div className="flex-col">
          <div className="task-type-grid">{availableTypes.map(type => <button type="button" key={type.key} className={`task-type-card ${annotationType === type.key ? "selected" : ""}`} onClick={() => setAnnotationType(type.key)}><strong>{type.name}</strong><span>{type.key === "categorical" ? "Choose one or more labels for the whole sample" : "Mark labeled time regions in audio"}</span></button>)}</div>
          <div className="form-group"><label className="form-label">Labels or choices</label><div className="chip-editor"><div className="label-chips">{labels.map(label => <span className="label-chip" key={label}>{label}<button type="button" onClick={() => setLabels(current => current.filter(value => value !== label))}>×</button></span>)}</div><div className="flex-row"><input className="form-input" value={labelInput} onChange={event => setLabelInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addLabel(); } }} placeholder="Add a label" /><button type="button" className="btn btn-secondary" onClick={addLabel}><Plus size={16} /> Add</button></div></div></div>
          {currentType?.supports_multi_select && <label className="choice-option"><input type="checkbox" checked={multiSelect} onChange={event => setMultiSelect(event.target.checked)} />Allow annotators to select multiple choices</label>}
          <div className="config-preview">
            <span>Interactive annotator preview</span>
            {annotationType === "segment" && (
              <div className="segment-preview">
                <div className="segment-preview-wave">
                  {(previewAnswer.regions?.length ?? 0) > 0 && <div className="segment-preview-region">Example region</div>}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPreviewAnswer(current => ({
                    ...current,
                    regions: current.regions?.length ? [] : [{ start: 1.25, end: 3.75 }],
                  }))}
                >
                  {previewAnswer.regions?.length ? "Remove example region" : "Add example region"}
                </button>
              </div>
            )}
            <AnnotationControl
              schema={previewSchema}
              answer={previewAnswer}
              onChange={setPreviewAnswer}
            />
            <div className="preview-payload">
              <span>Answer payload</span>
              <code>{JSON.stringify(previewAnswer)}</code>
            </div>
          </div>
        </div>}

        {step === 2 && <div className="flex-col">
          <div className="bundle-grid">
            <label className="dropzone"><UploadCloud className="dropzone-icon" /><strong>1. Choose audio files</strong><span>MP3, WAV, or other browser-supported audio</span><input type="file" multiple accept="audio/*" hidden onChange={event => { setFiles(Array.from(event.target.files ?? [])); setDatasetRows([]); }} /></label>
            <label className="dropzone compact"><UploadCloud className="dropzone-icon" /><strong>2. Upload metadata CSV (optional)</strong><span>{metadataCsv ? "CSV loaded — choose another to replace it" : 'Must contain a "filename" column'}</span><input type="file" accept=".csv,text/csv" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setMetadataCsv(await file.text()); setDatasetRows([]); } }} /></label>
            <label className="dropzone compact"><UploadCloud className="dropzone-icon" /><strong>3. Upload gold answers JSON (optional)</strong><span>{goldManifest ? "JSON loaded — choose another to replace it" : "Only include samples used as quality checks"}</span><input type="file" accept=".json,application/json" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { setGoldManifest(await file.text()); setDatasetRows([]); } }} /></label>
          </div>
          {(metadataCsv || goldManifest) && <div className="bundle-actions">{metadataCsv && <button type="button" className="btn btn-secondary" onClick={() => { setMetadataCsv(""); setDatasetRows([]); }}>Remove metadata CSV</button>}{goldManifest && <button type="button" className="btn btn-secondary" onClick={() => { setGoldManifest(""); setDatasetRows([]); }}>Remove gold JSON</button>}</div>}
          {files.length > 0 && <div className="file-list">{files.map(file => <div key={`${file.name}-${file.size}`}><span>{file.name}</span><span>{uploadStatus[file.name] || `${(file.size / 1024).toFixed(0)} KB`}</span></div>)}</div>}
          {duplicateFiles.size > 0 && <p className="form-error">Duplicate filenames are not allowed: {[...duplicateFiles].join(", ")}</p>}
          <details><summary>Input formats</summary><p className="help-text">Metadata CSV example: <code>filename,language,difficulty</code>. Gold JSON example: <code>{`[{"filename":"clip.wav","answer":{"value":"Good"}}]`}</code>. Filenames must match the selected media exactly.</p></details>
          {error && <p className="form-error">{error}</p>}
        </div>}

        {step === 3 && <div className="flex-col">
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
              <td><audio controls preload="metadata" src={mediaUrls[row.filename]} /></td>
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
          <div className="section-heading"><div><h3>Qualification form</h3><p>Questions appear once before annotation begins.</p></div><button type="button" className="btn btn-secondary" onClick={addQuestion}><Plus size={16} /> Add question</button></div>
          {questions.length === 0 && <div className="empty-builder">No qualification form. Every annotator can receive every sample.</div>}
          {questions.map((question, index) => <div className="builder-card" key={index}>
            <div className="builder-row"><input className="form-input" value={question.label} onChange={event => updateQuestion(index, { label: event.target.value })} /><select className="form-select" value={question.type} onChange={event => updateQuestion(index, { type: event.target.value as QualificationQuestion["type"] })}><option value="single_choice">Single choice</option><option value="multi_choice">Multiple choice</option><option value="boolean">Yes / No</option><option value="number">Number / proficiency</option></select><button type="button" className="icon-button" onClick={() => { setQuestions(current => current.filter((_, position) => position !== index)); setRules([]); }}><Trash2 size={17} /></button></div>
            {question.type.includes("choice") && <input className="form-input" value={question.options.join(", ")} onChange={event => updateQuestion(index, { options: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })} placeholder="Hindi, English, Marathi" />}
            {question.type === "number" && <div className="flex-row"><input className="form-input" type="number" value={question.minimum ?? 1} onChange={event => updateQuestion(index, { minimum: event.target.valueAsNumber })} placeholder="Minimum" /><input className="form-input" type="number" value={question.maximum ?? 5} onChange={event => updateQuestion(index, { maximum: event.target.valueAsNumber })} placeholder="Maximum" /></div>}
          </div>)}
          {metadataFields.length > 0 && questions.length > 0 && <><div className="section-heading"><div><h3>Routing rules</h3><p>All rules must match before a sample is served.</p></div><button type="button" className="btn btn-secondary" onClick={addRule}><Plus size={16} /> Add rule</button></div>{rules.map((rule, index) => <div className="routing-row" key={index}><select className="form-select" value={rule.metadata_field} onChange={event => setRules(current => current.map((value, position) => position === index ? { ...value, metadata_field: event.target.value } : value))}>{metadataFields.map(field => <option key={field.key} value={field.key}>Sample: {field.label}</option>)}</select><select className="form-select" value={rule.operator} onChange={event => setRules(current => current.map((value, position) => position === index ? { ...value, operator: event.target.value as RoutingRule["operator"] } : value))}><option value="equals">equals answer</option><option value="in">is in selected answers</option><option value="gte">requires proficiency ≥</option></select><select className="form-select" value={rule.question_key} onChange={event => setRules(current => current.map((value, position) => position === index ? { ...value, question_key: event.target.value } : value))}>{questions.map(question => <option key={question.key} value={question.key}>Answer: {question.label}</option>)}</select><button type="button" className="icon-button" onClick={() => setRules(current => current.filter((_, position) => position !== index))}><Trash2 size={17} /></button></div>)}</>}
        </div>}

        {step === 5 && <div className="flex-col">
          <div className="quality-grid"><div className="form-group"><label className="form-label">People per regular sample</label><input className="form-input" type="number" min="1" max="100" value={form.overlap_n} onChange={event => setForm({ ...form, overlap_n: event.target.valueAsNumber })} /></div><div className="form-group"><label className="form-label">Quality-check frequency</label><select className="form-select" value={form.gold_ratio} onChange={event => setForm({ ...form, gold_ratio: Number(event.target.value) })}><option value="0">None</option><option value="0.05">Light — 5%</option><option value="0.1">Recommended — 10%</option><option value="0.2">Strict — 20%</option></select></div></div>
          <div className="workload-card"><strong>Estimated regular assignments</strong><span>{regularCount} regular samples × {form.overlap_n} people</span><h2>{regularCount * form.overlap_n}</h2></div>
          <div className="review-grid"><div><span>Name</span><strong>{form.name}</strong></div><div><span>Task</span><strong>{currentType?.name}</strong></div><div><span>Samples</span><strong>{datasetRows.length} ({goldCount} gold)</strong></div><div><span>Metadata fields</span><strong>{metadataFields.length}</strong></div><div><span>Qualification questions</span><strong>{questions.length}</strong></div><div><span>Routing rules</span><strong>{rules.length}</strong></div></div>
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
