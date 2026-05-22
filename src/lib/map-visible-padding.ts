/** Google attribution 保留區 */
export const MAP_ATTRIBUTION_SAFE_PX = 56;
export const MAP_PADDING_GAP = 12;
/** 搜尋列 + safe area 頂部留白 */
export const MAP_SEARCH_TOP_PX = 88;
export const MAP_PADDING_BOTTOM_DEFAULT = 220;

export type MapVisiblePadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function readBottomNavPx(): number {
  if (typeof document === "undefined") return 68;
  const root = getComputedStyle(document.documentElement);
  const nav =
    parseFloat(root.getPropertyValue("--bottom-nav-height").trim()) || 68;
  return nav;
}

function readSafeAreaBottomPx(): number {
  if (typeof document === "undefined") return 0;
  const main = document.querySelector("main");
  if (!main) return 0;
  const pb = parseFloat(getComputedStyle(main).paddingBottom) || 0;
  const nav = readBottomNavPx();
  return Math.max(0, pb - nav);
}

/** 依 sheet、bottom nav、safe area 計算地圖可視區 padding */
export function measureMapExplorePadding(sheetEl?: HTMLElement | null): MapVisiblePadding {
  const sheet =
    sheetEl ??
    (typeof document !== "undefined"
      ? document.querySelector<HTMLElement>("[data-map-explore-sheet]")
      : null);
  const sheetH =
    sheet instanceof HTMLElement ? sheet.offsetHeight : MAP_PADDING_BOTTOM_DEFAULT;
  const bottom = Math.max(
    MAP_PADDING_BOTTOM_DEFAULT,
    sheetH +
      readBottomNavPx() +
      readSafeAreaBottomPx() +
      MAP_ATTRIBUTION_SAFE_PX +
      MAP_PADDING_GAP,
  );
  return {
    top: MAP_SEARCH_TOP_PX,
    right: 16,
    bottom,
    left: 16,
  };
}

export function applyMapVisiblePadding(
  map: google.maps.Map,
  padding: MapVisiblePadding,
): void {
  map.setOptions({ padding });
}
