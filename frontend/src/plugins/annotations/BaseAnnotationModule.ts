import type { ComponentType } from "react";

import type {
  AnnotationModuleContext,
  BaseAnnotationSchema,
  ConfigurationEditorProps,
  MediaInteraction,
  MediaInteractionKind,
  TypedAnnotationControlProps,
} from "../contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasCompatibleValueShape = (fallback: unknown, candidate: unknown): boolean => {
  if (Array.isArray(fallback)) return Array.isArray(candidate);
  if (isRecord(fallback)) return isRecord(candidate);
  return typeof fallback === typeof candidate;
};

export abstract class BaseAnnotationModule<
  SchemaT extends BaseAnnotationSchema,
  AnswerT extends object,
> {
  abstract readonly key: SchemaT["annotation_type"];
  abstract readonly name: string;
  abstract readonly schemaVersion: SchemaT["schema_version"];
  abstract readonly requiredInteraction: MediaInteractionKind;
  abstract readonly ConfigurationEditor: ComponentType<
    ConfigurationEditorProps<SchemaT>
  >;
  abstract readonly Control: ComponentType<
    TypedAnnotationControlProps<SchemaT, AnswerT>
  >;
  abstract readonly AnswerView: ComponentType<{ answer: AnswerT }>;
  readonly PreviewInteractionEditor?: ComponentType<
    TypedAnnotationControlProps<SchemaT, AnswerT>
  >;

  description(mediaName: string): string {
    return `Annotate this ${mediaName.toLowerCase()} sample`;
  }

  abstract defaultSchema(context: AnnotationModuleContext): SchemaT;

  schemaForContext(schema: SchemaT, _context: AnnotationModuleContext): SchemaT {
    return schema;
  }

  abstract createInitialAnswer(schema: SchemaT): AnswerT;

  prepareAnswer(schema: SchemaT, answer: unknown): AnswerT {
    const initial = this.createInitialAnswer(schema);
    if (!isRecord(answer)) return initial;
    return Object.fromEntries(
      Object.entries(initial).map(([field, fallback]) => [
        field,
        hasCompatibleValueShape(fallback, answer[field]) ? answer[field] : fallback,
      ]),
    ) as AnswerT;
  }

  abstract createInteraction(
    schema: SchemaT,
    answer: AnswerT,
    onChange: (answer: AnswerT) => void,
  ): MediaInteraction;
  abstract isComplete(schema: SchemaT, answer: AnswerT): boolean;
  abstract validateAnswer(answer: unknown, schema: SchemaT): string[];
  abstract createGoldExample(schema: SchemaT): AnswerT;

  goldAnswerShape(_schema: SchemaT): string {
    return "A JSON object matching this task's answer schema";
  }

  validateSchema(_schema: SchemaT): string[] {
    return [];
  }

  validateGold(answer: unknown, schema: SchemaT): string[] {
    return this.validateAnswer(answer, schema);
  }

  goldInstructions(_schema: SchemaT): string[] {
    return this.goldGuidance ? [this.goldGuidance] : [];
  }

  readonly goldGuidance?: string;

  createGoldEnvelope(filename: string, schema: SchemaT) {
    return { filename, answer: this.createGoldExample(schema) };
  }

  formatValidationErrors(errors: string[]): string {
    return errors.join("; ");
  }

  createReadonlyInteraction(schema: SchemaT, answer: AnswerT): MediaInteraction {
    return {
      ...this.createInteraction(schema, this.prepareAnswer(schema, answer), () => undefined),
      readonly: true,
    };
  }

  assertContract(): void {
    const baseOwnedMethods = [
      "createGoldEnvelope",
      "formatValidationErrors",
      "createReadonlyInteraction",
      "validateGold",
      "prepareAnswer",
    ];
    let prototype = Object.getPrototypeOf(this) as object | null;
    while (prototype && prototype !== BaseAnnotationModule.prototype) {
      const replacement = baseOwnedMethods.find(method =>
        Object.prototype.hasOwnProperty.call(prototype, method),
      );
      if (replacement) {
        throw new Error(`annotation modules cannot replace base lifecycle method: ${replacement}`);
      }
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    if (!this.key.trim()) throw new Error("annotation module key cannot be blank");
    if (!this.name.trim()) throw new Error("annotation module name cannot be blank");
    if (!Number.isInteger(this.schemaVersion) || this.schemaVersion < 1) {
      throw new Error("annotation module schemaVersion must be a positive integer");
    }
    const schema = this.defaultSchema({ interactionDefaults: {} });
    if (schema.annotation_type !== this.key) {
      throw new Error(`default schema type does not match module key: ${this.key}`);
    }
    if (schema.schema_version !== this.schemaVersion) {
      throw new Error(`default schema version does not match module: ${this.key}`);
    }
    const initialAnswer = this.createInitialAnswer(schema);
    if (!isRecord(initialAnswer) || Object.keys(initialAnswer).length === 0) {
      throw new Error(`initial answer must declare its top-level fields: ${this.key}`);
    }
  }
}
