import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import {
  buildLegTransitSchedule,
  defaultLegTransitSchedule,
  resolveLegTransitDeparture,
  resolveTransitDepartureTimeForQuery,
} from "@/lib/saved-trip/leg-departure-time";
import {
  buildDayLegKey,
  buildLegKey,
  parseDayLegKey,
  resolveTransitLeg,
} from "@/lib/transit/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import type { TransitMode } from "@/lib/transit/types";
import type { RoutesTravelMode } from "@/lib/routes/types";
import {
  fetchScopedLegDuration,
  buildLegRouteFingerprint,
  type RouteLegDurationResult,
  type RouteLegScope,
} from "@/lib/saved-trip/route-duration-service";
import { isTransitRequested, travelMinutesForMode } from "@/lib/saved-trip/travel-time";
import {
  estimatedDisplaySuffix,
  resolveInitialDirectionsMode,
  resolvedTransportDisplayLabel,
  straightLineDistanceMeters,
  transportFallbackModeFromResult,
} from "@/lib/saved-trip/route-duration-fallback";
import { resolveLegTransportLabel } from "@/lib/saved-trip/transport-options";
import {
  groupStopsByDate,
  legKeyForItem,
  orderedTripDateKeys,
} from "@/lib/trip/trip-stop-mutations";
import { travelLabelToRoutesMode, type FetchRouteQueryOptions } from "@/services/routesService";
import { logDirectionsDebug } from "@/lib/directions-debug-log";
import { resolveDirectionsRegion, routesModeToDirectionsModeLabel } from "@/lib/directions-endpoint";

export function legKeysForItineraryItems(
  items: RoamieItineraryItem[],
  settings?: TripPlanSettings,
): string[] {
  const keys: string[] = [];
  const groups = groupStopsByDate(items);
  for (const dateKey of orderedTripDateKeys(items, settings)) {
    const dayItems = groups.get(dateKey) ?? [];
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      keys.push(
        buildDayLegKey(dateKey, prev.placeName || prev.title, curr.placeName || curr.title),
      );
    }
  }
  return keys;
}

/** 只保留目前行程順序仍存在的 leg，避免 reorder 後沿用舊路段快取 */
export function pruneTransitLegsToItinerary(
  items: RoamieItineraryItem[],
  transitLegs: Record<string, TransitLegAdvice> | undefined,
  settings?: TripPlanSettings,
): Record<string, TransitLegAdvice> {
  const valid = new Set(legKeysForItineraryItems(items, settings));
  const out: Record<string, TransitLegAdvice> = {};
  for (const [key, leg] of Object.entries(transitLegs ?? {})) {
    if (valid.has(key)) {
      out[key] = leg;
      continue;
    }
    const parsed = parseDayLegKey(key);
    if (parsed && valid.has(buildDayLegKey(parsed.dateKey, parsed.from, parsed.to))) {
      out[key] = leg;
    }
  }
  return out;
}

export function dateKeyForLegKey(
  items: RoamieItineraryItem[],
  legKey: string,
  settings?: TripPlanSettings,
): string | null {
  const parsed = parseDayLegKey(legKey);
  if (parsed) return parsed.dateKey;

  const groups = groupStopsByDate(items);
  for (const dateKey of orderedTripDateKeys(items, settings)) {
    const dayItems = groups.get(dateKey) ?? [];
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      const key = buildDayLegKey(dateKey, prev.placeName || prev.title, curr.placeName || curr.title);
      if (key === legKey || buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title) === legKey) {
        return dateKey;
      }
    }
  }
  return null;
}

/** Reorder 後清除該日所有地點間路段快取 */
export function clearTransitLegsForDay(
  _items: RoamieItineraryItem[],
  dateKey: string,
  transitLegs?: Record<string, TransitLegAdvice>,
): Record<string, TransitLegAdvice> {
  const out: Record<string, TransitLegAdvice> = { ...(transitLegs ?? {}) };
  const prefix = `${dateKey}§`;
  for (const key of Object.keys(out)) {
    if (key.startsWith(prefix)) {
      delete out[key];
      continue;
    }
    const parsed = parseDayLegKey(key);
    if (parsed?.dateKey === dateKey) {
      delete out[key];
    }
  }
  return out;
}

