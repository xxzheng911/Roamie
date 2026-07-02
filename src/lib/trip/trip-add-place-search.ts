import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { calculateDistanceKm } from "@/lib/geo-distance";
import type { TripAddPlaceContext } from "@/lib/trip/trip-add-place-session";
import {
  normalizeStoredPlaceId,
  placeIdFromRecommendation,
  TRIP_ADD_PLACE_RADIUS_STEPS_M,
  type TripAddPlaceRecommendationSession,
} from "@/lib/trip/trip-add-place-recommendation-session";

export const TRIP_ADD_PLACE_RAW_FETCH_TARGET = 100;
export const TRIP_ADD_PLACE_CANDIDATE_KEEP = 30;

export type TripAddPlaceSearchCenter = {
  lat: number;
  lng: number;
  label: string;
  placeId: string;
};

export function tripAnchorFromContext(ctx: TripAddPlaceContext): TripAddPlaceSearchCenter | null {
  const lat = ctx.lastPlace?.lat ?? ctx.destinationLocation?.lat;
  const lng = ctx.lastPlace?.lng ?? ctx.destinationLocation?.lng;
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return null;
  const label = ctx.lastPlace?.name?.trim() || ctx.destination;
  return {
    lat,
    lng,
    label,
    placeId: `origin:${lat.toFixed(5)},${lng.toFixed(5)}`,
  };
}

export function resolveTripAddPlaceSearchCenter(
  ctx: TripAddPlaceContext,
  recSession?: TripAddPlaceRecommendationSession | null,
): TripAddPlaceSearchCenter | null {
  if (recSession?.searchCenterLat != null && recSession.searchCenterLng != null) {
    return {
      lat: recSession.searchCenterLat,
      lng: recSession.searchCenterLng,
      label: recSession.searchCenterLabel ?? ctx.destination,
      placeId: recSession.searchCenterPlaceId ?? `center:${recSession.searchCenterLat},${recSession.searchCenterLng}`,
    };
  }
  return tripAnchorFromContext(ctx);
}

/** 順路距離上限（公里）：絕對不超過 10km */
export function tripAddPlaceMaxDistanceKm(params: {
  radiusStep: number;
  expandConsent?: boolean;
  transportationMode?: string;
}): number {
  const mode = (params.transportationMode ?? "").toLowerCase();
  const isTransit = /transit|metro|subway|train|bus|mrt|捷運|地鐵|電車|巴士|大眾/.test(mode);
  const step = Math.max(0, Math.min(params.radiusStep, TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1));

  if (params.expandConsent || step >= 3) return 8;
  if (step === 0) return isTransit ? 5 : 1;
  if (step === 1) return 5;
  return 5;
}

export function isWithinTripAddPlaceDistance(
  distanceKm: number | null,
  maxKm: number,
): boolean {
  if (distanceKm == null) return false;
  return distanceKm <= maxKm && distanceKm <= 10;
}

export function computeNextSearchCenter(
  ctx: TripAddPlaceContext,
  recSession: TripAddPlaceRecommendationSession,
): TripAddPlaceSearchCenter | null {
  const origin =
    recSession.originLat != null && recSession.originLng != null
      ? { lat: recSession.originLat, lng: recSession.originLng }
      : tripAnchorFromContext(ctx);
  if (!origin) return null;

  const used = new Set(recSession.searchCenterPlaceIds ?? []);
  const shownIds = new Set(recSession.shownPlaceIds.map(normalizeStoredPlaceId));

  const seeds = recSession.allCandidates
    .filter((c) => {
      const id = normalizeStoredPlaceId(placeIdFromRecommendation(c));
      return (
        id &&
        shownIds.has(id) &&
        c.lat != null &&
        c.lng != null &&
        !used.has(id)
      );
    })
    .map((c) => ({
      rec: c,
      id: normalizeStoredPlaceId(placeIdFromRecommendation(c))!,
      distFromOrigin:
        calculateDistanceKm(origin.lat, origin.lng, c.lat, c.lng) ?? 0,
    }))
    .sort((a, b) => b.distFromOrigin - a.distFromOrigin);

  const pick = seeds[0];
  if (pick) {
    return {
      lat: pick.rec.lat!,
      lng: pick.rec.lng!,
      label: pick.rec.name,
      placeId: pick.id,
    };
  }

  const current = resolveTripAddPlaceSearchCenter(ctx, recSession);
  if (!current || used.has(current.placeId)) return null;

  const step = recSession.searchRadiusStep + 1;
  const offsetM = TRIP_ADD_PLACE_RADIUS_STEPS_M[Math.min(step, TRIP_ADD_PLACE_RADIUS_STEPS_M.length - 1)]!;
  const bearing = (step * 0.9) % (2 * Math.PI);
  const latOffset = (offsetM / 111_000) * Math.cos(bearing);
  const lngOffset =
    (offsetM / (111_000 * Math.cos((current.lat * Math.PI) / 180))) * Math.sin(bearing);

  return {
    lat: current.lat + latOffset,
    lng: current.lng + lngOffset,
    label: `${current.label}周邊`,
    placeId: `offset:${step}:${current.lat.toFixed(4)},${current.lng.toFixed(4)}`,
  };
}

