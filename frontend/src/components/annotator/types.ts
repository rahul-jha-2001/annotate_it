export interface AnnotationSchemaMap {}
export interface AnnotationAnswerMap {}

export type LabelSchema = AnnotationSchemaMap[keyof AnnotationSchemaMap];
export type AnnotationAnswer = AnnotationAnswerMap[keyof AnnotationAnswerMap];

export interface TeachingExampleItem {
  data_unit_id: string;
  media_url: string;
  displayed_answer: AnnotationAnswer;
  explanation?: string | null;
  filename?: string | null;
  keep_as_gold?: boolean;
}

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
  requires_teaching_examples?: boolean;
  teaching_examples?: TeachingExampleItem[];
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
