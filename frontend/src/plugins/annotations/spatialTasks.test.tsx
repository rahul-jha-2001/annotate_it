import { describe, expect, it, vi } from "vitest";

import { getAnnotationPlugin } from "./registry";
import { getMediaPlugin, supportsAnnotation } from "../media/registry";

const spatialKeys = ["bounding_box", "polygon", "polyline", "ellipse", "keypoint"];

describe("image and spatial annotation plugins", () => {
  it("registers image upload and interaction capabilities", () => {
    const image = getMediaPlugin("image")!;
    expect(image.accept).toBe("image/png,image/jpeg,image/webp");
    expect(image.exampleFilename).toBe("image.jpg");
    expect(image.supportedInteractions).toEqual(["none", "spatial-shapes"]);
    expect(supportsAnnotation(image, "temporal-regions")).toBe(false);
    expect(image.moduleContext.interactionDefaults).toMatchObject({ frame_aware: false });
    expect(supportsAnnotation(getMediaPlugin("video")!, "spatial-shapes")).toBe(true);
    expect(getMediaPlugin("video")!.moduleContext.interactionDefaults).toMatchObject({ frame_aware: true });
  });

  it("registers five inherited spatial children with modality-owned defaults", () => {
    const context = getMediaPlugin("image")!.moduleContext;
    for (const key of spatialKeys) {
      const module = getAnnotationPlugin(key)!;
      const schema = module.defaultSchema(context);
      expect(module.requiredInteraction).toBe("spatial-shapes");
      expect(schema).toMatchObject({
        annotation_type: key,
        schema_version: 1,
        choices: expect.any(Array),
        max_shapes: 100,
        frame_aware: false,
        time_tolerance: 0.1,
      });
      expect(module.validateSchema(schema)).toEqual([]);
      expect(module.schemaForContext(schema, getMediaPlugin("video")!.moduleContext)).toMatchObject({
        frame_aware: true,
      });
    }
  });

  it("maps backend answer collections to generic overlay shapes and back", () => {
    const module = getAnnotationPlugin("bounding_box")!;
    const schema = module.defaultSchema(getMediaPlugin("image")!.moduleContext);
    const onChange = vi.fn();
    const answer = {
      boxes: [{ id: "box-1", label: "Object", x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
    };
    const interaction = module.createInteraction(schema, answer, onChange);
    expect(interaction.kind).toBe("spatial-shapes");
    if (interaction.kind !== "spatial-shapes") throw new Error("wrong interaction");
    expect(interaction.shapes[0]).toMatchObject({ kind: "bounding_box", id: "box-1" });
    const shape = interaction.shapes[0];
    if (shape.kind !== "bounding_box") throw new Error("wrong shape");
    interaction.onChange([{ ...shape, x: 0.25 }]);
    expect(onChange).toHaveBeenCalledWith({
      boxes: [{ id: "box-1", label: "Object", x: 0.25, y: 0.2, width: 0.3, height: 0.4 }],
    });
  });

  it("owns collection-specific examples, completion, and validation", () => {
    const context = getMediaPlugin("image")!.moduleContext;
    for (const key of spatialKeys) {
      const module = getAnnotationPlugin(key)!;
      const schema = module.defaultSchema(context);
      const empty = module.createInitialAnswer(schema);
      const example = module.createGoldExample(schema);
      expect(module.isComplete(schema, empty)).toBe(false);
      expect(module.isComplete(schema, example)).toBe(true);
      expect(module.validateGold(example, schema)).toEqual([]);
      expect(module.goldAnswerShape(schema)).toContain("id");
      expect(module.validateGold({ wrong: [] }, schema).length).toBeGreaterThan(0);
    }
  });
});
