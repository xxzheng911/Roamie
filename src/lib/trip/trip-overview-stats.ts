/**
 * Trip Workspace V1 — 總覽統計與本地 SVG 投影（純邏輯）。
 * 純邏輯模組：不得 import "@/..."，需相容 node --experimental-strip-types。
 */

export interface TripOverviewStats {
  /** 不同已排日期數（排除未安排與空白日期）。 */
  dayCount: number;
  /** date 不等於 unassignedDateKey 的項目數。 */
  scheduledPlaceCount: number;
  /** 依出現順序的已排日期。 */
  scheduledDates: string[];
}

export function computeTripOverviewStats(
  items: ReadonlyArray<{ date?: string }>,
  opts: { unassignedDateKey: string },
): TripOverviewStats {
  const dates: string[] = [];
  const seen = new Set<string>();
  let scheduledPlaceCount = 0;
  for (const item of items) {
    const date = typeof item?.date === "string" ? item.date.trim() : "";
    // 字面規則：date 不等於未安排鍵即計入已排景點數。
    if (date === opts.unassignedDateKey) continue;
    scheduledPlaceCount += 1;
    if (date && !seen.has(date)) {
      seen.add(date);
      dates.push(date);
    }
  }
  return { dayCount: dates.length, scheduledPlaceCount, scheduledDates: dates };
}

/** 天數色票數量（6 色循環）。 */
export const TRIP_DAY_PALETTE_SIZE = 6;

/**
 * 依行程頁天數順序取色票索引：dayIndex 為 0-based（第 1 天＝0），空白天也佔一個色位，
 * 依 paletteSize 循環。非有限值回傳 0；paletteSize 非正數時視為 1。
 */
export function dayColorIndex(
  dayIndex: number,
  paletteSize: number = TRIP_DAY_PALETTE_SIZE,
): number {
  const n = Number.isFinite(paletteSize) && paletteSize >= 1 ? Math.floor(paletteSize) : 1;
  if (!Number.isFinite(dayIndex)) return 0;
  const i = Math.trunc(dayIndex);
  return ((i % n) + n) % n;
}

/**
 * 將經緯度等比例投影到 box（equirectangular，經度以中心緯度 cos 校正），內容置中。
 * 北方 y 較小、東方 x 較大；輸出順序與輸入相同。
 */
export function projectPointsToBox(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  box: { width: number; height: number; padding: number },
): Array<{ x: number; y: number }> {
  if (points.length === 0) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180) || 1;
  const spanX = (maxLng - minLng) * kx;
  const spanY = maxLat - minLat;
  const innerW = Math.max(0, box.width - box.padding * 2);
  const innerH = Math.max(0, box.height - box.padding * 2);
  const sx = spanX > 0 ? innerW / spanX : Infinity;
  const sy = spanY > 0 ? innerH / spanY : Infinity;
  let scale = Math.min(sx, sy);
  if (!Number.isFinite(scale)) scale = 0;
  const cx = box.width / 2;
  const cy = box.height / 2;
  const midLng = (minLng + maxLng) / 2;
  return points.map((p) => ({
    x: cx + (p.lng - midLng) * kx * scale,
    y: cy - (p.lat - midLat) * scale,
  }));
}