export type ResolveStopCoords = (
  item: RoamieItineraryItem,
) => Promise<{ lat: number; lng: number } | null>;

export type SyncRouteLegsOptions = {
  tripId: string;
  resolveCoords?: ResolveStopCoords;
  onCoordsResolved?: (item: RoamieItineraryItem, coords: { lat: number; lng: number }) => void;
  force?: boolean;
  /** 只重算指定 leg（含 dateKey 的 day leg key） */
  onlyLegKey?: string;
  locationContext?: string;
  directionsRegion?: string;
  onlyDateKey?: string;
};

export function transportLabelForLeg(
  settings: TripPlanSettings,
  item: RoamieItineraryItem,
  dateKey: string,
): string {
  return resolveLegTransportLabel(settings, legKeyForItem(item), dateKey);
}

function buildRouteQueryOptions(
  prev: RoamieItineraryItem,
  curr: RoamieItineraryItem,
  dateKey: string,
  options: SyncRouteLegsOptions | undefined,
  departureTime?: string,
  legKey?: string,
): FetchRouteQueryOptions {
  const locationContext = options?.locationContext;
  const region = options?.directionsRegion ?? resolveDirectionsRegion(locationContext);
  return {
    departureTime,
    region,
    locationContext,
    originPlaceId: prev.googlePlaceId,
    destinationPlaceId: curr.googlePlaceId,
    logLegKey: legKey,
    tripDate: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined,
  };
}

async function resolveItemCoords(
  item: RoamieItineraryItem,
  options?: SyncRouteLegsOptions,
): Promise<{ lat: number; lng: number } | null> {
  if (
    item.lat != null &&
    item.lng != null &&
    !Number.isNaN(item.lat) &&
    !Number.isNaN(item.lng)
  ) {
    return { lat: item.lat, lng: item.lng };
  }

  if (!options?.resolveCoords) return null;

  try {
    const coords = await options.resolveCoords(item);
    if (coords) {
      options.onCoordsResolved?.(item, coords);
      return coords;
    }
    console.info(
      `[ROUTE_DURATION_ERROR] status=geocode_empty message=no_coords name=${item.placeName || item.title}`,
    );
  } catch (e) {
    console.info(
      `[ROUTE_DURATION_ERROR] status=geocode_exception message=${e instanceof Error ? e.message : String(e)} name=${item.placeName || item.title}`,
    );
  }
  return null;
}

function buildTransportDisplayText(
  route: RouteLegDurationResult,
  transportLabel: string,
): string | undefined {
  if (route.transitUnavailableProvider === "google_maps_deeplink") {
    return undefined;
  }

  if (isTransitRequested(transportLabel) && !transportFallbackModeFromResult(route)) {
    if (route.estimates.transit != null) {
      return `大眾運輸 約 ${route.estimates.transit} 分鐘`;
    }
    if (route.transitUnavailable) {
      return "大眾運輸暫時無法讀取";
    }
    return "大眾運輸暫時無法讀取";
  }

  const transportFallbackMode = transportFallbackModeFromResult(route);
  const displayLabel = resolvedTransportDisplayLabel(transportLabel, route);

  const pseudoLeg: TransitLegAdvice = {
    legKey: "",
    fromName: "",
    toName: "",
    recommendedMode: "walk",
    headline: displayLabel,
    durationMinutes: route.durationMinutes,
    distanceMeters: route.distanceMeters,
    reason: "",
    complexity: "low",
    estimates: route.estimates,
    source: "rules",
    transportFallbackMode,
    transportMode: route.mode,
  };

  const mins = travelMinutesForMode(pseudoLeg, displayLabel);
  if (mins == null) {
    // Soft UI — never spam ROUTE_DURATION_ERROR on every render.
    return route.ok ? undefined : "查看路線";
  }

  return `${displayLabel} 約 ${mins} 分鐘${estimatedDisplaySuffix(displayLabel, route)}`;
}