export function withTripAddPlaceSearchCenter(
  recSession: TripAddPlaceRecommendationSession,
  center: TripAddPlaceSearchCenter,
): TripAddPlaceRecommendationSession {
  const searchCenterPlaceIds = [
    ...(recSession.searchCenterPlaceIds ?? []),
    center.placeId,
  ];
  return {
    ...recSession,
    searchCenterLat: center.lat,
    searchCenterLng: center.lng,
    searchCenterLabel: center.label,
    searchCenterPlaceId: center.placeId,
    searchCenterPlaceIds,
    originLat: recSession.originLat ?? center.lat,
    originLng: recSession.originLng ?? center.lng,
  };
}

export function initTripAddPlaceSearchCenter(
  recSession: TripAddPlaceRecommendationSession,
  ctx: TripAddPlaceContext,
): TripAddPlaceRecommendationSession {
  const anchor = tripAnchorFromContext(ctx);
  if (!anchor) return recSession;
  return withTripAddPlaceSearchCenter(
    {
      ...recSession,
      originLat: anchor.lat,
      originLng: anchor.lng,
    },
    anchor,
  );
}

function candidateScore(
  rec: RoamieRecommendationItem,
  centerLat: number,
  centerLng: number,
): number {
  const rating = rec.rating ?? 0;
  const reviews = rec.userRatingCount ?? 0;
  const distKm = calculateDistanceKm(centerLat, centerLng, rec.lat, rec.lng) ?? 8;
  const popularity = Math.log10(reviews + 1) * 2;
  const distancePenalty = distKm * 0.45;
  return rating * 2.2 + popularity - distancePenalty;
}

export function rankAndTrimTripAddPlaceCandidates(
  items: RoamieRecommendationItem[],
  center: TripAddPlaceSearchCenter,
  maxKm: number,
  keep = TRIP_ADD_PLACE_CANDIDATE_KEEP,
): RoamieRecommendationItem[] {
  const scored = items
    .map((rec) => {
      const distKm = calculateDistanceKm(center.lat, center.lng, rec.lat, rec.lng);
      return { rec, distKm, score: candidateScore(rec, center.lat, center.lng) };
    })
    .filter((row) => isWithinTripAddPlaceDistance(row.distKm, maxKm))
    .sort((a, b) => b.score - a.score);

  console.info("[TRIP_ADD_PLACE_RANK]", {
    raw: items.length,
    afterDistance: scored.length,
    keep,
    center: center.label,
    maxKm,
  });

  return scored.slice(0, keep).map((row) => row.rec);
}

export function logTripAddPlaceSearch(params: {
  label: string;
  center: TripAddPlaceSearchCenter;
  radiusM: number;
  radiusStep: number;
  maxDistanceKm: number;
}): void {
  console.info("[TRIP_ADD_PLACE_SEARCH]", {
    label: params.label,
    center: `${params.center.lat},${params.center.lng}`,
    centerLabel: params.center.label,
    radius: params.radiusM,
    radiusStep: params.radiusStep,
    maxDistanceKm: params.maxDistanceKm,
  });
}
