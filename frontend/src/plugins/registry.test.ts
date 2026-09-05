import { describe, expect, it, vi } from "vitest";
import { getAnnotationPlugin } from "./annotations/registry";
import { getMediaPlugin, listMediaPlugins, supportsAnnotation } from "./media/registry";

describe("plugin compatibility", () => {
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
    const interaction = segment.createInteraction({ label: "Speech", regions: [] }, onChange);
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
