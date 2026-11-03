/**
 * iPhone Duo 版型判斷（純邏輯）。
 * 不得 import "@/..."，需相容 node --experimental-strip-types。
 * 規格見 scripts/verify-duo-layout.mjs 開頭註解。
 */

/** 右側安全區至少這麼寬才視為「系統直欄在右側」（Duo 類裝置） */
export const RIGHT_RAIL_MIN_INSET = 40;
/** 上方／左側安全區必須小於此值才採用右側直欄（排除一般 iPhone 直向與橫向） */
export const TOP_INSET_MAX_FOR_RAIL = 20;
/** 可用寬度至少這麼寬才採用雙欄 */
export const TWO_PANE_MIN_WIDTH = 720;
/** 雙欄中線（摺痕）間隔 */
export const FOLD_GUTTER = 24;

export type DuoNavPlacement = "bottom" | "right-rail";
export type DuoTripLayout = "single" | "two-pane";

export type DuoLayoutInput = {
  viewportWidth?: number;
  viewportHeight?: number;
  safeTop?: number;
  safeRight?: number;
  safeBottom?: number;
  safeLeft?: number;
};

export type DuoPane = {
  leftWidth: number;
  rightWidth: number;
  gutter: number;
  foldX: number;
};

export type DuoLayout = {
  navPlacement: DuoNavPlacement;
  tripLayout: DuoTripLayout;
  usableWidth: number;
  pane?: DuoPane;
};

/** NaN、負數、非有限數、非 number 一律視為 0 */
function sanitize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function resolveDuoLayout(input: DuoLayoutInput): DuoLayout {
  const raw = input ?? {};
  const viewportWidth = sanitize(raw.viewportWidth);
  const safeTop = sanitize(raw.safeTop);
  const safeRight = sanitize(raw.safeRight);
  const safeLeft = sanitize(raw.safeLeft);

  const navPlacement: DuoNavPlacement =
    safeRight >= RIGHT_RAIL_MIN_INSET &&
    safeTop < TOP_INSET_MAX_FOR_RAIL &&
    safeLeft < TOP_INSET_MAX_FOR_RAIL
      ? "right-rail"
      : "bottom";

  const usableWidth = Math.max(0, viewportWidth - safeLeft - safeRight);

  if (usableWidth < TWO_PANE_MIN_WIDTH) {
    return { navPlacement, tripLayout: "single", usableWidth };
  }

  const gutter = FOLD_GUTTER;
  const foldX = viewportWidth / 2;
  const leftWidth = foldX - gutter / 2 - safeLeft;
  const rightWidth = usableWidth - leftWidth - gutter;
  return {
    navPlacement,
    tripLayout: "two-pane",
    usableWidth,
    pane: { leftWidth, rightWidth, gutter, foldX },
  };
}
