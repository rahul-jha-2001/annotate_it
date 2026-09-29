import type { MediaPlugin } from "../contracts";
import { listAnnotationModules, supportsAnnotationModule } from "../annotations/registry";
import type { BaseAnnotationModule } from "../annotations/BaseAnnotationModule";
import { listMediaPlugins } from "../media/registry";
import type { AnnotationCatalogPreset, ValidatedCatalogPreset } from "./types";

type AnyAnnotationModule = BaseAnnotationModule<any, any>;

const requireText = (value: string, field: string, slug: string) => {
  if (!value.trim()) throw new Error(`catalog preset ${slug || "<blank>"}: ${field} cannot be blank`);
};

const validatePreset = (
  module: AnyAnnotationModule,
  preset: AnnotationCatalogPreset<any>,
  mediaPlugins: MediaPlugin[],
): ValidatedCatalogPreset => {
  requireText(preset.slug, "slug", preset.slug);
  requireText(preset.title, "title", preset.slug);
  requireText(preset.summary, "summary", preset.slug);
  requireText(preset.family, "family", preset.slug);
  requireText(preset.metadataDescription, "metadata description", preset.slug);
  requireText(preset.scoringDescription, "scoring description", preset.slug);
  requireText(preset.metadataPath, "metadata path", preset.slug);
  requireText(preset.goldAnswersPath, "gold answers path", preset.slug);
  requireText(preset.exampleBundlePath, "bundle path", preset.slug);
  if (!preset.useCases.length || preset.useCases.some(value => !value.trim())) {
    throw new Error(`catalog preset ${preset.slug}: use cases cannot be empty`);
  }

  const media = mediaPlugins.find(candidate => candidate.key === preset.modality);
  if (!media) throw new Error(`catalog preset ${preset.slug}: unknown modality ${preset.modality}`);
  if (!supportsAnnotationModule(media, module)) {
    throw new Error(`catalog preset ${preset.slug}: ${media.name} does not support ${module.requiredInteraction}`);
  }
  if (preset.schema.annotation_type !== module.key) {
    throw new Error(`catalog preset ${preset.slug}: schema type must be ${module.key}`);
  }
  if (preset.schema.schema_version !== module.schemaVersion) {
    throw new Error(`catalog preset ${preset.slug}: schema version must be ${module.schemaVersion}`);
  }
  const schemaErrors = module.validateSchema(preset.schema);
  if (schemaErrors.length) {
    throw new Error(`catalog preset ${preset.slug}: ${module.formatValidationErrors(schemaErrors)}`);
  }
  if (!preset.samples.length) throw new Error(`catalog preset ${preset.slug}: at least one sample is required`);
  const filenames = new Set<string>();
  for (const sample of preset.samples) {
    requireText(sample.filename, "sample filename", preset.slug);
    requireText(sample.mediaPath, "media path", preset.slug);
    if (filenames.has(sample.filename)) {
      throw new Error(`catalog preset ${preset.slug}: duplicate sample filename ${sample.filename}`);
    }
    filenames.add(sample.filename);
    if (sample.goldAnswer !== undefined) {
      const goldErrors = module.validateGold(sample.goldAnswer, preset.schema);
      if (goldErrors.length) {
        throw new Error(`catalog preset ${preset.slug}: ${module.formatValidationErrors(goldErrors)}`);
      }
    }
  }

  return Object.freeze({
    ...preset,
    annotationType: module.key,
    annotationName: module.name,
    modalityName: media.name,
  });
};

export function buildCatalog(
  modules: AnyAnnotationModule[],
  mediaPlugins: MediaPlugin[],
): ValidatedCatalogPreset[] {
  const slugs = new Set<string>();
  const entries: ValidatedCatalogPreset[] = [];
  for (const module of modules) {
    const initialPresets = module.catalogPresets({ interactionDefaults: {} });
    for (const preset of initialPresets) {
      const media = mediaPlugins.find(candidate => candidate.key === preset.modality);
      const contextual = media
        ? module.catalogPresets(media.moduleContext).find(candidate => candidate.slug === preset.slug) ?? preset
        : preset;
      const validated = validatePreset(module, contextual, mediaPlugins);
      if (slugs.has(validated.slug)) throw new Error(`duplicate catalog slug: ${validated.slug}`);
      slugs.add(validated.slug);
      entries.push(validated);
    }
  }
  return entries;
}

let cachedCatalog: ValidatedCatalogPreset[] | undefined;

export function listCatalogPresets(): ValidatedCatalogPreset[] {
  cachedCatalog ??= buildCatalog(listAnnotationModules(), listMediaPlugins());
  return [...cachedCatalog];
}

export function getCatalogPreset(slug: string): ValidatedCatalogPreset | undefined {
  return listCatalogPresets().find(preset => preset.slug === slug);
}
