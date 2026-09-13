import type { ComponentType, LazyExoticComponent } from "react";
import type { AnnotationAnswer, LabelSchema } from "../components/annotator/types";
import type { SpatialShape, SpatialTool } from "./spatial/types";

export interface TemporalRegion {
  start: number;
  end: number;
}

export interface LabeledTemporalRegion extends TemporalRegion {
  label: string;
}

export type MediaInteraction =
  | { kind: "none"; readonly?: boolean }
  | {
      kind: "temporal-regions";
      regions: TemporalRegion[];
      onChange: (regions: TemporalRegion[]) => void;
      readonly?: boolean;
    }
  | {
      kind: "labeled-temporal-regions";
      regions: LabeledTemporalRegion[];
      newRegionLabel: string;
      onChange: (regions: LabeledTemporalRegion[]) => void;
      readonly?: boolean;
    }
  | {
      kind: "spatial-shapes";
      tool: SpatialTool;
      shapes: SpatialShape[];
      newShapeLabel: string;
      frameAware: boolean;
      timeTolerance: number;
      creationTime?: number;
      canCreate?: boolean;
      onChange: (shapes: SpatialShape[]) => void;
      readonly?: boolean;
    };

export type MediaInteractionKind = MediaInteraction["kind"];

export interface MediaRendererProps {
  mediaUrl: string;
  interaction: MediaInteraction;
}

export interface MediaPreviewProps {
  mediaUrl: string;
  title?: string;
}

export interface MediaPlugin {
  key: string;
  name: string;
  accept: string;
  uploadTitle: string;
  uploadHelp: string;
  exampleFilename: string;
  supportedInteractions: MediaInteractionKind[];
  AnnotationRenderer: LazyExoticComponent<ComponentType<MediaRendererProps>>;
  PreviewRenderer: ComponentType<MediaPreviewProps>;
}

export interface BaseAnnotationSchema {
  annotation_type: string;
  schema_version: number;
}

export interface AnnotationModuleContext {
  interactionDefaults: Record<string, unknown>;
}

export interface ConfigurationEditorProps<SchemaT extends BaseAnnotationSchema> {
  schema: SchemaT;
  onChange: (schema: SchemaT) => void;
}

export interface TypedAnnotationControlProps<
  SchemaT extends BaseAnnotationSchema,
  AnswerT extends object,
> {
  schema: SchemaT;
  answer: AnswerT;
  onChange: (answer: AnswerT) => void;
}

export interface AnnotationControlProps {
  schema: LabelSchema;
  answer: AnnotationAnswer;
  onChange: (answer: AnnotationAnswer) => void;
}

export interface AnnotationPlugin {
  key: string;
  description: (mediaName: string) => string;
  requiredInteraction: MediaInteractionKind;
  Control: ComponentType<AnnotationControlProps>;
  PreviewInteractionEditor?: ComponentType<Pick<AnnotationControlProps, "answer" | "onChange">>;
  AnswerView: ComponentType<{ answer: AnnotationAnswer }>;
  createInitialAnswer: () => AnnotationAnswer;
  createInteraction: (
    answer: AnnotationAnswer,
    onChange: (answer: AnnotationAnswer) => void,
  ) => MediaInteraction;
  isComplete: (schema: LabelSchema, answer: AnnotationAnswer) => boolean;
  validateGold: (answer: unknown, schema: LabelSchema) => string[];
  goldAnswerShape: (schema: LabelSchema) => string;
  createGoldExample: (schema: LabelSchema) => Record<string, unknown>;
  goldGuidance?: string;
}
