import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import type { MediaInteraction, MediaRendererProps } from "../../plugins/contracts";
import { labelColor } from "../../plugins/interactions/labelColors";
import { shouldReportMediaLoadError } from "./mediaLoadError";
import {
  interactionRegionKey,
  waveformRegionOptions,
} from "../../plugins/interactions/waveformRegions";

function computeTimelineIntervals(duration: number) {
  if (duration <= 5) {
    return { timeInterval: 0.5, primaryLabelInterval: 1, secondaryLabelInterval: 0.5 };
  }
  if (duration <= 15) {
    return { timeInterval: 1, primaryLabelInterval: 2, secondaryLabelInterval: 1 };
  }
  if (duration <= 60) {
    return { timeInterval: 1, primaryLabelInterval: 5, secondaryLabelInterval: 5 };
  }
  if (duration <= 180) {
    return { timeInterval: 5, primaryLabelInterval: 15, secondaryLabelInterval: 15 };
  }
  return { timeInterval: 10, primaryLabelInterval: 30, secondaryLabelInterval: 30 };
}

export default function AudioMediaRenderer({ mediaUrl, interaction, onReady, onError }: MediaRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const timelinePluginRef = useRef<ReturnType<typeof TimelinePlugin.create> | null>(null);
  const disableDragSelectionRef = useRef<(() => void) | null>(null);
  const regionLabelsRef = useRef(new Map<string, string>());
  const hydratingRegionsRef = useRef(false);
  const interactionRef = useRef(interaction);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  interactionRef.current = interaction;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  const regionsEnabled = interaction.kind === "temporal-regions" || interaction.kind === "labeled-temporal-regions";

  const syncRegionsToPlugin = useCallback(() => {
    const regionPlugin = regionsPluginRef.current;
    const ws = wavesurferRef.current;
    if (!regionPlugin || !ws) return;
    const duration = ws.getDuration();
    if (!duration || duration <= 0) return;

    hydratingRegionsRef.current = true;
    try {
      regionLabelsRef.current.clear();
      regionPlugin.clearRegions();
      const currentInteraction = interactionRef.current;
      if (currentInteraction.kind === "temporal-regions" || currentInteraction.kind === "labeled-temporal-regions") {
        waveformRegionOptions(currentInteraction).forEach((options, index) => {
          const region = regionPlugin.addRegion(options);
          if (currentInteraction.kind === "labeled-temporal-regions") {
            const currentLabeled = currentInteraction as Extract<MediaInteraction, { kind: "labeled-temporal-regions" }>;
            const label = currentLabeled.regions[index]?.label;
            if (label) {
              regionLabelsRef.current.set(region.id, label);
            }
          }
        });
      }
    } finally {
      hydratingRegionsRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    setIsReady(false);
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

    const timelinePlugin = wavesurfer.registerPlugin(
      TimelinePlugin.create({
        height: 24,
        formatTimeCallback: (seconds: number) => {
          if (seconds < 60) {
            return `${Number(seconds.toFixed(seconds % 1 === 0 ? 0 : 1))}s`;
          }
          const minutes = Math.floor(seconds / 60);
          const remainder = (seconds % 60).toFixed(1);
          return `${minutes}m ${Number(remainder)}s`;
        },
        style: {
          color: "#475569",
          fontSize: "11px",
          fontWeight: "500",
          fontFamily: "Inter, system-ui, sans-serif",
        },
      }),
    );
    timelinePluginRef.current = timelinePlugin;

    const handleReady = () => {
      if (disposed) return;
      const duration = wavesurfer.getDuration();
      if (duration > 0 && timelinePlugin) {
        const intervals = computeTimelineIntervals(duration);
        const dynamicTimeline = timelinePlugin as unknown as {
          options: {
            timeInterval?: number;
            primaryLabelInterval?: number;
            secondaryLabelInterval?: number;
          };
          initTimeline: () => void;
        };
        dynamicTimeline.options.timeInterval = intervals.timeInterval;
        dynamicTimeline.options.primaryLabelInterval = intervals.primaryLabelInterval;
        dynamicTimeline.options.secondaryLabelInterval = intervals.secondaryLabelInterval;
        try {
          dynamicTimeline.initTimeline();
        } catch {
          // ignore
        }
      }
      setIsReady(true);
      syncRegionsToPlugin();
      onReadyRef.current?.();
    };

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
    wavesurfer.on("ready", handleReady);
    wavesurfer.on("decode", () => {
      if (disposed) return;
      setIsReady(true);
      syncRegionsToPlugin();
    });
    wavesurfer.on("error", reportLoadError);

    void wavesurfer.load(mediaUrl).catch(reportLoadError);

    return () => {
      disposed = true;
      wavesurfer.destroy();
      wavesurferRef.current = null;
      regionsPluginRef.current = null;
      timelinePluginRef.current = null;
      disableDragSelectionRef.current = null;
      regionLabelsRef.current.clear();
      setIsPlaying(false);
      setIsReady(false);
    };
  }, [mediaUrl, syncRegionsToPlugin]);

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
    if (!isReady) return;
    syncRegionsToPlugin();
  }, [mediaUrl, regionsKey, isReady, syncRegionsToPlugin]);

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
      {regionsEnabled && !interaction.readonly && (
        <p className="text-center" style={{ margin: "12px 0 0", fontSize: "0.85rem" }}>
          Drag across the waveform to create a region. Set each region label in the task controls.
        </p>
      )}
      {regionsEnabled && interaction.readonly && (
        <p className="text-center" style={{ margin: "12px 0 0", fontSize: "0.85rem", color: "var(--tide-slate)" }}>
          Annotated region(s) shown on the waveform timeline above.
        </p>
      )}
    </div>
  );
}
