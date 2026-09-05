import type { MediaInteractionKind, MediaPlugin } from "../contracts";
import { audioPlugin } from "./audio";
import { videoPlugin } from "./video";

const plugins = [audioPlugin, videoPlugin];

export const mediaPlugins: Record<string, MediaPlugin> = Object.fromEntries(
  plugins.map(plugin => [plugin.key, plugin]),
);

export const listMediaPlugins = () => plugins;
export const getMediaPlugin = (key: string) => mediaPlugins[key];

export function supportsAnnotation(media: MediaPlugin, requiredInteraction: MediaInteractionKind): boolean {
  return media.supportedInteractions.includes(requiredInteraction);
}
