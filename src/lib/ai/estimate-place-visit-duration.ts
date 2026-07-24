/**
 * Global place visit-duration estimator (minutes).
 * Used by Time Budget Planner + tripSettings.legMinutes seeding.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolvePlaceCategoryFamily, type PlaceCategoryFamily } from "@/lib/ai/place-category-family";
import type { PlaceResult } from "@/lib/place-result";

export type VisitDurationPace = "slow" | "medium" | "active";

export type VisitDurationEstimate = {
  placeId: string;
  placeName: string;
  categoryFamily: PlaceCategoryFamily;
  baseDuration: number;
  paceMultiplier: number;
  finalDuration: number;
  durationSource: string;
};

const BASE_BY_FAMILY: Record<PlaceCategoryFamily, number> = {
  theme_park: 360,
  zoo_aquarium: 180,
  museum: 100,
  gallery: 90,
  palace_castle: 150,
  temple_shrine: 60,
  church: 55,
  park: 75,
  garden: 70,
  market: 75,
  shopping: 120,
  viewpoint: 55,
  beach: 120,
  historic_district: 120,
  monument: 30,
  nature_trail: 120,
  cafe: 55,
  restaurant: 75,
  nightlife: 90,
  other: 60,
};

function paceMultiplier(pace?: VisitDurationPace | null): number {
  if (pace === "slow") return 1.35;
  if (pace === "active") return 0.85;
  return 1;
}

function scaleByPopularity(base: number, place: PlaceResult): number {
  const ratings = place.userRatingCount ?? 0;
  if (ratings >= 50_000) return Math.round(base * 1.25);
  if (ratings >= 10_000) return Math.round(base * 1.1);
  if (ratings > 0 && ratings < 200) return Math.round(base * 0.9);
  return base;
}

function clampFamily(family: PlaceCategoryFamily, minutes: number): number {
  if (family === "monument") return Math.min(Math.max(minutes, 20), 45);
  if (family === "theme_park") return Math.min(Math.max(minutes, 240), 480);
  if (family === "museum" || family === "gallery") {
    return Math.min(Math.max(minutes, 75), 180);
  }
  if (family === "viewpoint") return Math.min(Math.max(minutes, 40), 75);
  return Math.min(Math.max(minutes, 30), 300);
}

export function estimatePlaceVisitDuration(
  place: PlaceResult,
  opts?: { pace?: VisitDurationPace | null; isRequiredAnchor?: boolean },
): VisitDurationEstimate {
  const family = resolvePlaceCategoryFamily(place);
  const base = BASE_BY_FAMILY[family] ?? 60;
  const mult = paceMultiplier(opts?.pace);
  let minutes = Math.round(scaleByPopularity(base, place) * mult);
  if (opts?.isRequiredAnchor) minutes = Math.round(minutes * 1.1);
  minutes = clampFamily(family, minutes);

  const estimate: VisitDurationEstimate = {
    placeId: (place.id ?? "").trim(),
    placeName: place.localizedDisplayName || place.name || "",
    categoryFamily: family,
    baseDuration: base,
    paceMultiplier: mult,
    finalDuration: minutes,
    durationSource: `family:${family}`,
  };

  logAiPipeline(
    "[PLACE_DURATION_ESTIMATE]",
    `placeId=${estimate.placeId}`,
    `placeName=${estimate.placeName}`,
    `categoryFamily=${estimate.categoryFamily}`,
    `baseDuration=${estimate.baseDuration}`,
    `paceMultiplier=${estimate.paceMultiplier}`,
    `finalDuration=${estimate.finalDuration}`,
    `durationSource=${estimate.durationSource}`,
  );

  return estimate;
}

/** Build legMinutes map keyed by display / place name (matches legKeyForItem). */
export function buildLegMinutesFromPlaces(
  places: Array<{
    placeName?: string | null;
    title?: string | null;
    name?: string | null;
    localizedDisplayName?: string | null;
    googlePlaceId?: string | null;
    placeId?: string | null;
    placeType?: string | null;
    types?: string[] | null;
    primaryType?: string | null;
    userRatingCount?: number | null;
    rating?: number | null;
  }>,
  pace?: VisitDurationPace | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of places) {
    const key =
      (p.localizedDisplayName || p.placeName || p.title || p.name || "").trim();
    if (!key || out[key]) continue;
    const asPlace: PlaceResult = {
      id: (p.googlePlaceId || p.placeId || key).trim(),
      name: key,
      address: null,
      lat: null,
      lng: null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      photoName: null,
      primaryType: p.primaryType ?? p.placeType ?? null,
      types: p.types ?? (p.placeType ? [p.placeType] : null),
      businessStatus: null,
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
      localizedDisplayName: p.localizedDisplayName,
    };
    out[key] = estimatePlaceVisitDuration(asPlace, { pace }).finalDuration;
  }
  return out;
}
