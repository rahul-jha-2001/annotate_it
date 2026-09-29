export interface AnnotationSchemaMap {}
export interface AnnotationAnswerMap {}

export type LabelSchema = AnnotationSchemaMap[keyof AnnotationSchemaMap];
export type AnnotationAnswer = AnnotationAnswerMap[keyof AnnotationAnswerMap];

export interface AnnotationSession {
  session_token: string;
  experiment_id: string;
  modality: string;
  instructions?: string;
  label_schema: LabelSchema;
  access_mode: "sign_in_required" | "guest_name" | "anonymous";
  annotator_display_name?: string | null;
  requires_qualification: boolean;
  qualification_form: QualificationQuestion[];
}

export interface QualificationQuestion {
  key: string;
  label: string;
  type: "single_choice" | "multi_choice" | "boolean" | "number" | "text";
  required: boolean;
  options: string[];
  minimum?: number | null;
  maximum?: number | null;
}
