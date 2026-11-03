/**
 * Trip Workspace — 地圖分頁 Pin／折線／視野（純邏輯）。
 * 純邏輯模組：不得有 "@/..." 的值 import（型別可用 import type），只以相對路徑 .ts import 純模組，
 * 需相容 node --experimental-strip-types。不呼叫任何 Google API、不地理編碼。
 */
import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { TripDayGroup } from "./trip-day-groups.ts";
import { dayColorIndex } from "./trip-overview-stats.ts";

/** 天數色票（6 色循環；與總覽相同）。 */
export const TRIP_DAY_COLORS: readonly string[] = [
  "oklch(0.6 0.11 45)",
  "oklch(0.55 0.07 150)",
  "oklch(0.55 0.07 240)",
  "oklch(0.62 0.11 80)",
  "oklch(0.5 0.08 340)",
  "oklch(0.52 0.06 195)",
];

/** dayIndex：0-based 天序（第 1 天＝0），空白天也佔一個色位。 */
export function dayColor(dayIndex: number): string {
  return TRIP_DAY_COLORS[dayColorIndex(dayIndex, TRIP_DAY_COLORS.length)]!;
}

export type TripMapMode = { kind: "all" } | { kind: "day"; dayIndex: number };

export type TripMapMarker = {
  id: string;
  placeKey: string;
  lat: number;
  lng: number;
  title: string;
  dayIndex: number;
  dayNumber: number;
  itemIndexInDay: number;
  label: string;
  color: string;
  variant: "solid" | "outline";
};

export type TripMapPolyline = {
  dayIndex: number;
  color: string;
  path: Array<{ lat: number; lng: number }>;
};

export type TripMapFit =
  | null
  | { type: "point"; center: { lat: number; lng: number }; zoom: 15 }
  | { type: "bounds"; bounds: { north: number; south: number; east: number; west: number } };

export type TripMapMarkersResult = {
  markers: TripMapMarker[];
  polylines: TripMapPolyline[];
  fit: TripMapFit;
  unlocatedCount: number;
};

/**
 * 座標有效性：與 destination-provider-result.ts isValidAnchorCoordinate 相同，
 * 另外 (0,0) 視為尚未定位。
 */
export function isLocatedCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** 地點顯示名稱：localizedDisplayName 優先，其次 placeName、title。 */
export function tripMapItemTitle(item: RoamieItineraryItem): string {
  return item.localizedDisplayName?.trim() || item.placeName?.trim() || item.title?.trim() || "";
}

function placeKeyFor(item: RoamieItineraryItem, dateKey: string, itemIndexInDay: number): string {
  const pid = typeof item.googlePlaceId === "string" ? item.googlePlaceId.trim() : "";
  if (pid) return pid;
  const rawId = (item as { id?: unknown }).id;
  if (typeof rawId === "string" && rawId.trim()) return rawId;
  return `${dateKey || "day"}:${itemIndexInDay}`;
}

function scheduledDays(
  dayGroups: ReadonlyArray<TripDayGroup>,
): Array<{ group: TripDayGroup; dayIndex: number }> {
  const out: Array<{ group: TripDayGroup; dayIndex: number }> = [];
  for (const group of dayGroups) {
    if (group.isUnassigned === true) continue;
    out.push({ group, dayIndex: group.dayNumber - 1 });
  }
  return out;
}

function computeFit(markers: ReadonlyArray<TripMapMarker>): TripMapFit {
  if (markers.length === 0) return null;
  if (markers.length === 1) {
    return { type: "point", center: { lat: markers[0]!.lat, lng: markers[0]!.lng }, zoom: 15 };
  }
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const m of markers) {
    if (m.lat > north) north = m.lat;
    if (m.lat < south) south = m.lat;
    if (m.lng > east) east = m.lng;
    if (m.lng < west) west = m.lng;
  }
  return { type: "bounds", bounds: { north, south, east, west } };
}

export function buildTripMapMarkers(
  dayGroups: ReadonlyArray<TripDayGroup>,
  mode: TripMapMode,
): TripMapMarkersResult {
  const days = scheduledDays(dayGroups);
  const inScope =
    mode.kind === "all" ? days : days.filter((d) => d.dayIndex === mode.dayIndex).slice(0, 1);

  const markers: TripMapMarker[] = [];
  const polylines: TripMapPolyline[] = [];
  let unlocatedCount = 0;

  for (const { group, dayIndex } of inScope) {
    const color = dayColor(dayIndex);
    const path: Array<{ lat: number; lng: number }> = [];
    group.items.forEach((item, itemIndexInDay) => {
      if (!isLocatedCoordinate(item.lat, item.lng)) {
        unlocatedCount += 1;
        return;
      }
      const lat = item.lat as number;
      const lng = item.lng as number;
      const placeKey = placeKeyFor(item, group.dateKey, itemIndexInDay);
      markers.push({
        id: `${placeKey}#d${dayIndex}-${itemIndexInDay}`,
        placeKey,
        lat,
        lng,
        title: tripMapItemTitle(item),
        dayIndex,
        dayNumber: group.dayNumber,
        itemIndexInDay,
        label: mode.kind === "all" ? String(group.dayNumber) : String(itemIndexInDay + 1),
        color,
        variant: mode.kind === "all" || itemIndexInDay === 0 ? "solid" : "outline",
      });
      path.push({ lat, lng });
    });
    if (path.length >= 2) polylines.push({ dayIndex, color, path });
  }

  return { markers, polylines, fit: computeFit(markers), unlocatedCount };
}
