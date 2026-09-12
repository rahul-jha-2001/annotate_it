import { describe, expect, it, vi } from "vitest";
import { getAnnotationPlugin } from "./annotations/registry";
import { listAnnotationModules } from "./annotations/registry";
import { BaseAnnotationModule } from "./annotations/BaseAnnotationModule";
import { getMediaPlugin, listMediaPlugins, supportsAnnotation } from "./media/registry";

describe("plugin compatibility", () => {
  it("registers only inherited annotation modules with versioned defaults", () => {
    const modules = listAnnotationModules();
    expect(modules.every(module => module instanceof BaseAnnotationModule)).toBe(true);
    expect(modules.map(module => module.defaultSchema({ interactionDefaults: {} }))).toEqual(expect.arrayContaining([
      {
        annotation_type: "categorical",
        schema_version: 1,
        choices: ["Good", "Noisy", "Unusable"],
        multi_select: false,
      },
      {
        annotation_type: "segment",
        schema_version: 1,
        choices: ["Region"],
        multi_select: false,
      },
    ]));
  });

  it("exposes audio and video without changing screen coordinators", () => {
    expect(listMediaPlugins().map(plugin => plugin.key)).toEqual(["audio", "video"]);
    expect(getMediaPlugin("video")?.accept).toBe("video/*");
  });

  it("matches annotation requirements to media capabilities", () => {
    const segment = getAnnotationPlugin("segment")!;
    expect(supportsAnnotation(getMediaPlugin("audio")!, segment.requiredInteraction)).toBe(true);
    expect(supportsAnnotation(getMediaPlugin("video")!, segment.requiredInteraction)).toBe(true);
  });

  it("maps segment answers to a generic temporal interaction", () => {
    const onChange = vi.fn();
    const segment = getAnnotationPlugin("segment")!;
    const schema = segment.defaultSchema({ interactionDefaults: {} });
    const interaction = segment.createInteraction(schema, { label: "Speech", regions: [] }, onChange);
    expect(interaction.kind).toBe("temporal-regions");
    if (interaction.kind === "temporal-regions") {
      interaction.onChange([{ start: 1, end: 2 }]);
    }
    expect(onChange).toHaveBeenCalledWith({
      label: "Speech",
      regions: [{ start: 1, end: 2 }],
    });
  });
});
