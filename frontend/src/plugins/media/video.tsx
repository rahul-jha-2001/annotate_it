import { lazy } from "react";
import type { MediaPlugin, MediaPreviewProps } from "../contracts";

function VideoPreview({ mediaUrl, title }: MediaPreviewProps) {
  return (
    <video className="media-preview video-preview" controls preload="metadata" src={mediaUrl} title={title}>
      Your browser does not support video playback.
    </video>
  );
}

export const videoPlugin: MediaPlugin = {
  key: "video",
  name: "Video",
  accept: "video/*",
  uploadTitle: "Choose video files",
  uploadHelp: "MP4, WebM, or other browser-supported video",
  exampleFilename: "clip.mp4",
  supportedInteractions: ["none", "temporal-regions", "labeled-temporal-regions"],
  AnnotationRenderer: lazy(() => import("../../components/annotator/VideoMediaRenderer")),
  PreviewRenderer: VideoPreview,
};
