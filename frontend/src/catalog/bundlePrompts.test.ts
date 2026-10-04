import { describe, expect, it } from "vitest";
import { listAnnotationModules, getAnnotationPlugin } from "../plugins/annotations/registry";
import {
  TASK_SECTIONS,
  assembleAgentPrompt,
  hasPromptForType,
  MAX_ZIP_GB,
} from "./bundlePrompts";
import { parseDatasetBundle } from "../components/datasetBundle";

describe("bundlePrompts specification", () => {
  // Test 1: Every registered annotation type key has a catalog entry.
  it("Test 1: every registered annotation type key has a prompt definition", () => {
    const modules = listAnnotationModules();
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(
        hasPromptForType(module.key),
        `Annotation module '${module.key}' is registered but missing a catalog agent prompt!`,
      ).toBe(true);
    }
  });

  // Test 2: Each entry's example answer is stored as structured data.
  // The test replaces <...> placeholders with labels from a sample config
  // and runs the example through the type's real validate_answer.
  it("Test 2: each entry's structured example answer validates against the real plugin validator", () => {
    const sampleLabels = ["LabelA", "LabelB", "LabelC"];

    function hydratePlaceholders(value: unknown): unknown {
      if (typeof value === "string") {
        if (value.startsWith("<") && value.endsWith(">")) {
          const lower = value.toLowerCase();
          if (lower.includes("choice") || lower.includes("label") || lower.includes("name")) {
            return sampleLabels[0];
          }
          if (lower.includes("id")) {
            return "shape-id-1";
          }
          if (lower.includes("transcript")) {
            return "Sample transcript sentence.";
          }
          return "test_value";
        }
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((item, idx) => {
          if (typeof item === "string" && item.startsWith("<") && item.endsWith(">")) {
            return sampleLabels[idx % sampleLabels.length];
          }
          return hydratePlaceholders(item);
        });
      }
      if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = hydratePlaceholders(v);
        }
        return result;
      }
      return value;
    }

    for (const taskDef of TASK_SECTIONS) {
      const plugin = getAnnotationPlugin(taskDef.key);
      expect(plugin, `Plugin for '${taskDef.key}' must be registered`).toBeDefined();
      if (!plugin) continue;

      const baseSchema = plugin.defaultSchema({ interactionDefaults: {} });
      const schema = {
        ...baseSchema,
        choices: sampleLabels,
        allow_custom_labels: false,
        multi_select: taskDef.variant === "multiple_choice",
      };

      const hydrated = hydratePlaceholders(taskDef.exampleAnswer);
      const errors = plugin.validateAnswer(hydrated, schema);
      expect(
        errors,
        `Task prompt '${taskDef.taskName}' example answer failed validation: ${errors.join(", ")}`,
      ).toEqual([]);
    }
  });

  // Test 3: The file envelopes the prompt describes are accepted by the real upload path.
  // Feed sample bundle (media filenames, metadata.csv, bare-array gold_answers.json) through parseDatasetBundle.
  it("Test 3: real upload path / dropzone accepts bare-array gold_answers.json and wrapped manifest", () => {
    const schema = {
      annotation_type: "categorical" as const,
      schema_version: 1 as const,
      choices: ["dog", "cat"],
      multi_select: false,
    };

    const filenames = ["sample1.png", "sample2.png"];
    const metadataCsv = "filename,difficulty\nsample1.png,easy\nsample2.png,hard";

    // 1. Bare array as described in prompt Step 4
    const bareGoldJson = JSON.stringify([
      { filename: "sample1.png", answer: { value: "dog" } },
      { filename: "sample2.png", answer: { value: "cat" } },
    ]);

    const bareResult = parseDatasetBundle(filenames, metadataCsv, bareGoldJson, { schema });
    expect(bareResult.errors).toEqual([]);
    expect(bareResult.rows.length).toBe(2);
    expect(bareResult.rows[0].goldAnswer).toEqual({ value: "dog" });
    expect(bareResult.rows[1].goldAnswer).toEqual({ value: "cat" });

    // 2. Wrapped format {"manifest": [...]}
    const wrappedGoldJson = JSON.stringify({
      manifest: [
        { filename: "sample1.png", answer: { value: "dog" } },
        { filename: "sample2.png", answer: { value: "cat" } },
      ],
    });

    const wrappedResult = parseDatasetBundle(filenames, metadataCsv, wrappedGoldJson, { schema });
    expect(wrappedResult.errors).toEqual([]);
    expect(wrappedResult.rows.length).toBe(2);
    expect(wrappedResult.rows[0].goldAnswer).toEqual({ value: "dog" });
    expect(wrappedResult.rows[1].goldAnswer).toEqual({ value: "cat" });
  });

  it("substitutes all tokens when assembling agent prompt", () => {
    const prompt = assembleAgentPrompt("bounding_box");
    expect(prompt).toContain("The annotation task is: bounding_box");
    expect(prompt).toContain(`Maximum archive size: ${MAX_ZIP_GB} GB`);
    const defaultShapes = (getAnnotationPlugin("bounding_box")!.defaultSchema({ interactionDefaults: {} }) as any).max_shapes;
    expect(prompt).toContain(`At most ${defaultShapes} shapes per answer`);
    expect(prompt).not.toContain("{{TASK_NAME}}");
    expect(prompt).not.toContain("{{MEDIA_TYPES}}");
    expect(prompt).not.toContain("{{MAX_ZIP_GB}}");
    expect(prompt).not.toContain("{{MAX_SHAPES}}");
    expect(prompt).toContain("import csv, json, os, unicodedata, zipfile");
  });

  it("assembles categorical multiple choice prompt when requested", () => {
    const prompt = assembleAgentPrompt("categorical", { multiSelect: true });
    expect(prompt).toContain("categorical (multiple choice)");
    expect(prompt).toContain('"values": [');
  });
});
