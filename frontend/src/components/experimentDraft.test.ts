import { describe, expect, it } from "vitest";
import { isDatasetAssemblyCurrent, schemaFingerprint } from "./experimentDraft";

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
