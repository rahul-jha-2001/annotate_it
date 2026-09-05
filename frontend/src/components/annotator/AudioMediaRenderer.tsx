import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";

interface Props {
  mediaUrl: string;
  regionsEnabled: boolean;
  onRegionsChange: (regions: Array<{ start: number; end: number }>) => void;
}

export default function AudioMediaRenderer({ mediaUrl, regionsEnabled, onRegionsChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#6366f1",
      progressColor: "#4f46e5",
      cursorColor: "#fff",
      barWidth: 2,
      barRadius: 2,
      height: 120,
    });
    wavesurferRef.current = wavesurfer;
    const regionPlugin = wavesurfer.registerPlugin(RegionsPlugin.create());
    if (regionsEnabled) {
      regionPlugin.enableDragSelection({ color: "rgba(99, 102, 241, 0.4)" });
      const syncRegions = () => onRegionsChange(
        regionPlugin.getRegions().map(region => ({ start: region.start, end: region.end }))
      );
      regionPlugin.on("region-created", syncRegions);
      regionPlugin.on("region-updated", syncRegions);
      regionPlugin.on("region-removed", syncRegions);
    }
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => setIsPlaying(false));
    wavesurfer.load(mediaUrl);
    return () => {
      wavesurfer.destroy();
      wavesurferRef.current = null;
      setIsPlaying(false);
    };
  }, [mediaUrl, regionsEnabled, onRegionsChange]);

  return (
    <div className="glass-panel" style={{ marginBottom: "20px" }}>
      <div ref={containerRef} style={{ width: "100%", marginBottom: "16px" }} />
      <div className="flex-row" style={{ justifyContent: "center" }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => wavesurferRef.current?.playPause()}
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
      </div>
      {regionsEnabled && (
        <p className="text-center" style={{ margin: "12px 0 0", fontSize: "0.85rem" }}>
          Drag across the waveform to create a region. Regions can be resized or removed.
        </p>
      )}
    </div>
  );
}