function recommendedModeFromLabel(transportLabel: string, route: RouteLegDurationResult): TransitMode {
  const fallback = transportFallbackModeFromResult(route);
  if (fallback === "drive") return "drive";
  if (fallback === "transit") return "transit";
  if (fallback === "walk") return "walk";
  if (route.mode === "DRIVE" || route.mode === "TWO_WHEELER") return "drive";
  if (route.mode === "TRANSIT") return "transit";
  if (/開車|drive|自駕|租車|計程車|共乘/i.test(transportLabel)) return "drive";
  if (/大眾|transit|捷運|地鐵/i.test(transportLabel)) return "transit";
  if (/步行|walk/i.test(transportLabel)) return "walk";
  return "walk";
}

function buildTransitLeg(
  legKey: string,
  fromName: string,
  toName: string,
  route: RouteLegDurationResult,
  transportLabel: string,
  requestedMode: RoutesTravelMode,
  routeCacheFingerprint: string,
): TransitLegAdvice {
  const transitFailed =
    route.transitUnavailable &&
    isTransitRequested(transportLabel) &&
    route.estimates.transit == null;

  const transportStatus = route.ok
    ? "ok"
    : transitFailed
      ? "transit_unavailable"
      : "failed";

  const transitMinutes = route.estimates.transit;
  const transportFallbackMode = transportFallbackModeFromResult(route);
  const resolvedMode = route.mode || requestedMode;
  const displayLabel = resolvedTransportDisplayLabel(transportLabel, route);

  const leg: TransitLegAdvice = {
    legKey,
    fromName,
    toName,
    recommendedMode: recommendedModeFromLabel(transportLabel, route),
    headline: displayLabel,
    durationMinutes: transitMinutes ?? (route.ok ? route.durationMinutes : 0),
    distanceMeters: route.distanceMeters,
    reason: transitFailed ? "transit_unavailable" : "",
    complexity: "low",
    estimates: {
      walk: route.estimates.walk,
      drive: route.estimates.drive,
      transit: route.estimates.transit,
    },
    source: "rules",
    transportMode: resolvedMode,
    transportStatus,
    transportFallbackMode,
    transportDurationMinutes: transitMinutes ?? (route.ok ? route.durationMinutes : undefined),
    transportDisplayText: buildTransportDisplayText(route, transportLabel),
    routeCacheFingerprint,
    transitUnavailableProvider: route.transitUnavailableProvider ?? null,
  };

  return leg;
}

function buildMissingCoordsLeg(
  legKey: string,
  fromName: string,
  toName: string,
  transportLabel: string,
  requestedMode: RoutesTravelMode,
  region?: string,
): TransitLegAdvice {
  const japanTransit =
    requestedMode === "TRANSIT" &&
    region === "jp" &&
    isTransitRequested(transportLabel);

  return {
    legKey,
    fromName,
    toName,
    recommendedMode: isTransitRequested(transportLabel) ? "transit" : "walk",
    headline: transportLabel,
    durationMinutes: 0,
    distanceMeters: 0,
    reason: isTransitRequested(transportLabel) ? "transit_unavailable" : "",
    complexity: "low",
    estimates: {},
    source: "rules",
    transportMode: requestedMode,
    transportStatus: japanTransit ? "transit_unavailable" : "failed",
    transportFallbackMode: null,
    transportDurationMinutes: undefined,
    transportDisplayText: japanTransit ? undefined : "查看路線",
    transitUnavailableProvider: japanTransit ? "google_maps_deeplink" : null,
  };
}

export function legRouteIsCovered(
  leg: TransitLegAdvice | undefined,
  requestedMode: RoutesTravelMode,
  routeCacheFingerprint: string,
): boolean {
  if (!leg) return false;
  if (leg.transportMode && leg.transportMode !== requestedMode) return false;
  if (leg.routeCacheFingerprint !== routeCacheFingerprint) return false;

  if (requestedMode === "TRANSIT") {
    if (leg.transportStatus === "ok" && leg.estimates.transit != null) return true;
    if (leg.transportStatus === "transit_unavailable") return true;
    return false;
  }

  if (leg.transportStatus === "ok") {
    return (
      leg.durationMinutes > 0 ||
      leg.estimates.walk != null ||
      leg.estimates.drive != null ||
      leg.estimates.transit != null
    );
  }

  return false;
}

