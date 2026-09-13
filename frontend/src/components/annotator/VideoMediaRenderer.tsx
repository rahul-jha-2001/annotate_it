import { useMemo, useRef, useState } from "react";
import { Pause, Play, Plus, Trash2 } from "lucide-react";
import type { MediaRendererProps } from "../../plugins/contracts";
import { labelColor } from "../../plugins/interactions/labelColors";
import SpatialOverlay from "../../plugins/spatial/SpatialOverlay";
import { canCreateAtPlaybackState, visibleShapesAtTime } from "../../plugins/spatial/videoTime";

export default function VideoMediaRenderer({ mediaUrl, interaction }: MediaRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [regionStart, setRegionStart] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState({ width: 16, height: 9 });
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const regions = interaction.kind === "temporal-regions" || interaction.kind === "labeled-temporal-regions" ? interaction.regions : [];
  const visibleSpatialShapes = useMemo(
    () => interaction.kind === "spatial-shapes" && interaction.frameAware
      ? visibleShapesAtTime(interaction.shapes, currentTime, interaction.timeTolerance)
      : interaction.kind === "spatial-shapes" ? interaction.shapes : [],
    [interaction, currentTime],
  );

  const markBoundary = () => {
    if ((interaction.kind !== "temporal-regions" && interaction.kind !== "labeled-temporal-regions") || !videoRef.current || interaction.readonly) return;
    const currentTime = videoRef.current.currentTime;
    if (regionStart === null) {
      setRegionStart(currentTime);
      return;
    }
    if (currentTime > regionStart) {
      if (interaction.kind === "labeled-temporal-regions") {
        interaction.onChange([...interaction.regions, { start: regionStart, end: currentTime, label: interaction.newRegionLabel }]);
      } else {
        interaction.onChange([...interaction.regions, { start: regionStart, end: currentTime }]);
      }
      setRegionStart(null);
    }
  };

  const removeRegion = (index: number) => {
    if (interaction.kind === "temporal-regions") {
      interaction.onChange(interaction.regions.filter((_, position) => position !== index));
    } else if (interaction.kind === "labeled-temporal-regions") {
      interaction.onChange(interaction.regions.filter((_, position) => position !== index));
    }
  };

  const spatialInteraction = interaction.kind === "spatial-shapes" ? {
    ...interaction,
    shapes: visibleSpatialShapes,
    creationTime: interaction.frameAware ? currentTime : undefined,
    canCreate: canCreateAtPlaybackState(paused),
    onChange: (changedVisibleShapes: typeof visibleSpatialShapes) => {
      const visibleIds = new Set(visibleSpatialShapes.map(shape => shape.id));
      interaction.onChange([
        ...interaction.shapes.filter(shape => !visibleIds.has(shape.id)),
        ...changedVisibleShapes,
      ]);
    },
  } : null;

  return (
    <div className="glass-panel media-annotation-panel" style={{ marginBottom: "20px" }}>
      <div className={interaction.kind === "spatial-shapes" ? "spatial-media-stage" : undefined} style={interaction.kind === "spatial-shapes" ? { aspectRatio: `${dimensions.width} / ${dimensions.height}` } : undefined}>
        <video
          ref={videoRef}
          className="annotation-video"
          controls={interaction.kind !== "spatial-shapes"}
          preload="metadata"
          src={mediaUrl}
          onLoadedMetadata={event => setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
          onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
          onSeeked={event => setCurrentTime(event.currentTarget.currentTime)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
        >
          Your browser does not support video playback.
        </video>
        {spatialInteraction && <SpatialOverlay interaction={spatialInteraction} mediaWidth={dimensions.width} mediaHeight={dimensions.height} />}
      </div>
      {interaction.kind === "spatial-shapes" && <div className="video-spatial-controls">
        <button type="button" className="btn btn-secondary" onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused) void video.play(); else video.pause();
        }}>
          {paused ? <Play size={16} /> : <Pause size={16} />} {paused ? "Play" : "Pause"}
        </button>
        <input
          aria-label="Video time"
          type="range"
          min={0}
          max={videoRef.current?.duration || 0}
          step={0.01}
          value={currentTime}
          onChange={event => {
            const video = videoRef.current;
            if (!video) return;
            video.pause();
            video.currentTime = Number(event.target.value);
            setCurrentTime(video.currentTime);
          }}
        />
        <span>{currentTime.toFixed(2)}s</span>
        {!paused && <span className="help-text">Pause the video to draw.</span>}
      </div>}
      {(interaction.kind === "temporal-regions" || interaction.kind === "labeled-temporal-regions") && (
        <div className="video-region-editor">
          <button type="button" className="btn btn-secondary" onClick={markBoundary}>
            <Plus size={16} /> {regionStart === null ? "Mark region start" : "Mark region end"}
          </button>
          {regionStart !== null && <span>Start: {regionStart.toFixed(2)}s</span>}
          <div className="region-list">
            {regions.map((region, index) => (
              <span key={`${region.start}-${region.end}-${index}`} className="metadata-chip" style={"label" in region && typeof region.label === "string" ? { background: labelColor(region.label, 0.2) } : undefined}>
                {"label" in region && typeof region.label === "string" && <strong>{region.label} </strong>}{region.start.toFixed(2)}s–{region.end.toFixed(2)}s
                <button
                  type="button"
                  className="inline-icon-button"
                  aria-label={`Remove region ${index + 1}`}
                  onClick={() => removeRegion(index)}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
          <p className="help-text">Play or seek the video, mark the start, then mark the end of each region.</p>
        </div>
      )}
    </div>
  );
}
