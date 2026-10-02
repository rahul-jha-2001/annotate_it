import type { MediaInteraction } from "../contracts";
import { labelColor } from "./labelColors";

export interface WaveformRegionOption {
  id: string;
  start: number;
  end: number;
  color: string;
  content?: string;
  drag: boolean;
  resize: boolean;
}

type RegionInteraction = Extract<
  MediaInteraction,
  { kind: "temporal-regions" | "labeled-temporal-regions" }
>;

export function waveformRegionOptions(interaction: RegionInteraction): WaveformRegionOption[] {
  return interaction.regions.map((region, index) => {
    const label =
      "label" in region && region.label
        ? region.label
        : "label" in interaction && interaction.label
        ? interaction.label
        : undefined;
    return {
      id: `annotation-region-${index}`,
      start: region.start,
      end: region.end,
      color: label ? labelColor(label) : "rgba(48, 175, 255, 0.38)",
      ...(label ? { content: label } : {}),
      drag: !interaction.readonly,
      resize: !interaction.readonly,
    };
  });
}

export function interactionRegionKey(interaction: MediaInteraction): string {
  if (interaction.kind !== "temporal-regions" && interaction.kind !== "labeled-temporal-regions") {
    return interaction.kind;
  }
  return JSON.stringify({
    kind: interaction.kind,
    regions: interaction.regions,
    label: "label" in interaction ? interaction.label : undefined,
    readonly: Boolean(interaction.readonly),
  });
}
