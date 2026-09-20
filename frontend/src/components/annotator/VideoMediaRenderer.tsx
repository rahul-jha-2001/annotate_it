import { useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { MediaRendererProps } from "../../plugins/contracts";
import SpatialOverlay from "../../plugins/spatial/SpatialOverlay";
import { canCreateAtPlaybackState, visibleShapesAtTime } from "../../plugins/spatial/videoTime";
import VideoRegionTimeline from "./VideoRegionTimeline";

export default function VideoMediaRenderer({ mediaUrl, interaction }: MediaRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dimensions, setDimensions] = useState({ width: 16, height: 9 });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const temporalInteraction = interaction.kind === "temporal-regions" || interaction.kind === "labeled-temporal-regions"
    ? interaction
    : null;
  const visibleSpatialShapes = useMemo(
    () => interaction.kind === "spatial-shapes" && interaction.frameAware
      ? visibleShapesAtTime(interaction.shapes, currentTime, interaction.timeTolerance)
      : interaction.kind === "spatial-shapes" ? interaction.shapes : [],
    [interaction, currentTime],
  );

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
          onLoadedMetadata={event => {
            setDimensions({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight });
            setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
          }}
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
      {temporalInteraction && duration > 0 && (
        <VideoRegionTimeline
          duration={duration}
          currentTime={currentTime}
          interaction={temporalInteraction}
          onSeek={time => {
            const video = videoRef.current;
            if (!video) return;
            video.pause();
            video.currentTime = time;
            setCurrentTime(time);
          }}
        />
      )}
    </div>
  );
}
