export type MapExploreSheetMode = "list" | "detail" | "navigation";

export function isMapDetailOpen(mode: MapExploreSheetMode): boolean {
  return mode === "detail" || mode === "navigation";
}
