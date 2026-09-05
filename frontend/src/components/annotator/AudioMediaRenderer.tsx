import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import type { MediaRendererProps } from "../../plugins/contracts";

export default function AudioMediaRenderer({ mediaUrl, interaction }: MediaRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const interactionRef = useRef(interaction);
  const [isPlaying, setIsPlaying] = useState(false);
  interactionRef.current = interaction;
  const regionsEnabled = interaction.kind === "temporal-regions";

  useEffect(() => {
    if (!containerRef.current) return;
    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#92EEFF",
      progressColor: "#087796",
      cursorColor: "#102A32",
      barWidth: 2,
      barRadius: 2,
      height: 120,
    });
    wavesurferRef.current = wavesurfer;
    const regionPlugin = wavesurfer.registerPlugin(RegionsPlugin.create());
    if (regionsEnabled) {
      regionPlugin.enableDragSelection({ color: "rgba(48, 175, 255, 0.38)" });
      const syncRegions = () => {
        const currentInteraction = interactionRef.current;
        if (currentInteraction.kind === "temporal-regions") {
          currentInteraction.onChange(
            regionPlugin.getRegions().map(region => ({ start: region.start, end: region.end })),
          );
        }
      };
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
  }, [mediaUrl, regionsEnabled]);

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
