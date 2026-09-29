import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type {
  AnnotationModuleContext,
  BaseAnnotationSchema,
  ConfigurationEditorProps,
  MediaPlugin,
  TypedAnnotationControlProps,
} from "../contracts";
import { BaseAnnotationModule } from "../annotations/BaseAnnotationModule";
import { audioPlugin } from "../media/audio";
import { buildCatalog } from "./registry";
import type { AnnotationCatalogPreset } from "./types";

interface TestSchema extends BaseAnnotationSchema {
  annotation_type: "catalog_test";
  schema_version: 1;
  choices: string[];
}

interface TestAnswer { value: string }

const EmptyConfiguration = (() => null) as ComponentType<ConfigurationEditorProps<TestSchema>>;
const EmptyControl = (() => null) as ComponentType<TypedAnnotationControlProps<TestSchema, TestAnswer>>;
const EmptyAnswer = (() => null) as ComponentType<{ answer: TestAnswer }>;

const validPreset = (): AnnotationCatalogPreset<TestSchema> => ({
  slug: "catalog-test",
  title: "Catalog test",
  summary: "A valid catalog preset",
  family: "Testing",
  useCases: ["Contract testing"],
  modality: "audio",
  schema: { annotation_type: "catalog_test", schema_version: 1, choices: ["Known"] },
  samples: [{
    filename: "sample.wav",
    mediaPath: "/catalog/catalog-test/media/sample.wav",
    metadata: { language: "English" },
    goldAnswer: { value: "Known" },
  }],
  metadataDescription: "Example metadata",
  scoringDescription: "Exact match",
  metadataPath: "/catalog/catalog-test/metadata.csv",
  goldAnswersPath: "/catalog/catalog-test/gold_answers.json",
  exampleBundlePath: "/catalog/catalog-test/catalog-test-example.zip",
});

class CatalogTestModule extends BaseAnnotationModule<TestSchema, TestAnswer> {
  readonly key = "catalog_test" as const;
  readonly name = "Catalog test";
  readonly schemaVersion = 1 as const;
  readonly requiredInteraction = "none" as const;
  readonly ConfigurationEditor = EmptyConfiguration;
  readonly Control = EmptyControl;
  readonly AnswerView = EmptyAnswer;

  constructor(private readonly presets: AnnotationCatalogPreset<TestSchema>[] = [validPreset()]) {
    super();
  }

  defaultSchema(): TestSchema {
    return { annotation_type: "catalog_test", schema_version: 1, choices: ["Known"] };
  }
  createInitialAnswer(): TestAnswer { return { value: "" }; }
  createInteraction() { return { kind: "none" as const }; }
  isComplete(_schema: TestSchema, answer: TestAnswer) { return Boolean(answer.value); }
  validateSchema(schema: TestSchema) { return schema.choices.length ? [] : ["At least one choice is required"]; }
  validateAnswer(answer: unknown, schema: TestSchema) {
    const value = (answer as TestAnswer | undefined)?.value;
    return typeof value === "string" && schema.choices.includes(value) ? [] : [`Unknown gold label: ${String(value)}`];
  }
  createGoldExample(): TestAnswer { return { value: "Known" }; }
  catalogPresets(_context: AnnotationModuleContext) { return this.presets; }
}

const moduleWith = (patch: Partial<AnnotationCatalogPreset<TestSchema>>) =>
  new CatalogTestModule([{ ...validPreset(), ...patch }]);

describe("annotation catalog registry", () => {
  it("discovers and enriches a valid module-owned preset", () => {
    expect(buildCatalog([new CatalogTestModule()], [audioPlugin])).toEqual([
      expect.objectContaining({
        slug: "catalog-test",
        annotationType: "catalog_test",
        annotationName: "Catalog test",
        modalityName: "Audio",
      }),
    ]);
  });

  it.each([
    ["blank slug", moduleWith({ slug: "" }), /slug cannot be blank/],
    ["missing modality", moduleWith({ modality: "missing" }), /unknown modality/],
    ["schema type", moduleWith({ schema: { ...validPreset().schema, annotation_type: "other" } as unknown as TestSchema }), /schema type/],
    ["schema version", moduleWith({ schema: { ...validPreset().schema, schema_version: 2 } as unknown as TestSchema }), /schema version/],
    ["invalid schema", moduleWith({ schema: { ...validPreset().schema, choices: [] } }), /At least one choice/],
    ["duplicate filenames", moduleWith({ samples: [validPreset().samples[0], validPreset().samples[0]] }), /duplicate sample filename/],
    ["invalid gold", moduleWith({ samples: [{ ...validPreset().samples[0], goldAnswer: { value: "Unknown" } }] }), /Unknown gold label/],
    ["blank media path", moduleWith({ samples: [{ ...validPreset().samples[0], mediaPath: "" }] }), /media path cannot be blank/],
    ["blank metadata path", moduleWith({ metadataPath: "" }), /metadata path cannot be blank/],
    ["blank gold path", moduleWith({ goldAnswersPath: "" }), /gold answers path cannot be blank/],
    ["blank bundle path", moduleWith({ exampleBundlePath: "" }), /bundle path cannot be blank/],
  ])("rejects %s", (_name, module, message) => {
    expect(() => buildCatalog([module as CatalogTestModule], [audioPlugin])).toThrow(message as RegExp);
  });

  it("rejects duplicate slugs across modules", () => {
    expect(() => buildCatalog([new CatalogTestModule(), new CatalogTestModule()], [audioPlugin]))
      .toThrow(/duplicate catalog slug/);
  });

  it("rejects an incompatible media interaction", () => {
    const incompatibleAudio = {
      ...audioPlugin,
      supportedInteractions: ["temporal-regions"],
    } as MediaPlugin;
    expect(() => buildCatalog([new CatalogTestModule()], [incompatibleAudio]))
      .toThrow(/does not support none/);
  });
});
