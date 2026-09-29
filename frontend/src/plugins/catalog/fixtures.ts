import type { BaseAnnotationSchema } from "../contracts";
import type {
  AnnotationCatalogPreset,
  CatalogMetadataValue,
  CatalogSample,
} from "./types";

export const catalogAsset = (slug: string, file: string) =>
  `/catalog/${slug}/${file}`;

export function defineCatalogPreset<SchemaT extends BaseAnnotationSchema>(
  preset: AnnotationCatalogPreset<SchemaT>,
): AnnotationCatalogPreset<SchemaT> {
  return preset;
}

export function catalogSamples(
  slug: string,
  rows: Array<{ filename: string; metadata: Record<string, CatalogMetadataValue>; goldAnswer?: unknown }>,
): CatalogSample[] {
  return rows.map(row => ({
    ...row,
    mediaPath: catalogAsset(slug, `media/${row.filename}`),
  }));
}

export const catalogBundlePaths = (slug: string) => ({
  metadataPath: catalogAsset(slug, "metadata.csv"),
  goldAnswersPath: catalogAsset(slug, "gold_answers.json"),
  exampleBundlePath: catalogAsset(slug, `${slug}-example.zip`),
});
