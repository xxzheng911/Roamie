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

function readSafeAreaTopPx(): number {
  if (typeof document === "undefined") return 0;
  const main = document.querySelector("main.app-scroll");
  if (!main) return 0;
  return Math.max(0, Math.round(parseFloat(getComputedStyle(main).paddingTop) || 0));
}

/**
 * iPhone Duo 展開雙欄（html.duo-rail.duo-two-pane，由 _app 設定）：探索頁地圖在右頁、面板與搜尋列在左頁
 * （styles.css 的 Duo 規則），地圖不再被任何浮層遮住，padding 只保留四周間距與底部 attribution 區。
 */
const DUO_TWO_PANE_PADDING: MapVisiblePadding = {
  top: 16,
  right: 16,
  bottom: MAP_ATTRIBUTION_SAFE_PX,
  left: 16,
};

function isDuoTwoPaneLayout(): boolean {
  if (typeof document === "undefined") return false;
  const cl = document.documentElement.classList;
  return cl.contains("duo-rail") && cl.contains("duo-two-pane");
}

/**
 * iPhone Duo 筆電半開（html.duo-laptop，由 _app 只在筆電且非雙頁時設定）：探索頁地圖只佔上半部，
 * 搜尋列與面板都在下半部（styles.css 的筆電規則），地圖不被浮層遮住，padding 與雙欄相同。
 */
function isDuoLaptopLayout(): boolean {
  if (typeof document === "undefined") return false;
  const cl = document.documentElement.classList;
  // 直向攤平（html.duo-flat-portrait，_app 只在非雙欄、非筆電時設定）探索頁版型與筆電相同
  return (cl.contains("duo-laptop") || cl.contains("duo-flat-portrait")) && !cl.contains("duo-two-pane");
}

/** 依 sheet、bottom nav、safe area 計算地圖可視區 padding */
export function measureMapExplorePadding(sheetEl?: HTMLElement | null): MapVisiblePadding {
  if (isDuoTwoPaneLayout()) return { ...DUO_TWO_PANE_PADDING };
  // 地圖延伸到螢幕頂端（styles.css #H3-2）：top 讓出頂部安全區（main 的 padding-top）＋16，標記不落在狀態列／相機下方
  if (isDuoLaptopLayout()) return { ...DUO_TWO_PANE_PADDING, top: readSafeAreaTopPx() + 16 };
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
