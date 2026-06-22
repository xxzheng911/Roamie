import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import {
  buildLegTransitSchedule,
  defaultLegTransitSchedule,
  resolveLegTransitDeparture,
  resolveTransitDepartureTimeForQuery,
} from "@/lib/saved-trip/leg-departure-time";
import { buildLegKey } from "@/lib/transit/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import type { TransitMode } from "@/lib/transit/types";
import type { RoutesTravelMode } from "@/lib/routes/types";
import {
  fetchScopedLegDuration,
  buildLegRouteFingerprint,
  type RouteLegDurationResult,
  type RouteLegScope,
} from "@/lib/saved-trip/route-duration-service";
import { isTransitRequested } from "@/lib/saved-trip/travel-time";
import { resolveLegTransportLabel } from "@/lib/saved-trip/transport-options";
import { legKeyForItem } from "@/lib/trip/trip-stop-mutations";
import { groupStopsByDate } from "@/lib/trip/trip-stop-mutations";
import { travelLabelToRoutesMode, type FetchRouteQueryOptions } from "@/services/routesService";
import { logDirectionsDebug } from "@/lib/directions-debug-log";
import { resolveDirectionsRegion, routesModeToDirectionsModeLabel } from "@/lib/directions-endpoint";

export function legKeysForItineraryItems(items: RoamieItineraryItem[]): string[] {
  const keys: string[] = [];
  for (const [, dayItems] of groupStopsByDate(items)) {
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      keys.push(buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title));
    }
  }
  return keys;
}

export type ResolveStopCoords = (
  item: RoamieItineraryItem,
) => Promise<{ lat: number; lng: number } | null>;

export type SyncRouteLegsOptions = {
  tripId: string;
  resolveCoords?: ResolveStopCoords;
  onCoordsResolved?: (item: RoamieItineraryItem, coords: { lat: number; lng: number }) => void;
  /** 忽略已快取路段（交通方式變更時，僅限 onlyLegKey） */
  force?: boolean;
  /** 只重算指定 leg（交通方式切換） */
  onlyLegKey?: string;
  locationContext?: string;
  directionsRegion?: string;
  /** 只重算指定日期內的 legs */
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
    console.warn(
      `[ROUTE_DURATION_ERROR] status=geocode_empty message=no_coords name=${item.placeName || item.title}`,
    );
  } catch (e) {
    console.warn(
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

  if (isTransitRequested(transportLabel)) {
    if (route.estimates.transit != null) {
      return `大眾運輸 約 ${route.estimates.transit} 分鐘`;
    }
    if (route.transitUnavailable) {
      return "大眾運輸暫時無法讀取";
    }
    return "大眾運輸暫時無法讀取";
  }

  if (!route.ok) return "暫時無法取得交通時間";

  const mins =
    route.estimates.walk ??
    route.estimates.drive ??
    route.estimates.transit ??
    route.durationMinutes;
  if (mins == null || mins <= 0) return "暫時無法取得交通時間";
  const label = transportLabel.trim() || "移動";
  return `${label} 約 ${mins} 分鐘`;
}

function recommendedModeFromLabel(transportLabel: string, route: RouteLegDurationResult): TransitMode {
  if (/步行|walk/i.test(transportLabel)) return "walk";
  if (/開車|drive|自駕|租車|計程車|共乘/i.test(transportLabel)) return "drive";
  if (/大眾|transit|捷運|地鐵/i.test(transportLabel)) return "transit";
  if (route.mode === "DRIVE") return "drive";
  if (route.mode === "TRANSIT") return "transit";
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
  const leg: TransitLegAdvice = {
    legKey,
    fromName,
    toName,
    recommendedMode: recommendedModeFromLabel(transportLabel, route),
    headline: transportLabel,
    durationMinutes: transitMinutes ?? (route.ok ? route.durationMinutes : 0),
    distanceMeters: route.distanceMeters,
    reason: transitFailed ? "transit_unavailable" : "",
    complexity: "low",
    estimates: {
      walk: requestedMode === "WALK" || requestedMode === "BICYCLE" ? route.estimates.walk : undefined,
      drive:
        requestedMode === "DRIVE" || requestedMode === "TWO_WHEELER"
          ? route.estimates.drive
          : undefined,
      transit: route.estimates.transit,
    },
    source: "rules",
    transportMode: requestedMode,
    transportStatus,
    transportFallbackMode: null,
    transportDurationMinutes: transitMinutes ?? undefined,
    transportDisplayText: buildTransportDisplayText(route, transportLabel),
    routeCacheFingerprint,
    transitUnavailableProvider: route.transitUnavailableProvider ?? null,
  };

  console.info(
    `[ROUTE_UI_UPDATE] legId=${legKey} mode=${requestedMode} durationMinutes=${leg.transportDurationMinutes ?? 0}`,
  );

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
    transportDisplayText: japanTransit ? undefined : "暫時無法取得交通時間",
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
      leg.estimates.drive != null
    );
  }

  return false;
}

