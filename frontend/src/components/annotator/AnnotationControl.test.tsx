import { describe, expect, it } from "vitest";
import { isAnswerComplete } from "./AnnotationControl";
import type { LabelSchema } from "./types";

const categorical: LabelSchema = {
  annotation_type: "categorical",
  schema_version: 1,
  choices: ["Good", "Bad"],
  multi_select: false,
};

describe("isAnswerComplete", () => {
  it("requires a value for single-choice categorical answers", () => {
    expect(isAnswerComplete(categorical, {})).toBe(false);
    expect(isAnswerComplete(categorical, { value: "Good" })).toBe(true);
  });

  it("requires a selection for multi-choice categorical answers", () => {
    const schema = { ...categorical, multi_select: true };
    expect(isAnswerComplete(schema, { values: [] })).toBe(false);
    expect(isAnswerComplete(schema, { values: ["Good"] })).toBe(true);
  });

  it("allows a labeled segment answer with no regions", () => {
    const schema: LabelSchema = {
      annotation_type: "segment",
      schema_version: 1,
      choices: ["Good", "Bad"],
      multi_select: false,
    };
    expect(isAnswerComplete(schema, { regions: [] })).toBe(false);
    expect(isAnswerComplete(schema, { label: "Good", regions: [] })).toBe(true);
  });
});