function legCoverageForSegment(
  prev: RoamieItineraryItem,
  curr: RoamieItineraryItem,
  dateKey: string,
  dayIndex: number,
  legIndex: number,
  settings: TripPlanSettings,
  options?: { directionsRegion?: string },
): boolean {
  const transitLegs = settings.transitLegs;
  if (!transitLegs) return false;

  const fromName = prev.placeName || prev.title;
  const toName = curr.placeName || curr.title;
  const legKey = buildDayLegKey(dateKey, fromName, toName);
  const transportLabel = transportLabelForLeg(settings, curr, dateKey);
  const mode = travelLabelToRoutesMode(transportLabel);
  const leg = transitLegs[legKey] ?? resolveTransitLeg(transitLegs, dateKey, fromName, toName);

  const origin =
    prev.lat != null && prev.lng != null ? { lat: prev.lat, lng: prev.lng } : null;
  const destination =
    curr.lat != null && curr.lng != null ? { lat: curr.lat, lng: curr.lng } : null;
  if (!origin || !destination) return false;

  const transitSchedule =
    mode === "TRANSIT" ? buildLegTransitSchedule(prev, settings, dateKey) : undefined;
  const isJapanTransit = mode === "TRANSIT" && options?.directionsRegion === "jp";
  const departureTime =
    mode === "TRANSIT" && !isJapanTransit
      ? resolveTransitDepartureTimeForQuery(transitSchedule ?? defaultLegTransitSchedule())
          .departureTime
      : undefined;
  const fingerprint = buildLegRouteFingerprint(
    dayIndex,
    legIndex,
    origin,
    destination,
    mode,
    departureTime,
    {
      originPlaceId: prev.googlePlaceId,
      destinationPlaceId: curr.googlePlaceId,
      tripDate: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined,
    },
  );

  return legRouteIsCovered(leg, mode, fingerprint);
}

/** 單日路段是否已有可顯示耗時 */
export function transitLegsCoverDay(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  dateKey: string,
  dayIndex: number,
  options?: { directionsRegion?: string },
): boolean {
  const dayItems = groupStopsByDate(items).get(dateKey) ?? [];
  if (dayItems.length < 2) return true;

  for (let i = 1; i < dayItems.length; i++) {
    if (
      !legCoverageForSegment(
        dayItems[i - 1]!,
        dayItems[i]!,
        dateKey,
        dayIndex,
        i - 1,
        settings,
        options,
      )
    ) {
      return false;
    }
  }
  return true;
}

/** 是否已有可顯示的相鄰路段耗時（全行程） */
export function transitLegsCoverCurrentItems(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  options?: { directionsRegion?: string },
): boolean {
  const groups = groupStopsByDate(items);
  const dateKeys = orderedTripDateKeys(items, settings);
  if (dateKeys.length === 0) return false;

  for (let dayIndex = 0; dayIndex < dateKeys.length; dayIndex++) {
    const dateKey = dateKeys[dayIndex]!;
    const dayItems = groups.get(dateKey) ?? [];
    if (dayItems.length < 2) continue;
    if (!transitLegsCoverDay(items, settings, dateKey, dayIndex, options)) {
      return false;
    }
  }
  return true;
}

