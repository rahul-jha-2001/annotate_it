import { getAnnotationPlugin } from "../../plugins/annotations/registry";
import type { AnnotationAnswer, LabelSchema } from "./types";

interface Props {
  schema: LabelSchema;
  answer: AnnotationAnswer;
  onChange: (answer: AnnotationAnswer) => void;
}

export function isAnswerComplete(schema: LabelSchema, answer: AnnotationAnswer): boolean {
  return getAnnotationPlugin(schema.annotation_type)?.isComplete(schema, answer) ?? false;
}

export default function AnnotationControl(props: Props) {
  const plugin = getAnnotationPlugin(props.schema.annotation_type);
  if (!plugin) return <p>Unsupported annotation type: {props.schema.annotation_type}</p>;
  const Control = plugin.Control;
  return <Control {...props} />;
}
