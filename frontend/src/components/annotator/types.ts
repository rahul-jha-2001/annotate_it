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
  requires_qualification: boolean;
  qualification_form: QualificationQuestion[];
}

export interface QualificationQuestion {
  key: string;
  label: string;
  type: "single_choice" | "multi_choice" | "boolean" | "number";
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
