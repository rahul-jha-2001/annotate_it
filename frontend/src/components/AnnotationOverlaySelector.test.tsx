import { describe, expect, it } from "vitest";

import {
  buildOverlayOptions,
  readonlyInteractionFor,
  selectedOverlay,
} from "./AnnotationOverlaySelector";

describe("annotation overlay selection", () => {
  const gold = { boxes: [{ id: "gold-1", label: "Object", x: 0.1, y: 0.1, width: 0.2, height: 0.2 }] };
  const submitted = { boxes: [{ id: "answer-1", label: "Object", x: 0.2, y: 0.2, width: 0.2, height: 0.2 }] };

  it("builds separate options for gold and every submission", () => {
    expect(buildOverlayOptions(gold, [
      { id: "a1", label: "Annotation 1", answer: submitted },
      { id: "a2", label: "Annotation 2", answer: submitted },
    ]).map(option => option.id)).toEqual(["gold", "a1", "a2"]);
  });

  it("resolves the module-owned readonly interaction", () => {
    const schema = {
      annotation_type: "bounding_box" as const,
      schema_version: 1 as const,
      choices: ["Object"],
      max_shapes: 100,
      frame_aware: false,
      time_tolerance: 0.1,
      distance_tolerance: 0.1,
    };
    const interaction = readonlyInteractionFor(schema, gold);
    expect(interaction).toMatchObject({ kind: "spatial-shapes", readonly: true });
  });

  it("falls back for missing plugins and selection never mutates answers", () => {
    const options = buildOverlayOptions(gold, [{ id: "a1", label: "Annotation 1", answer: submitted }]);
    const snapshot = structuredClone(options);
    expect(selectedOverlay(options, "a1")?.answer).toBe(submitted);
    expect(options).toEqual(snapshot);
    expect(readonlyInteractionFor({ annotation_type: "missing", schema_version: 1 } as never, gold)).toBeNull();
  });
});
