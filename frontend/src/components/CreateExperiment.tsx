import React, { useState, useMemo, useEffect } from "react";
import { UploadCloud, Plus, Settings, X } from "lucide-react";

interface AnnotationTypeInfo {
  key: string;
  name: string;
  compatible_modalities: string[];
  supports_choices: boolean;
  supports_multi_select: boolean;
}

export default function CreateExperiment() {
  const [formData, setFormData] = useState({
    name: "",
    modality: "audio",
    instructions: "",
    overlap_n: 1,
    gold_ratio: 0.1,
  });

  const [annotationType, setAnnotationType] = useState("categorical");
  const [choices, setChoices] = useState("Good, Noisy, Unusable");
  const [multiSelect, setMultiSelect] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [goldManifest, setGoldManifest] = useState<File | null>(null);
  const [goldManifestText, setGoldManifestText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [annotationTypes, setAnnotationTypes] = useState<AnnotationTypeInfo[]>([]);

  useEffect(() => {
    fetch('/api/annotation-types')
      .then(res => res.json())
      .then(data => {
        setAnnotationTypes(data);
        if (data.length > 0 && !data.find((t: any) => t.key === annotationType)) {
          setAnnotationType(data[0].key);
        }
      })
      .catch(err => console.error("Failed to load annotation types:", err));
  }, []);

  const availableTypes = useMemo(() => {
    return annotationTypes.filter(t => t.compatible_modalities.includes(formData.modality));
  }, [annotationTypes, formData.modality]);

  useEffect(() => {
    if (availableTypes.length > 0 && !availableTypes.find(t => t.key === annotationType)) {
      setAnnotationType(availableTypes[0].key);
    }
  }, [availableTypes, annotationType]);

  const currentTypeSpec = annotationTypes.find(t => t.key === annotationType);
  
  const previewJson = useMemo(() => {
    const example: any = { filename: "clip_01.wav", answer: {} };
    const firstChoice = choices.split(",")[0].trim() || "Label";
    if (annotationType === "segment") {
      example.answer = { label: firstChoice, regions: [{ start: 0.0, end: 5.0 }] };
    } else if (annotationType === "categorical") {
      if (multiSelect) {
        example.answer.values = [firstChoice];
      } else {
        example.answer.value = firstChoice;
      }
    } else {
      example.answer.value = "...";
    }
    return JSON.stringify([example], null, 2);
  }, [annotationType, choices, multiSelect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // 1. Create the experiment
      const expRes = await fetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          modality: formData.modality,
          instructions: formData.instructions,
          label_schema: {
            annotation_type: annotationType,
            choices: choices.split(",").map(c => c.trim()).filter(Boolean),
            multi_select: multiSelect
          },
          overlap_n: formData.overlap_n,
          gold_ratio: formData.gold_ratio
        })
      });
      
      if (!expRes.ok) throw new Error("Failed to create experiment");
      const experiment = await expRes.json();
      
      // 2. If there are files, get presigned URLs and upload them
      let dataUnits = [];
      if (files.length > 0) {
        const presignRes = await fetch('/api/uploads/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filenames: files.map(f => f.name) })
        });
        
        if (!presignRes.ok) throw new Error("Failed to get presigned URLs");
        const presignData = await presignRes.json();
        
        // Upload each file and prepare DataUnit payload
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const presigned = presignData.urls.find((u: any) => u.filename === file.name);
          
          if (presigned) {
            // PUT to MinIO
            await fetch(presigned.upload_url, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': file.type }
            });
            
            dataUnits.push({
              raw_uri: presigned.s3_uri,
              is_gold: false, // Gold items can be configured later in a full v1
              gold_answer: null
            });
          }
        }
      }
      
      // 3. Batch create data units
      if (dataUnits.length > 0) {
        await fetch(`/api/experiments/${experiment.id}/data-units`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: dataUnits })
        });
      }
      
      // 4. Gold manifest upload
      let manifestErrors = 0;
      if ((goldManifest || goldManifestText) && dataUnits.length > 0) {
        try {
          let text = goldManifestText;
          if (goldManifest && !text) {
             text = await goldManifest.text();
          }
          const parsed = JSON.parse(text);
          const manifestRes = await fetch(`/api/experiments/${experiment.id}/gold-manifest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manifest: parsed })
          });
          const result = await manifestRes.json();
          if (result.errors && result.errors.length > 0) {
            manifestErrors = result.errors.length;
            console.error("Gold manifest errors:", result.errors);
          }
        } catch (err) {
          console.error("Manifest parsing error:", err);
          alert("Failed to parse gold manifest. Was it valid JSON?");
        }
      }
      
      let msg = `Experiment created! Share token: ${experiment.share_token}`;
      if (manifestErrors > 0) msg += `\nWarning: ${manifestErrors} entries in your gold manifest failed to process. Check console.`;
      alert(msg);
      // In a real app, redirect to dashboard here
    } catch (err) {
      console.error(err);
      alert("Error creating experiment: " + err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass-panel" style={{ width: "100%", maxWidth: "1000px", margin: "0 auto" }}>
      <div className="flex-row" style={{ marginBottom: "24px", borderBottom: "1px solid var(--border-color)", paddingBottom: "16px" }}>
        <Settings className="app-logo-icon" size={24} />
        <h2>Create New Experiment</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex-col" style={{ gap: "24px" }}>
        
        {/* Basic Info */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div className="form-group">
            <label className="form-label">Experiment Name</label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. Sentiment Analysis Audio"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Modality</label>
            <select 
              className="form-select"
              value={formData.modality}
              onChange={(e) => setFormData({...formData, modality: e.target.value})}
            >
              <option value="audio">Audio (Wavesurfer.js)</option>
              <option value="image" disabled>Image (Coming Soon)</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Instructions for Annotators</label>
          <textarea 
            className="form-textarea" 
            placeholder="Describe exactly what annotators should look for..."
            value={formData.instructions}
            onChange={(e) => setFormData({...formData, instructions: e.target.value})}
          />
        </div>

        {/* Quality Settings */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", background: "rgba(0,0,0,0.15)", padding: "16px", borderRadius: "12px" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Overlap N (Annotators per item)</label>
            <input 
              type="number" 
              className="form-input" 
              min="1" max="10"
              value={formData.overlap_n}
              onChange={(e) => setFormData({...formData, overlap_n: parseInt(e.target.value)})}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Gold Ratio (0.0 to 1.0)</label>
            <input 
              type="number" 
              className="form-input" 
              min="0" max="1" step="0.05"
              value={formData.gold_ratio}
              onChange={(e) => setFormData({...formData, gold_ratio: parseFloat(e.target.value)})}
            />
          </div>
        </div>

        {/* Schema Definition */}
        <div className="form-group">
          <label className="form-label">Annotation Schema</label>
          <div className="flex-col" style={{ gap: "12px", background: "rgba(255,255,255,0.02)", padding: "16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="flex-row" style={{ gap: "12px", alignItems: "center" }}>
              <span style={{ width: "120px", color: "var(--text-secondary)", fontSize: "0.9rem" }}>Type:</span>
              <select 
                className="form-select" 
                style={{ flex: 1 }}
                value={annotationType}
                onChange={(e) => setAnnotationType(e.target.value)}
              >
                {availableTypes.map(t => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
            </div>
            
            {currentTypeSpec?.supports_choices && (
              <div className="flex-row" style={{ gap: "12px", alignItems: "center" }}>
                <span style={{ width: "120px", color: "var(--text-secondary)", fontSize: "0.9rem" }}>Choices:</span>
                <input 
                  type="text" 
                  className="form-input" 
                  style={{ flex: 1 }}
                  placeholder="Comma separated choices (e.g. Good, Bad)"
                  value={choices}
                  onChange={(e) => setChoices(e.target.value)}
                />
              </div>
            )}
            
            {currentTypeSpec?.supports_multi_select && (
              <div className="flex-row" style={{ gap: "12px", alignItems: "center" }}>
                <span style={{ width: "120px", color: "var(--text-secondary)", fontSize: "0.9rem" }}>Multi-select:</span>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                  <input 
                    type="checkbox" 
                    checked={multiSelect}
                    onChange={(e) => setMultiSelect(e.target.checked)}
                  />
                  <span style={{ fontSize: "0.9rem" }}>Allow multiple selections per item</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Data Upload */}
        <div className="form-group">
          <label className="form-label">Upload Dataset (Audio Files)</label>
          <label className="dropzone">
            <UploadCloud className="dropzone-icon" />
            <div>
              <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>Click to browse or drag files here</p>
              <p style={{ margin: 0, fontSize: "0.85rem", marginTop: "4px" }}>Select audio files (.mp3, .wav). You can mark gold items later.</p>
            </div>
            <input 
              type="file" 
              multiple 
              accept="audio/*" 
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) {
                  setFiles(Array.from(e.target.files));
                }
              }}
            />
          </label>
          
          {files.length > 0 && (
            <div style={{ marginTop: "12px", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              <div style={{ marginBottom: "8px", fontWeight: 500 }}>{files.length} file(s) selected:</div>
              <ul style={{ 
                listStyle: "none", 
                padding: "8px 12px", 
                margin: 0, 
                background: "rgba(0,0,0,0.2)", 
                borderRadius: "6px", 
                maxHeight: "150px", 
                overflowY: "auto",
                border: "1px solid rgba(255,255,255,0.05)"
              }}>
                {files.map((file, idx) => (
                  <li key={idx} style={{ padding: "4px 0", borderBottom: idx < files.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "0.75rem", opacity: 0.5, width: "24px" }}>{idx + 1}.</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, color: "var(--text-primary)" }}>{file.name}</span>
                    <span style={{ fontSize: "0.75rem", opacity: 0.5 }}>{(file.size / 1024).toFixed(1)} KB</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        
        {/* Gold Manifest Upload */}
        <div className="form-group">
          <label className="form-label">Upload Gold Manifest (Optional)</label>
          <div style={{ background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "0.85rem", whiteSpace: "pre-wrap", marginBottom: "12px", color: "var(--text-secondary)" }}>
            Your gold manifest JSON should look like:
            <br />
            {previewJson}
          </div>
          <div style={{ display: "flex", gap: "12px", flexDirection: "column" }}>
            <textarea
              className="form-input"
              style={{ minHeight: "120px", fontFamily: "monospace", fontSize: "0.85rem" }}
              placeholder="Paste JSON manifest here..."
              value={goldManifestText}
              onChange={(e) => setGoldManifestText(e.target.value)}
            />
            
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }}></div>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>OR UPLOAD FILE</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.1)" }}></div>
            </div>

            <label className="dropzone">
              <UploadCloud className="dropzone-icon" />
              <div>
                <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>Click to browse or drag JSON file here</p>
                <p style={{ margin: 0, fontSize: "0.85rem", marginTop: "4px" }}>Upload a .json file containing answers for your gold standard items.</p>
              </div>
              <input 
                type="file" 
                accept="application/json" 
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setGoldManifest(e.target.files[0]);
                    setGoldManifestText(""); // Clear text if file selected
                  }
                }}
              />
            </label>
          </div>
          
          {goldManifest && !goldManifestText && (
            <div style={{ marginTop: "12px", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              Selected manifest: {goldManifest.name}
            </div>
          )}
        </div>

        <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Deploying..." : "Create & Deploy Experiment"}
          </button>
        </div>
      </form>
    </div>
  );
}
