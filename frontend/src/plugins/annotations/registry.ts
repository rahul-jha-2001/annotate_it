import { BaseAnnotationModule } from "./BaseAnnotationModule";
import { categoricalPlugin } from "./categorical";
import { segmentPlugin } from "./segment";
import { transcriptionPlugin } from "./transcription";
import { temporalTaskModules } from "./temporalTasks";
import { spatialTaskModules } from "./spatialTasks";

type AnyAnnotationModule = BaseAnnotationModule<any, any>;

export class AnnotationModuleRegistry {
  private readonly modules = new Map<string, AnyAnnotationModule>();

  register<ModuleT extends AnyAnnotationModule>(module: ModuleT): ModuleT {
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
temporalTaskModules.forEach(module => registry.register(module));
spatialTaskModules.forEach(module => registry.register(module));

export const annotationPlugins: Record<string, AnyAnnotationModule> = Object.fromEntries(
  registry.values().map(module => [module.key, module]),
);
export const getAnnotationPlugin = (key: string) => registry.get(key);
export const listAnnotationModules = () => registry.values();
