/**
 * Route Navigability Gate — block soft-pass when many legs cannot be routed.
 */
import type { PlaceResult } from "@/lib/place-result";
import {
  checkStopNavigationIdentity,
  type CoordinateSource,
} from "@/lib/saved-trip/stop-navigation";
import type { TransitLegAdvice } from "@/lib/transit/types";
import { distanceMeters } from "@/lib/geo-distance";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveParentLandmarkKey } from "@/lib/ai/ai-parent-landmark-dedup";

type DayPlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

type ComposedDayPlan = {
  day: number;
  entries: DayPlanEntry[];
  isIncomplete?: boolean;
};

export type RouteNavigabilityGateResult = {
  ok: boolean;
  totalStops: number;
  stopsWithPlaceId: number;
  stopsApproxCoords: number;
  identityMismatchStops: number;
  invalidCoordinateStops: number;
  /** Days where ≥2 adjacent legs look unroutable (missing id / approx / same-point). */
  highUnavailableDays: number;
  longLegsWithoutDrivePreference: number;
  reasons: string[];
};

const LONG_LEG_M = 5_000;
const MAX_UNAVAILABLE_LEGS_PER_DAY = 1;

function stopFields(place: PlaceResult, name: string) {
  return {
    placeName: name,
    title: name,
    localizedDisplayName: place.localizedDisplayName,
    googlePlaceId: place.id,
    lat: place.lat,
    lng: place.lng,
    navigationLatitude: place.navigationLatitude,
    navigationLongitude: place.navigationLongitude,
    coordinateSource: place.coordinateSource,
    address: place.address,
  };
}

/**
 * Pre-delivery check: stops must have placeId or trusted coords;
 * days must not be dominated by unroutable adjacent pairs.
 */
export function evaluateRouteNavigabilityGate(params: {
  plans: ComposedDayPlan[];
  transitLegs?: Record<string, TransitLegAdvice>;
}): RouteNavigabilityGateResult {
  const { plans, transitLegs } = params;
  let totalStops = 0;
  let stopsWithPlaceId = 0;
  let stopsApproxCoords = 0;
  let identityMismatchStops = 0;
  let invalidCoordinateStops = 0;
  let highUnavailableDays = 0;
  let longLegsWithoutDrivePreference = 0;
  let navigableStops = 0;
  const reasons: string[] = [];

  for (const plan of plans) {
    let dayUnroutableLegs = 0;
    for (let i = 0; i < plan.entries.length; i++) {
      const entry = plan.entries[i]!;
      totalStops += 1;
      const identity = checkStopNavigationIdentity(stopFields(entry.place, entry.name), {
        silent: true,
      });
      const source = identity.coordinateSource as CoordinateSource;

      if (identity.placeId) stopsWithPlaceId += 1;
      if (identity.useForDirections) navigableStops += 1;
      if (
        source === "approx_center" ||
        source === "generated" ||
        source === "fallback" ||
        source === "region_center"
      ) {
        stopsApproxCoords += 1;
      }
      if (!identity.ok) {
        identityMismatchStops += 1;
        if (
          identity.reason === "missing_place_id_and_coords" ||
          identity.reason === "approx_coords_without_place_id" ||
          identity.reason === "unusable_coords" ||
          identity.reason === "region_center_as_stop"
        ) {
          invalidCoordinateStops += 1;
        }
      }

      if (i === 0) continue;
      const prev = plan.entries[i - 1]!;
      const prevId = checkStopNavigationIdentity(stopFields(prev.place, prev.name), {
        silent: true,
      });
      const currId = identity;
      const bothUnusable = !prevId.useForDirections || !currId.useForDirections;
      if (bothUnusable) {
        dayUnroutableLegs += 1;
        continue;
      }

      const a = prevId.coords;
      const b = currId.coords;
      if (a && b) {
        const dist = distanceMeters(a, b);
        if (dist > LONG_LEG_M) {
          if (!prevId.placeId || !currId.placeId) {
            longLegsWithoutDrivePreference += 1;
          }
        }
      }
    }

    if (dayUnroutableLegs > MAX_UNAVAILABLE_LEGS_PER_DAY) {
      highUnavailableDays += 1;
    }
  }

  // Also count post-sync unavailable legs when provided.
  if (transitLegs) {
    const byDay = new Map<string, number>();
    for (const [key, leg] of Object.entries(transitLegs)) {
      const status = leg.routeStatus ?? leg.transportStatus;
      if (status !== "failed" && status !== "mode_unavailable") continue;
      const dateKey = key.includes("§") ? key.slice(0, key.indexOf("§")) : "unknown";
      byDay.set(dateKey, (byDay.get(dateKey) ?? 0) + 1);
    }
    for (const count of byDay.values()) {
      if (count > MAX_UNAVAILABLE_LEGS_PER_DAY) {
        highUnavailableDays += 1;
      }
    }
  }

  if (identityMismatchStops > 0) {
    reasons.push(`identity_mismatch=${identityMismatchStops}`);
  }
  if (invalidCoordinateStops > 0) {
    reasons.push(`invalid_coords=${invalidCoordinateStops}`);
  }
  if (stopsApproxCoords > 0 && stopsApproxCoords > Math.max(1, Math.floor(totalStops * 0.25))) {
    reasons.push(`approx_coords_heavy=${stopsApproxCoords}`);
  }
  if (highUnavailableDays > 0) {
    reasons.push(`high_unavailable_days=${highUnavailableDays}`);
  }

  const navigableRatio = totalStops === 0 ? 1 : navigableStops / totalStops;
  if (navigableRatio < 0.7) {
    reasons.push(`navigable_ratio=${navigableRatio.toFixed(2)}`);
  }

  const ok =
    identityMismatchStops === 0 &&
    invalidCoordinateStops === 0 &&
    highUnavailableDays === 0 &&
    navigableRatio >= 0.7;

  if (!ok && reasons.length === 0) {
    reasons.push("navigability_gate_failed");
  }

  return {
    ok,
    totalStops,
    stopsWithPlaceId,
    stopsApproxCoords,
    identityMismatchStops,
    invalidCoordinateStops,
    highUnavailableDays,
    longLegsWithoutDrivePreference,
    reasons,
  };
}

