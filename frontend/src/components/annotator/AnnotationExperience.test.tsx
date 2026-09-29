import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getAnnotationPlugin } from "../../plugins/annotations/registry";
import { getMediaPlugin } from "../../plugins/media/registry";
import { AnnotationExperience, MediaErrorBoundary, reduceMediaLoadState, resolveAnnotationExperience } from "./AnnotationExperience";
import type { LabelSchema } from "./types";

const schema: LabelSchema = {
  annotation_type: "categorical", schema_version: 1,
  choices: ["Good", "Bad"], multi_select: false,
};

describe("AnnotationExperience", () => {
  it("composes registered production modules and prepares the answer", () => {
    const result = resolveAnnotationExperience("audio", schema, {}, vi.fn());
    expect(result.error).toBeUndefined();
    expect(result.annotationModule).toBe(getAnnotationPlugin("categorical"));
    expect(result.mediaPlugin).toBe(getMediaPlugin("audio"));
    expect(result.preparedAnswer).toEqual({ value: "" });
    expect(result.interaction).toEqual({ kind: "none" });
  });

  it("renders an unsupported pair as a localized message", () => {
    const markup = renderToStaticMarkup(createElement(AnnotationExperience, {
      modality: "image",
      schema: { annotation_type: "segment", schema_version: 1, choices: ["Good"], multi_select: false },
      answer: {}, onChange: vi.fn(), mediaUrl: "/sample.jpg",
    }));
    expect(markup).toContain("not compatible with image");
  });

  it("converts renderer and asynchronous media failures into a retryable local state", () => {
    expect(MediaErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const failed = reduceMediaLoadState({ error: null, retry: 0 }, { type: "failed", message: "Codec unsupported" });
    expect(failed).toEqual({ error: "Codec unsupported", retry: 0 });
    expect(reduceMediaLoadState(failed, { type: "retry" })).toEqual({ error: null, retry: 1 });
  });
});
