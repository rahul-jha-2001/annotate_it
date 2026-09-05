import type { AnnotationPlugin } from "../contracts";
import { categoricalPlugin } from "./categorical";
import { segmentPlugin } from "./segment";

const plugins = [categoricalPlugin, segmentPlugin];

export const annotationPlugins: Record<string, AnnotationPlugin> = Object.fromEntries(
  plugins.map(plugin => [plugin.key, plugin]),
);

export const getAnnotationPlugin = (key: string) => annotationPlugins[key];
