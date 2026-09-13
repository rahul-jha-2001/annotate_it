import { lazy, useState } from "react";

import type { MediaPlugin, MediaPreviewProps } from "../contracts";

function ImagePreview({ mediaUrl, title }: MediaPreviewProps) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="status-error">Image unavailable</span>
  ) : (
    <img className="media-preview image-preview" src={mediaUrl} alt={title ?? "Dataset image"} onError={() => setFailed(true)} />
  );
}

export const imagePlugin: MediaPlugin = {
  key: "image",
  name: "Image",
  accept: "image/png,image/jpeg,image/webp",
  uploadTitle: "Choose image files",
  uploadHelp: "PNG, JPEG, or WebP images",
  exampleFilename: "image.jpg",
  moduleContext: { interactionDefaults: { frame_aware: false, time_tolerance: 0.1 } },
  supportedInteractions: ["none", "spatial-shapes"],
  AnnotationRenderer: lazy(() => import("../../components/annotator/ImageMediaRenderer")),
  PreviewRenderer: ImagePreview,
};
