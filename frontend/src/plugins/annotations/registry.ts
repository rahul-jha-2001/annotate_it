import type { BaseAnnotationSchema } from "../contracts";
import { BaseAnnotationModule } from "./BaseAnnotationModule";
import { categoricalPlugin } from "./categorical";
import { segmentPlugin } from "./segment";
import { transcriptionPlugin } from "./transcription";

type AnyAnnotationModule = BaseAnnotationModule<any, any>;

export class AnnotationModuleRegistry {
  private readonly modules = new Map<string, AnyAnnotationModule>();

  register<SchemaT extends BaseAnnotationSchema, AnswerT extends object>(
    module: BaseAnnotationModule<SchemaT, AnswerT>,
  ): BaseAnnotationModule<SchemaT, AnswerT> {
    module.assertContract();
    if (this.modules.has(module.key)) {
      throw new Error(`annotation module already registered: ${module.key}`);
    }
    Object.freeze(module);
    this.modules.set(module.key, module as unknown as AnyAnnotationModule);
    return module;
  }

  get(key: string): AnyAnnotationModule | undefined {
    return this.modules.get(key);
  }

  values(): AnyAnnotationModule[] {
    return [...this.modules.values()];
  }
}

const registry = new AnnotationModuleRegistry();
registry.register(categoricalPlugin);
registry.register(segmentPlugin);
registry.register(transcriptionPlugin);

export const annotationPlugins: Record<string, AnyAnnotationModule> = Object.fromEntries(
  registry.values().map(module => [module.key, module]),
);
export const getAnnotationPlugin = (key: string) => registry.get(key);
export const listAnnotationModules = () => registry.values();
