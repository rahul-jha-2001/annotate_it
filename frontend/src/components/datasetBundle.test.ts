import { describe, expect, it } from "vitest";
import { parseCsv, parseDatasetBundle } from "./datasetBundle";

const task = {
  annotationType: "categorical",
  labels: ["Good", "Bad"],
  multiSelect: false,
};

describe("dataset bundle parsing", () => {
  it("parses quoted CSV values", () => {
    expect(parseCsv('filename,note\nclip.wav,"Hindi, studio"')).toEqual([
      ["filename", "note"],
      ["clip.wav", "Hindi, studio"],
    ]);
  });

  it("joins media, typed metadata, and gold answers by filename", () => {
    const bundle = parseDatasetBundle(
      ["one.wav", "two.wav"],
      "filename,language,difficulty,verified\none.wav,Hindi,2,true\ntwo.wav,English,4,false",
      '[{"filename":"one.wav","answer":{"value":"Good"}}]',
      task,
    );

    expect(bundle.errors).toEqual([]);
    expect(bundle.metadataFields.map(field => field.type)).toEqual(["choice", "number", "boolean"]);
    expect(bundle.rows[0]).toMatchObject({
      filename: "one.wav",
      metadata: { language: "Hindi", difficulty: 2, verified: true },
      goldAnswer: { value: "Good" },
      errors: [],
    });
    expect(bundle.rows[1].goldAnswer).toBeNull();
  });

  it("reports unmatched records, missing metadata, and invalid labels", () => {
    const bundle = parseDatasetBundle(
      ["one.wav", "two.wav"],
      "filename,language\none.wav,Hindi\nmissing.wav,English",
      '[{"filename":"one.wav","answer":{"value":"Unknown"}}]',
      task,
    );

    expect(bundle.errors).toContain("Metadata has no matching media file: missing.wav");
    expect(bundle.rows[0].errors).toContain("Unknown gold label: Unknown");
    expect(bundle.rows[1].errors).toContain("No metadata row matches this media file");
  });
});
