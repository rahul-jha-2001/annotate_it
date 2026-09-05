import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { MediaRendererProps } from "../../plugins/contracts";

export default function VideoMediaRenderer({ mediaUrl, interaction }: MediaRendererProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [regionStart, setRegionStart] = useState<number | null>(null);
  const regions = interaction.kind === "temporal-regions" ? interaction.regions : [];

  const markBoundary = () => {
    if (interaction.kind !== "temporal-regions" || !videoRef.current) return;
    const currentTime = videoRef.current.currentTime;
    if (regionStart === null) {
      setRegionStart(currentTime);
      return;
    }
    if (currentTime > regionStart) {
      interaction.onChange([...interaction.regions, { start: regionStart, end: currentTime }]);
      setRegionStart(null);
    }
  };

  return (
    <div className="glass-panel media-annotation-panel" style={{ marginBottom: "20px" }}>
      <video ref={videoRef} className="annotation-video" controls preload="metadata" src={mediaUrl}>
        Your browser does not support video playback.
      </video>
      {interaction.kind === "temporal-regions" && (
        <div className="video-region-editor">
          <button type="button" className="btn btn-secondary" onClick={markBoundary}>
            <Plus size={16} /> {regionStart === null ? "Mark region start" : "Mark region end"}
          </button>
          {regionStart !== null && <span>Start: {regionStart.toFixed(2)}s</span>}
          <div className="region-list">
            {regions.map((region, index) => (
              <span key={`${region.start}-${region.end}-${index}`} className="metadata-chip">
                {region.start.toFixed(2)}s–{region.end.toFixed(2)}s
                <button
                  type="button"
                  className="inline-icon-button"
                  aria-label={`Remove region ${index + 1}`}
                  onClick={() => interaction.onChange(regions.filter((_, position) => position !== index))}
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
