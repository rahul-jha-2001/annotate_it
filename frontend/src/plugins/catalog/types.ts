import type { BaseAnnotationSchema } from "../contracts";

export type CatalogMetadataValue = string | number | boolean;

export interface CatalogSample {
  filename: string;
  mediaPath: string;
  metadata: Record<string, CatalogMetadataValue>;
  goldAnswer?: unknown;
}

export interface AnnotationCatalogPreset<SchemaT extends BaseAnnotationSchema> {
  slug: string;
  title: string;
  summary: string;
  family: string;
  useCases: string[];
  modality: string;
  schema: SchemaT;
  samples: CatalogSample[];
  metadataDescription: string;
  scoringDescription: string;
  metadataPath: string;
  goldAnswersPath: string;
  exampleBundlePath: string;
}

export interface ValidatedCatalogPreset
  extends AnnotationCatalogPreset<BaseAnnotationSchema> {
  annotationType: string;
  annotationName: string;
  modalityName: string;
}

export interface ComingSoonCatalogEntry {
  slug: string;
  title: string;
  summary: string;
  family: string;
  modalities: string[];
  useCases: string[];
}
