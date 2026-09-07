export interface LabelSchema {
  annotation_type: "categorical" | "segment" | string;
  choices: string[];
  multi_select: boolean;
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

export interface AnnotationAnswer {
  value?: string;
  values?: string[];
  label?: string;
  regions?: Array<{ start: number; end: number }>;
}
