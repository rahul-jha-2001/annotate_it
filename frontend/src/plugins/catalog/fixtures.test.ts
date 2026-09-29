import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { getAnnotationPlugin } from "../annotations/registry";
import { listCatalogPresets } from "./registry";

const expectedSlugs = [
  "action-recognition",
  "audio-classification-multi",
  "audio-classification-single",
  "bounding-box",
  "ellipse",
  "keypoint",
  "polygon",
  "polyline",
  "segment",
  "sound-event",
  "speaker-diarization",
  "speaker-identification",
  "speech-segmentation",
  "transcription",
  "video-event",
].sort();

const publicFile = (path: string) => resolve(process.cwd(), "public", path.replace(/^\//, ""));

describe("catalog fixtures", () => {
  it("discovers every implemented annotation experience", () => {
    const presets = listCatalogPresets();
    expect(presets.map(item => item.slug).sort()).toEqual(expectedSlugs);
    expect(presets.every(item => item.samples.length >= 2)).toBe(true);
    expect(presets.filter(item => item.modality === "audio")).toHaveLength(8);
    expect(presets.filter(item => item.modality === "image")).toHaveLength(5);
    expect(presets.filter(item => item.modality === "video")).toHaveLength(2);
  });

  it("ships every declared media, raw-data, and bundle path", () => {
    for (const preset of listCatalogPresets()) {
      const paths = [
        ...preset.samples.map(sample => sample.mediaPath),
        preset.metadataPath,
        preset.goldAnswersPath,
        preset.exampleBundlePath,
      ];
      for (const path of paths) {
        const file = publicFile(path);
        expect(existsSync(file), `${preset.slug}: ${path}`).toBe(true);
        expect(statSync(file).size, `${preset.slug}: ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps raw gold files aligned with module-validated typed samples", () => {
    for (const preset of listCatalogPresets()) {
      const module = getAnnotationPlugin(preset.annotationType)!;
      const raw = JSON.parse(readFileSync(publicFile(preset.goldAnswersPath), "utf8")) as Array<{
        filename: string;
        answer: unknown;
      }>;
      for (const item of raw) {
        expect(preset.samples.some(sample => sample.filename === item.filename)).toBe(true);
        expect(module.validateGold(item.answer, preset.schema)).toEqual([]);
      }
    }
  });
});
