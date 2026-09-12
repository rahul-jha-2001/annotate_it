import { describe, expect, it } from "vitest";

import { getAnnotationPlugin } from "./registry";
import { TranscriptionAnnotationModule } from "./transcription";

describe("transcription annotation module", () => {
  it("owns its versioned configuration and answer lifecycle", () => {
    const module = new TranscriptionAnnotationModule();
    const schema = module.defaultSchema({ interactionDefaults: {} });

    expect(schema).toEqual({
      annotation_type: "transcription",
      schema_version: 1,
      case_sensitive: false,
      collapse_whitespace: true,
      strip_punctuation: false,
      minimum_length: 1,
    });
    expect(module.createInitialAnswer(schema)).toEqual({ text: "" });
    expect(module.isComplete(schema, { text: "   " })).toBe(false);
    expect(module.isComplete(schema, { text: "hello" })).toBe(true);
    expect(module.createGoldExample(schema)).toEqual({ text: "Expected transcript" });
  });

  it("is registered without changing a media renderer", () => {
    expect(getAnnotationPlugin("transcription")).toBeInstanceOf(
      TranscriptionAnnotationModule,
    );
  });
});