/** 是否已有可顯示的相鄰路段耗時（用於避免不必要的重抓） */
export function transitLegsCoverCurrentItems(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
  options?: { directionsRegion?: string },
): boolean {
  const transitLegs = settings.transitLegs;
  if (!transitLegs || Object.keys(transitLegs).length === 0) return false;

  let dayIndex = 0;
  for (const [dateKey, dayItems] of groupStopsByDate(items)) {
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      const legKey = buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title);
      const transportLabel = transportLabelForLeg(settings, curr, dateKey);
      const mode = travelLabelToRoutesMode(transportLabel);
      const leg = transitLegs[legKey];

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
        i - 1,
        origin,
        destination,
        mode,
        departureTime,
      );

      if (!legRouteIsCovered(leg, mode, fingerprint)) return false;
    }
    dayIndex += 1;
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
  const legKey = buildLegKey(fromName, toName);
  const transportLabel = transportLabelForLeg(settings, curr, dateKey);
  const mode: RoutesTravelMode = travelLabelToRoutesMode(transportLabel);
  const modeLabel = routesModeToDirectionsModeLabel(mode);
  const existing = settings.transitLegs?.[legKey];
  const forceThisLeg = options.force && (!options.onlyLegKey || options.onlyLegKey === legKey);

  const scope: RouteLegScope = {
    tripId: options.tripId,
    dayIndex,
    legIndex,
    legKey,
  };

  const region = options.directionsRegion ?? resolveDirectionsRegion(options.locationContext);
  const isJapanTransitLeg = mode === "TRANSIT" && region === "jp";

  const departureTime =
    mode === "TRANSIT" && !isJapanTransitLeg
      ? resolveLegTransitDeparture(prev, settings, dateKey, {
          dayIndex,
          legIndex,
          legKey,
        }).departureTime
      : undefined;

  const queryBase = buildRouteQueryOptions(prev, curr, options, departureTime, legKey);

  const origin = await resolveItemCoords(prev, options);
  const destination = await resolveItemCoords(curr, options);

  if (!origin || !destination) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: modeLabel,
      hasOrigin: Boolean(origin),
      hasDestination: Boolean(destination),
      skippedReason: "missing_coords",
    });
    return buildMissingCoordsLeg(legKey, fromName, toName, transportLabel, mode, region);
  }

  const routeCacheFingerprint = buildLegRouteFingerprint(
    dayIndex,
    legIndex,
    origin,
    destination,
    mode,
    departureTime,
  );

  if (!forceThisLeg && legRouteIsCovered(existing, mode, routeCacheFingerprint)) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: modeLabel,
      skippedReason: "leg_already_covered",
    });
    return existing!;
  }

  try {
    const route = await fetchScopedLegDuration({
      scope,
      origin,
      destination,
      preferredMode: mode,
      query: { ...queryBase, departureTime },
      force: forceThisLeg,
    });

    if (!route.ok && route.transitUnavailableProvider !== "google_maps_deeplink") {
      logDirectionsDebug("request failed", {
        legKey,
        mode: modeLabel,
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        error: mode === "TRANSIT" ? "transit_unavailable" : "route_failed",
      });
    } else {
      logDirectionsDebug("request success", {
        legKey,
        mode: modeLabel,
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        durationMinutes: route.durationMinutes,
      });
    }

    return buildTransitLeg(
      legKey,
      fromName,
      toName,
      route,
      transportLabel,
      mode,
      routeCacheFingerprint,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logDirectionsDebug("request failed", { legKey, mode: modeLabel, error: msg });
    return buildMissingCoordsLeg(legKey, fromName, toName, transportLabel, mode, region);
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
  const next: Record<string, TransitLegAdvice> = { ...(settings.transitLegs ?? {}) };
  const groups = groupStopsByDate(items);
  let dayIndex = 0;

  for (const [dateKey, dayItems] of groups) {
    if (options.onlyDateKey && options.onlyDateKey !== dateKey) {
      dayIndex += 1;
      continue;
    }
    for (let i = 1; i < dayItems.length; i++) {
      const prev = dayItems[i - 1]!;
      const curr = dayItems[i]!;
      const legKey = buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title);

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
    dayIndex += 1;
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
