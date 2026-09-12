import { lazy } from "react";
import type { MediaPlugin, MediaPreviewProps } from "../contracts";

function AudioPreview({ mediaUrl, title }: MediaPreviewProps) {
  return (
    <audio className="media-preview" controls preload="metadata" src={mediaUrl} title={title}>
      Your browser does not support audio playback.
    </audio>
  );
}

export const audioPlugin: MediaPlugin = {
  key: "audio",
  name: "Audio",
  accept: "audio/*",
  uploadTitle: "Choose audio files",
  uploadHelp: "MP3, WAV, or other browser-supported audio",
  exampleFilename: "clip.wav",
  supportedInteractions: ["none", "temporal-regions", "labeled-temporal-regions"],
  AnnotationRenderer: lazy(() => import("../../components/annotator/AudioMediaRenderer")),
  PreviewRenderer: AudioPreview,
};
