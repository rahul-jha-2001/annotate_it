import type { ComponentType, LazyExoticComponent } from "react";
import type { AnnotationAnswer, LabelSchema } from "../components/annotator/types";

export interface TemporalRegion {
  start: number;
  end: number;
}

export type MediaInteraction =
  | { kind: "none" }
  | {
      kind: "temporal-regions";
      regions: TemporalRegion[];
      onChange: (regions: TemporalRegion[]) => void;
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