async function syncOneLeg(
  prev: RoamieItineraryItem,
  curr: RoamieItineraryItem,
  dateKey: string,
  dayIndex: number,
  legIndex: number,
  settings: TripPlanSettings,
  options: SyncRouteLegsOptions,
): Promise<TransitLegAdvice> {
  const fromName = prev.placeName || prev.title;
  const toName = curr.placeName || curr.title;
  const legKey = buildDayLegKey(dateKey, fromName, toName);
  const transportLabel = transportLabelForLeg(settings, curr, dateKey);
  const userMode: RoutesTravelMode = travelLabelToRoutesMode(transportLabel);
  const existing =
    settings.transitLegs?.[legKey] ??
    resolveTransitLeg(settings.transitLegs, dateKey, fromName, toName);
  const forceThisLeg = options.force && (!options.onlyLegKey || options.onlyLegKey === legKey);

  const scope: RouteLegScope = {
    tripId: options.tripId,
    dateKey,
    dayIndex,
    legIndex,
    legKey,
  };

  const region = options.directionsRegion ?? resolveDirectionsRegion(options.locationContext);

  const origin = await resolveItemCoords(prev, options);
  const destination = await resolveItemCoords(curr, options);

  if (!origin || !destination) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: routesModeToDirectionsModeLabel(userMode),
      hasOrigin: Boolean(origin),
      hasDestination: Boolean(destination),
      skippedReason: "missing_coords",
    });
    return buildMissingCoordsLeg(legKey, fromName, toName, transportLabel, userMode, region);
  }

  // Distance-first mode: do not lead with walking for long / cross-area legs.
  const straightM = straightLineDistanceMeters(origin, destination);
  const mode = resolveInitialDirectionsMode(userMode, straightM);
  const modeLabel = routesModeToDirectionsModeLabel(mode);
  const isJapanTransitLeg = mode === "TRANSIT" && region === "jp";

  const departureTime =
    mode === "TRANSIT" && !isJapanTransitLeg
      ? resolveLegTransitDeparture(prev, settings, dateKey, {
          dayIndex,
          legIndex,
          legKey,
        }).departureTime
      : undefined;

  const queryBase = buildRouteQueryOptions(prev, curr, dateKey, options, departureTime, legKey);

  const routeCacheFingerprint = buildLegRouteFingerprint(
    dayIndex,
    legIndex,
    origin,
    destination,
    mode,
    departureTime,
    {
      originPlaceId: prev.googlePlaceId,
      destinationPlaceId: curr.googlePlaceId,
      tripDate: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined,
    },
  );

  if (!forceThisLeg && legRouteIsCovered(existing, mode, routeCacheFingerprint)) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: modeLabel,
      skippedReason: "leg_already_covered",
    });
    return { ...existing!, legKey };
  }

  // Also accept prior coverage under the user's original mode fingerprint (legacy walk legs).
  if (
    !forceThisLeg &&
    mode !== userMode &&
    legRouteIsCovered(
      existing,
      userMode,
      buildLegRouteFingerprint(dayIndex, legIndex, origin, destination, userMode, departureTime, {
        originPlaceId: prev.googlePlaceId,
        destinationPlaceId: curr.googlePlaceId,
        tripDate: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined,
      }),
    )
  ) {
    return { ...existing!, legKey };
  }

  try {
    const route = await fetchScopedLegDuration({
      scope,
      origin,
      destination,
      preferredMode: userMode,
      query: { ...queryBase, departureTime },
      force: forceThisLeg,
    });

    return buildTransitLeg(
      legKey,
      fromName,
      toName,
      route,
      transportLabel,
      userMode,
      routeCacheFingerprint,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logDirectionsDebug("request failed", { legKey, mode: modeLabel, error: msg });
    return buildMissingCoordsLeg(legKey, fromName, toName, transportLabel, userMode, region);
  }
}

/**
 * 依 Google Directions API 更新相鄰地點耗時（寫入 tripSettings.transitLegs）。
 */
export async function syncTripLegsFromGoogleRoutes(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  options: SyncRouteLegsOptions,
): Promise<Record<string, TransitLegAdvice>> {
  const pruned = pruneTransitLegsToItinerary(items, settings.transitLegs, settings);
  const next: Record<string, TransitLegAdvice> = { ...pruned };
  const groups = groupStopsByDate(items);
  const dateKeys = orderedTripDateKeys(items, settings);

  for (let dayIndex = 0; dayIndex < dateKeys.length; dayIndex++) {
    const dateKey = dateKeys[dayIndex]!;
    if (options.onlyDateKey && options.onlyDateKey !== dateKey) {
      continue;
    }
    const dayItems = groups.get(dateKey) ?? [];
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      const legKey = buildDayLegKey(
        dateKey,
        prev.placeName || prev.title,
        curr.placeName || curr.title,
      );

      if (options.onlyLegKey && options.onlyLegKey !== legKey) {
        continue;
      }

      next[legKey] = await syncOneLeg(
        prev,
        curr,
        dateKey,
        dayIndex,
        i - 1,
        settings,
        options,
      );
    }
  }

  return next;
}

/** 只重算單一 leg（交通方式切換） */
export async function syncSingleTripLegFromGoogleRoutes(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  legKey: string,
  options: SyncRouteLegsOptions,
): Promise<TransitLegAdvice | null> {
  const merged = await syncTripLegsFromGoogleRoutes(items, settings, {
    ...options,
    onlyLegKey: legKey,
    force: true,
  });
  return merged[legKey] ?? null;
}
