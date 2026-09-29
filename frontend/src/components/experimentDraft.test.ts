import { describe, expect, it } from "vitest";
import { defaultExperimentPreset, isDatasetAssemblyCurrent, resolveExperimentPreset, schemaFingerprint } from "./experimentDraft";

describe("experiment dataset assembly", () => {
  const categorical = {
    annotation_type: "categorical",
    schema_version: 1,
    choices: ["Good", "Bad"],
    multi_select: false,
  };

  it("remains current while the task schema is unchanged", () => {
    expect(isDatasetAssemblyCurrent(schemaFingerprint(categorical), { ...categorical })).toBe(true);
  });

  it("becomes stale when task configuration or type changes", () => {
    const assembled = schemaFingerprint(categorical);
    expect(isDatasetAssemblyCurrent(assembled, { ...categorical, choices: ["Pass", "Fail"] })).toBe(false);
    expect(isDatasetAssemblyCurrent(assembled, {
      annotation_type: "transcription",
      schema_version: 1,
    })).toBe(false);
  });

  it("is not current before a dataset has been assembled", () => {
    expect(isDatasetAssemblyCurrent(null, categorical)).toBe(false);
  });
});


describe("catalog experiment handoff", () => {
  it("resolves a valid compatible pair", () => {
    expect(resolveExperimentPreset("?modality=audio&annotation_type=speaker_diarization"))
      .toMatchObject({ modality: "audio", schema: { annotation_type: "speaker_diarization" } });
  });
  it.each([
    "?modality=missing&annotation_type=categorical",
    "?modality=audio&annotation_type=missing",
    "?modality=image&annotation_type=segment",
    "?modality=image&annotation_type=transcription",
    "?modality=audio",
    "?annotation_type=categorical",
  ])("falls back atomically for invalid handoff %s", search => {
    expect(resolveExperimentPreset(search)).toEqual(defaultExperimentPreset());
  });
  it("parses URL-encoded values", () => {
    expect(resolveExperimentPreset("?modality=audio&annotation_type=speaker%5Fidentification"))
      .toMatchObject({ modality: "audio", schema: { annotation_type: "speaker_identification" } });
  });
});
