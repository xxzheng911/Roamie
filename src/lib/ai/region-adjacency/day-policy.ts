/**
 * Universal nearby day-count policy (all destinations).
 *
 * 1–3 days: do not suggest nearby by default
 * 4–5 days: at most 1 nearby option
 * 6+ days: 2–3 nearby options
 */
import type { NearbyDayPolicy } from "@/lib/ai/region-adjacency/types";

/** Soft one-way travel-time ceiling for default nearby (minutes). */
export const NEARBY_DEFAULT_MAX_TRAVEL_MINUTES = 90;

/** Living-circle band (minutes). */
export const NEARBY_LIVING_CIRCLE_MIN_MINUTES = 30;
export const NEARBY_LIVING_CIRCLE_MAX_MINUTES = 90;

/**
 * Distance → rough one-way transit minutes (regional rail / highway mix).
 * ~50 km/h effective average — not a routing API.
 */
export const NEARBY_EFFECTIVE_KMH = 50;

/** Distance bands (km) approximating living circle when ETA unknown. */
export const NEARBY_LIVING_CIRCLE_MAX_KM = 75;
export const NEARBY_POPULAR_MAX_KM = 100;
export const NEARBY_FARTHER_MAX_KM = 150;

export function estimateTravelMinutesFromKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return Number.POSITIVE_INFINITY;
  return Math.round((distanceKm / NEARBY_EFFECTIVE_KMH) * 60);
}

export function resolveNearbyDayPolicy(
  tripDays?: number | null,
): NearbyDayPolicy {
  const days =
    typeof tripDays === "number" && Number.isFinite(tripDays)
      ? Math.floor(tripDays)
      : null;

  if (days == null) {
    // Unknown duration: allow up to 2 living-circle options (caller may still gate UI).
    return {
      maxNearbyOptions: 2,
      suggestNearbyByDefault: true,
      reason: "trip_days_unknown",
    };
  }

  if (days <= 0) {
    return {
      maxNearbyOptions: 0,
      suggestNearbyByDefault: false,
      reason: "invalid_trip_days",
    };
  }

  if (days <= 3) {
    return {
      maxNearbyOptions: 0,
      suggestNearbyByDefault: false,
      reason: "short_trip_no_nearby_default",
    };
  }

  if (days <= 5) {
    return {
      maxNearbyOptions: 1,
      suggestNearbyByDefault: true,
      reason: "medium_trip_one_nearby",
    };
  }

  return {
    maxNearbyOptions: 3,
    suggestNearbyByDefault: true,
    reason: "long_trip_multi_nearby",
  };
}

/** Theme titles that represent nearby REGION cities (not in-metro nature spots). */
export function isNearbyRegionThemeTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/近郊備案|近郊推薦|近郊延伸|近郊城市|近郊一日/.test(t)) return true;
  // Exact-ish 「近郊」 combo that is not local 自然/放鬆 place packs
  if (/^近郊/.test(t) && !/自然|放鬆|溫泉|風景|文創/.test(t)) return true;
  return false;
}
