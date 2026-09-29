import { useState } from "react";

import type { MediaRendererProps } from "../../plugins/contracts";
import SpatialOverlay from "../../plugins/spatial/SpatialOverlay";

export default function ImageMediaRenderer({ mediaUrl, interaction, onReady, onError }: MediaRendererProps) {
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(false);

  return (
    <div className="glass-panel media-annotation-panel">
      {failed ? (
        <p className="form-error">This image could not be decoded. Check the file and try again.</p>
      ) : (
        <div
          className="spatial-media-stage"
          style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
        >
          <img
            className="annotation-image"
            src={mediaUrl}
            alt="Sample to annotate"
            onLoad={event => {
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
              onReady?.();
            }}
            onError={() => { setFailed(true); onError?.("Image could not be loaded or decoded."); }}
          />
          {interaction.kind === "spatial-shapes" && (
            <SpatialOverlay
              interaction={interaction}
              mediaWidth={dimensions.width}
              mediaHeight={dimensions.height}
            />
          )}
        </div>
      )}
    </div>
  );
}
