import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import type { MediaRendererProps } from "../../plugins/contracts";
import { labelColor } from "../../plugins/interactions/labelColors";
import { shouldReportMediaLoadError } from "./mediaLoadError";
import {
  interactionRegionKey,
  waveformRegionOptions,
} from "../../plugins/interactions/waveformRegions";

export default function AudioMediaRenderer({ mediaUrl, interaction, onReady, onError }: MediaRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const disableDragSelectionRef = useRef<(() => void) | null>(null);
  const regionLabelsRef = useRef(new Map<string, string>());
  const hydratingRegionsRef = useRef(false);
  const interactionRef = useRef(interaction);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [isPlaying, setIsPlaying] = useState(false);
  interactionRef.current = interaction;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  const regionsEnabled = interaction.kind === "temporal-regions" || interaction.kind === "labeled-temporal-regions";

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const reportLoadError = (error: unknown) => {
      if (!shouldReportMediaLoadError(error, disposed)) return;
      onErrorRef.current?.(error instanceof Error ? error.message : "Audio could not be loaded or decoded.");
    };
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
    regionsPluginRef.current = regionPlugin;
    const syncRegions = () => {
      if (hydratingRegionsRef.current) return;
      const currentInteraction = interactionRef.current;
      if (currentInteraction.kind === "temporal-regions") {
        currentInteraction.onChange(
          regionPlugin.getRegions().map(region => ({ start: region.start, end: region.end })),
        );
      } else if (currentInteraction.kind === "labeled-temporal-regions") {
        currentInteraction.onChange(
          regionPlugin.getRegions().map(region => ({
            start: region.start,
            end: region.end,
            label: regionLabelsRef.current.get(region.id) ?? currentInteraction.newRegionLabel,
          })),
        );
      }
    };
    regionPlugin.on("region-created", region => {
      if (hydratingRegionsRef.current) return;
      const currentInteraction = interactionRef.current;
      if (currentInteraction.kind === "labeled-temporal-regions") {
        regionLabelsRef.current.set(region.id, currentInteraction.newRegionLabel);
        region.setOptions({
          color: labelColor(currentInteraction.newRegionLabel),
          content: currentInteraction.newRegionLabel,
        });
      }
      syncRegions();
    });
    regionPlugin.on("region-updated", syncRegions);
    regionPlugin.on("region-removed", region => {
      regionLabelsRef.current.delete(region.id);
      syncRegions();
    });
    wavesurfer.on("play", () => setIsPlaying(true));
    wavesurfer.on("pause", () => setIsPlaying(false));
    wavesurfer.on("finish", () => setIsPlaying(false));
    wavesurfer.on("ready", () => onReadyRef.current?.());
    wavesurfer.on("error", reportLoadError);
    void wavesurfer.load(mediaUrl).catch(reportLoadError);
    return () => {
      disposed = true;
      wavesurfer.destroy();
      wavesurferRef.current = null;
      regionsPluginRef.current = null;
      disableDragSelectionRef.current = null;
      regionLabelsRef.current.clear();
      setIsPlaying(false);
    };
  }, [mediaUrl]);

  useEffect(() => {
    disableDragSelectionRef.current?.();
    disableDragSelectionRef.current = null;
    const regionPlugin = regionsPluginRef.current;
    if (!regionPlugin || !regionsEnabled || interaction.readonly) return;
    const color = interaction.kind === "labeled-temporal-regions"
      ? labelColor(interaction.newRegionLabel)
      : "rgba(48, 175, 255, 0.38)";
    disableDragSelectionRef.current = regionPlugin.enableDragSelection({ color });
    return () => {
      disableDragSelectionRef.current?.();
      disableDragSelectionRef.current = null;
    };
  }, [interaction.kind, interaction.readonly, regionsEnabled, interaction.kind === "labeled-temporal-regions" ? interaction.newRegionLabel : ""]);

  const regionsKey = interactionRegionKey(interaction);
  useEffect(() => {
    const regionPlugin = regionsPluginRef.current;
    if (!regionPlugin) return;
    hydratingRegionsRef.current = true;
    try {
      regionLabelsRef.current.clear();
      regionPlugin.clearRegions();
      if (interaction.kind === "temporal-regions" || interaction.kind === "labeled-temporal-regions") {
        waveformRegionOptions(interaction).forEach((options, index) => {
          const region = regionPlugin.addRegion(options);
          if (interaction.kind === "labeled-temporal-regions") {
            regionLabelsRef.current.set(region.id, interaction.regions[index].label);
          }
        });
      }
    } finally {
      hydratingRegionsRef.current = false;
    }
  }, [mediaUrl, regionsKey]);

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
          Drag across the waveform to create a region. Set each region label in the task controls.
        </p>
      )}
    </div>
  );
}
