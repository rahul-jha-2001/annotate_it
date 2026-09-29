import { getAnnotationPlugin, supportsAnnotationModule } from "../plugins/annotations/registry";
import { getMediaPlugin } from "../plugins/media/registry";
import type { LabelSchema } from "./annotator/types";

export function schemaFingerprint(schema: object): string {
  return JSON.stringify(schema);
}

export function isDatasetAssemblyCurrent(
  assembledSchemaFingerprint: string | null,
  currentSchema: object,
): boolean {
  return assembledSchemaFingerprint !== null
    && assembledSchemaFingerprint === schemaFingerprint(currentSchema);
}


export interface ExperimentPreset { modality: string; schema: LabelSchema }

export function defaultExperimentPreset(): ExperimentPreset {
  const media = getMediaPlugin("audio")!;
  return { modality: media.key, schema: getAnnotationPlugin("categorical")!.defaultSchema(media.moduleContext) };
}

export function resolveExperimentPreset(search: string): ExperimentPreset {
  const fallback = defaultExperimentPreset();
  const params = new URLSearchParams(search);
  const modality = params.get("modality");
  const annotationType = params.get("annotation_type");
  if (!modality || !annotationType) return fallback;
  const media = getMediaPlugin(modality);
  const annotation = getAnnotationPlugin(annotationType);
  if (!media || !annotation || !supportsAnnotationModule(media, annotation)) return fallback;
  return { modality: media.key, schema: annotation.defaultSchema(media.moduleContext) };
}
