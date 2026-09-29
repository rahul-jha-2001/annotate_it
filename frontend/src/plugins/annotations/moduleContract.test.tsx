import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type {
  BaseAnnotationSchema,
  ConfigurationEditorProps,
  TypedAnnotationControlProps,
} from "../contracts";
import { BaseAnnotationModule } from "./BaseAnnotationModule";
import { AnnotationModuleRegistry } from "./registry";

interface DummySchema extends BaseAnnotationSchema {
  annotation_type: "dummy";
  schema_version: 1;
}

interface DummyAnswer {
  value: string;
}

const EmptyComponent = (() => null) as ComponentType<
  ConfigurationEditorProps<DummySchema>
>;
const EmptyControl = (() => null) as ComponentType<
  TypedAnnotationControlProps<DummySchema, DummyAnswer>
>;
const EmptyAnswer = (() => null) as ComponentType<{ answer: DummyAnswer }>;

class DummyModule extends BaseAnnotationModule<DummySchema, DummyAnswer> {
  readonly key = "dummy";
  readonly name = "Dummy";
  readonly schemaVersion = 1;
  readonly requiredInteraction = "none" as const;
  readonly ConfigurationEditor = EmptyComponent;
  readonly Control = EmptyControl;
  readonly AnswerView = EmptyAnswer;

  defaultSchema(_context: { interactionDefaults: Record<string, unknown> }): DummySchema {
    return { annotation_type: "dummy", schema_version: 1 };
  }

  createInitialAnswer(): DummyAnswer {
    return { value: "" };
  }

  createInteraction() {
    return { kind: "none" as const };
  }

  isComplete(_schema: DummySchema, answer: DummyAnswer): boolean {
    return Boolean(answer.value);
  }

  validateAnswer(answer: unknown): string[] {
    return typeof (answer as DummyAnswer | undefined)?.value === "string"
      ? []
      : ["value is required"];
  }

  createGoldExample(): DummyAnswer {
    return { value: "example" };
  }
}

describe("annotation module base", () => {
  it("owns shared envelope, validation formatting, and readonly behavior", () => {
    const module = new DummyModule();
    const schema = module.defaultSchema({ interactionDefaults: {} });

    expect(module.createGoldEnvelope("sample.wav", schema)).toEqual({
      filename: "sample.wav",
      answer: { value: "example" },
    });
    expect(module.formatValidationErrors(["first", "second"])).toBe(
      "first; second",
    );
    expect(module.createReadonlyInteraction(schema, { value: "a" })).toEqual({
      kind: "none",
      readonly: true,
    });
    expect(module.prepareAnswer(schema, {})).toEqual({ value: "" });
    expect(module.prepareAnswer(schema, { value: "ready", stale: true })).toEqual({
      value: "ready",
    });
    expect(module.prepareAnswer(schema, { value: 42 })).toEqual({ value: "" });
  });

  it("rejects duplicate keys at the single registry boundary", () => {
    const registry = new AnnotationModuleRegistry();
    const module = registry.register(new DummyModule());
    expect(Object.isFrozen(module)).toBe(true);
    expect(() => registry.register(new DummyModule())).toThrow(/already registered/);
  });

  it("rejects child replacements of base-owned lifecycle methods", () => {
    class InvalidModule extends DummyModule {
      formatValidationErrors(errors: string[]): string {
        return errors.join(",");
      }
    }

    expect(() => new AnnotationModuleRegistry().register(new InvalidModule())).toThrow(
      /formatValidationErrors/,
    );
  });

  it("requires every initial answer to declare its top-level fields", () => {
    class EmptyInitialAnswerModule extends DummyModule {
      createInitialAnswer(): DummyAnswer {
        return {} as DummyAnswer;
      }
    }

    expect(() => new AnnotationModuleRegistry().register(new EmptyInitialAnswerModule())).toThrow(
      /initial answer must declare/,
    );
  });
});