export function logRouteNavigabilityGate(result: RouteNavigabilityGateResult): void {
  logAiPipeline(
    "[ROUTE_NAVIGABILITY_GATE]",
    `ok=${result.ok}`,
    `totalStops=${result.totalStops}`,
    `stopsWithPlaceId=${result.stopsWithPlaceId}`,
    `stopsApproxCoords=${result.stopsApproxCoords}`,
    `identityMismatchStops=${result.identityMismatchStops}`,
    `invalidCoordinateStops=${result.invalidCoordinateStops}`,
    `highUnavailableDays=${result.highUnavailableDays}`,
    `longLegsWithoutDrivePreference=${result.longLegsWithoutDrivePreference}`,
    `reasons=${result.reasons.join("|") || "none"}`,
  );
}

/**
 * Pick a nearby same-type replacement from the candidate pool for a non-navigable stop.
 * Prefer same parent landmark / complex when possible; never invent unrelated swaps.
 */
export function findNavigableReplacement(
  bad: PlaceResult,
  pool: PlaceResult[],
  usedIds: Set<string>,
  maxDistanceM = 25_000,
): PlaceResult | null {
  const badId = checkStopNavigationIdentity(stopFields(bad, bad.name ?? ""));
  if (badId.useForDirections && badId.placeId) return null;

  const badTypes = new Set((bad.types ?? []).map((t) => t.toLowerCase()));
  const primary = (bad.primaryType ?? "").toLowerCase();
  if (primary) badTypes.add(primary);

  const parentKey = resolveParentLandmarkKey(bad.name ?? "");
  let best: PlaceResult | null = null;
  let bestDist = Infinity;
  let bestSameParent: PlaceResult | null = null;
  let bestSameParentDist = Infinity;

  for (const candidate of pool) {
    const id = (candidate.id ?? "").trim();
    if (!id || usedIds.has(id)) continue;
    const identity = checkStopNavigationIdentity(
      stopFields(candidate, candidate.name ?? ""),
    );
    if (!identity.useForDirections || !identity.placeId) continue;

    const candTypes = new Set((candidate.types ?? []).map((t) => t.toLowerCase()));
    const candPrimary = (candidate.primaryType ?? "").toLowerCase();
    if (candPrimary) candTypes.add(candPrimary);

    const typeOverlap =
      badTypes.size === 0 ||
      [...badTypes].some((t) => candTypes.has(t)) ||
      (primary && candTypes.has(primary));
    if (!typeOverlap) continue;

    let d = Number.POSITIVE_INFINITY;
    if (bad.lat != null && bad.lng != null && candidate.lat != null && candidate.lng != null) {
      d = distanceMeters(
        { lat: bad.lat, lng: bad.lng },
        { lat: candidate.lat, lng: candidate.lng },
      );
      if (d > maxDistanceM) continue;
    }

    const candParent = resolveParentLandmarkKey(candidate.name ?? "");
    const sameParent =
      Boolean(parentKey) &&
      Boolean(candParent) &&
      parentKey === candParent;

    if (sameParent && d < bestSameParentDist) {
      bestSameParentDist = d;
      bestSameParent = candidate;
    }
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    } else if (!best && !Number.isFinite(d)) {
      best = candidate;
    }
  }

  return bestSameParent ?? best;
}
