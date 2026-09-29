import type { ValidatedCatalogPreset } from "./types";

export type CatalogModality = "all" | "audio" | "image" | "video";

export function filterCatalog(
  entries: ValidatedCatalogPreset[],
  modality: CatalogModality,
  query: string,
): ValidatedCatalogPreset[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(entry => {
    if (modality !== "all" && entry.modality !== modality) return false;
    if (!needle) return true;
    return [entry.title, entry.summary, entry.family, ...entry.useCases]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle);
  });
}

export function catalogModalityCounts(entries: ValidatedCatalogPreset[]) {
  return {
    all: entries.length,
    audio: entries.filter(entry => entry.modality === "audio").length,
    image: entries.filter(entry => entry.modality === "image").length,
    video: entries.filter(entry => entry.modality === "video").length,
  };
}
