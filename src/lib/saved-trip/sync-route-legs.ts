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
  CROSS_AREA_DRIVE_MIN_METERS,
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
import {
  areEndpointsAbnormallySame,
  checkStopNavigationIdentity,
} from "@/lib/saved-trip/stop-navigation";
import { debugRouteOnce, logRouteOnce, warnRouteOnce } from "@/lib/route-duration-log";
import { displayTransportLabel } from "@/lib/saved-trip/leg-transport-sot";

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
  /**
   * Manual mode switch: only fetch the requested mode.
   * Do not show another mode's duration if it fails.
   */
  allowModeFallback?: boolean;
  /**
   * Stable fingerprint of stop order + transport modes.
   * Used to dedupe ROUTE_QUALITY_SUMMARY per trip/day/version.
   */
  routeVersion?: string;
  triggerSource?:
    | "initial_load"
    | "background_sync"
    | "day_change"
    | "stop_reorder"
    | "single_leg_manual_change"
    | "whole_day_manual_change"
    | "trip_default_change"
    | "coordinate_change"
    | "forced_refresh"
    | "unknown";
  previousResultDeleted?: boolean;
};

function fingerprintEndpointPart(value: string | null | undefined): string {
  return (value ?? "").split("|").slice(0, 6).join("|");
}

function logRouteResultPersistence(params: {
  legKey: string;
  existing: TransitLegAdvice | undefined;
  incoming: TransitLegAdvice;
  routeCacheFingerprint: string;
  options: SyncRouteLegsOptions;
  modeSelectionSource: "auto" | "manual";
}): void {
  const previousStatus = params.existing?.routeStatus ?? params.existing?.transportStatus;
  const incomingStatus = params.incoming.routeStatus ?? params.incoming.transportStatus ?? "unknown";
  const previousSucceeded = previousStatus === "ok";
  const incomingFailed = incomingStatus !== "ok";
  if (!incomingFailed && !previousSucceeded) return;

  const syncScope = params.options.onlyLegKey
    ? "single_leg"
    : params.options.onlyDateKey
      ? "day"
      : "trip";
  const overwriteDecision = params.options.previousResultDeleted
    ? "delete_then_refresh"
    : params.existing
      ? "overwrite"
      : incomingFailed
        ? "insert_failure"
        : "insert_success";
  const endpointIdentitySame = Boolean(
    params.existing?.routeCacheFingerprint &&
      fingerprintEndpointPart(params.existing.routeCacheFingerprint) ===
        fingerprintEndpointPart(params.routeCacheFingerprint),
  );
  const modeFingerprintSame =
    params.existing?.routeCacheFingerprint === params.routeCacheFingerprint;

  logRouteOnce(
    `persistence|${params.legKey}|${params.routeCacheFingerprint}|${incomingStatus}`,
    [
      "[ROUTE_RESULT_PERSISTENCE]",
      `legKey=${params.legKey}`,
      `syncScope=${syncScope}`,
      `forced=${Boolean(params.options.force)}`,
      `manualSelection=${params.modeSelectionSource === "manual"}`,
      `modeSelectionSource=${params.modeSelectionSource}`,
      `triggerSource=${params.options.triggerSource ?? "unknown"}`,
      `allowFallback=${params.options.allowModeFallback ?? params.modeSelectionSource !== "manual"}`,
      `previousExists=${Boolean(params.existing)}`,
      `previousStatus=${previousStatus ?? "none"}`,
      `previousDuration=${params.existing?.durationMinutes ?? "n/a"}`,
      `previousResolvedMode=${params.existing?.resolvedMode ?? params.existing?.transportMode ?? "none"}`,
      `incomingStatus=${incomingStatus}`,
      `incomingDuration=${params.incoming.durationMinutes}`,
      `incomingResolvedMode=${params.incoming.resolvedMode ?? params.incoming.transportMode ?? "none"}`,
      `endpointIdentitySame=${endpointIdentitySame}`,
      `modeFingerprintSame=${modeFingerprintSame}`,
      `overwriteDecision=${overwriteDecision}`,
      `overwriteReason=${params.options.previousResultDeleted ? "manual_mode_result_removed_before_refresh" : incomingFailed ? "incoming_route_failure" : "incoming_route_result"}`,
    ].join(" "),
  );
}

export function transportLabelForLeg(
  settings: TripPlanSettings,
  item: RoamieItineraryItem,
  dateKey: string,
): string {
  return displayTransportLabel(
    resolveLegTransportLabel(settings, legKeyForItem(item), dateKey),
  );
}

/** Stable route version for quality-summary dedupe. */
export function buildRouteVersionFingerprint(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): string {
  const placeKeys = items
    .map(
      (i, idx) =>
        `${idx}:${i.date ?? ""}|${i.googlePlaceId ?? i.placeName ?? i.title}|${i.lat?.toFixed?.(4) ?? ""}|${i.lng?.toFixed?.(4) ?? ""}`,
    )
    .join("|");
  return [
    placeKeys,
    settings.transport ?? "",
    settings.defaultTransportLabel ?? "",
    JSON.stringify(settings.dayTransportLabels ?? {}),
    JSON.stringify(settings.legTransport ?? {}),
  ].join("::");
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
  const sources = [prev.coordinateSource, curr.coordinateSource]
    .filter(Boolean)
    .join("|");
  return {
    departureTime,
    region,
    locationContext,
    originPlaceId: prev.googlePlaceId,
    destinationPlaceId: curr.googlePlaceId,
    logLegKey: legKey,
    tripDate: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined,
    coordinateSource: sources || "unknown",
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
    debugRouteOnce(
      `geocode_empty|${item.googlePlaceId ?? item.placeName ?? item.title}`,
      `[ROUTE_DURATION] status=geocode_empty message=no_coords name=${item.placeName || item.title}`,
    );
  } catch (e) {
    warnRouteOnce(
      `geocode_ex|${item.googlePlaceId ?? item.placeName ?? item.title}`,
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

  if (!route.ok || route.routeStatus === "mode_unavailable" || route.routeStatus === "failed") {
    if (route.routeStatus === "mode_unavailable" || route.fallbackReason === "mode_unavailable") {
      return "暫無法取得交通時間";
    }
    return "查看路線";
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
    transportMode: route.resolvedMode ?? route.mode,
    resolvedMode: route.resolvedMode ?? route.mode,
    requestedMode: route.requestedMode,
    routeStatus: route.routeStatus ?? (route.ok ? "ok" : "failed"),
    durationSource: route.durationSource,
    fallbackReason: route.fallbackReason,
  };

  const mins = travelMinutesForMode(pseudoLeg, displayLabel);
  if (mins == null) {
    return route.ok ? undefined : "查看路線";
  }

  return `${displayLabel} 約 ${mins} 分鐘${estimatedDisplaySuffix(displayLabel, route)}`;
}

function recommendedModeFromLabel(transportLabel: string, route: RouteLegDurationResult): TransitMode {
  const resolved = route.resolvedMode ?? route.mode;
  if (resolved === "DRIVE" || resolved === "TWO_WHEELER") return "drive";
  if (resolved === "TRANSIT") return "transit";
  if (resolved === "WALK" || resolved === "BICYCLE") return "walk";
  const fallback = transportFallbackModeFromResult(route);
  if (fallback === "drive") return "drive";
  if (fallback === "transit") return "transit";
  if (fallback === "walk") return "walk";
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
  modeSelectionSource: "auto" | "manual" = "auto",
): TransitLegAdvice {
  const transitFailed =
    route.transitUnavailable &&
    isTransitRequested(transportLabel) &&
    route.estimates.transit == null;

  const resolvedMode = route.resolvedMode ?? route.mode ?? requestedMode;
  const routeStatus =
    route.routeStatus ??
    (route.ok
      ? "ok"
      : transitFailed
        ? "transit_unavailable"
        : route.fallbackReason === "mode_unavailable"
          ? "mode_unavailable"
          : "failed");

  const transportStatus =
    routeStatus === "ok"
      ? "ok"
      : routeStatus === "transit_unavailable"
        ? "transit_unavailable"
        : "failed";

  const transportFallbackMode = transportFallbackModeFromResult(route);
  const displayLabel = resolvedTransportDisplayLabel(transportLabel, route);
  const durationMinutes =
    route.ok && route.durationMinutes > 0
      ? route.durationMinutes
      : (route.estimates.transit ?? route.estimates.drive ?? route.estimates.walk ?? 0);

  const leg: TransitLegAdvice = {
    legKey,
    fromName,
    toName,
    recommendedMode: recommendedModeFromLabel(transportLabel, route),
    headline: displayLabel,
    durationMinutes,
    distanceMeters: route.distanceMeters,
    reason: transitFailed
      ? "transit_unavailable"
      : route.fallbackReason ?? "",
    complexity: "low",
    estimates: {
      walk: route.estimates.walk,
      drive: route.estimates.drive,
      transit: route.estimates.transit,
    },
    source: "rules",
    requestedMode: route.requestedMode ?? requestedMode,
    resolvedMode,
    fallbackReason: route.fallbackReason ?? null,
    durationSource: route.durationSource ?? (route.ok ? "directions" : "none"),
    routeStatus,
    transportMode: resolvedMode,
    transportStatus,
    transportFallbackMode,
    transportDurationMinutes: route.ok ? durationMinutes : undefined,
    transportDisplayText: buildTransportDisplayText(route, transportLabel),
    routeCacheFingerprint,
    transitUnavailableProvider: route.transitUnavailableProvider ?? null,
    modeSelectionSource,
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
    reason: isTransitRequested(transportLabel) ? "transit_unavailable" : "missing_coords",
    complexity: "low",
    estimates: {},
    source: "rules",
    requestedMode,
    resolvedMode: requestedMode,
    fallbackReason: japanTransit ? "transit_unavailable" : "missing_coords",
    durationSource: "none",
    routeStatus: japanTransit ? "transit_unavailable" : "failed",
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
  // Coverage keys off the fingerprint of the *request* preference chain start mode.
  // Resolved mode may differ after fallback — that is still a valid covered leg.
  if (leg.routeCacheFingerprint !== routeCacheFingerprint) return false;

  const status = leg.routeStatus ?? leg.transportStatus;
  if (status === "mode_unavailable" || status === "failed") {
    // Failed legs for this fingerprint: treat as covered so we don't thrash retries
    // within the same session (TTL handles refresh). Manual mode change clears the leg.
    return leg.requestedMode === requestedMode;
  }

  if (requestedMode === "TRANSIT") {
    if (status === "ok" && (leg.resolvedMode ?? leg.transportMode) === "TRANSIT") {
      return (leg.estimates.transit ?? leg.durationMinutes) > 0;
    }
    if (status === "transit_unavailable") return true;
    return false;
  }

  if (status === "ok") {
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

function buildIdentityFailedLeg(
  legKey: string,
  fromName: string,
  toName: string,
  transportLabel: string,
  requestedMode: RoutesTravelMode,
  reason: string,
  modeSelectionSource: "auto" | "manual",
): TransitLegAdvice {
  return {
    legKey,
    fromName,
    toName,
    recommendedMode: isTransitRequested(transportLabel) ? "transit" : "walk",
    headline: transportLabel,
    durationMinutes: 0,
    distanceMeters: 0,
    reason,
    complexity: "low",
    estimates: {},
    source: "rules",
    requestedMode,
    resolvedMode: requestedMode,
    fallbackReason: reason,
    durationSource: "none",
    routeStatus: "failed",
    transportMode: requestedMode,
    transportStatus: "failed",
    transportFallbackMode: null,
    transportDurationMinutes: undefined,
    transportDisplayText: "查看路線",
    transitUnavailableProvider: null,
    modeSelectionSource,
  };
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

  // Manual lock only when caller says so, or prior leg was user-locked.
  // AI / initial sync must keep allowModeFallback=true.
  const allowModeFallback =
    options.allowModeFallback === false || existing?.modeSelectionSource === "manual"
      ? false
      : true;
  const modeSelectionSource: "auto" | "manual" = allowModeFallback ? "auto" : "manual";

  const prevIdentity = checkStopNavigationIdentity(prev);
  const currIdentity = checkStopNavigationIdentity(curr);
  if (!prevIdentity.useForDirections || !currIdentity.useForDirections) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: routesModeToDirectionsModeLabel(userMode),
      skippedReason: "identity_or_coords_unusable",
    });
    return buildIdentityFailedLeg(
      legKey,
      fromName,
      toName,
      transportLabel,
      userMode,
      !prevIdentity.useForDirections
        ? `origin_${prevIdentity.reason ?? "invalid"}`
        : `destination_${currIdentity.reason ?? "invalid"}`,
      modeSelectionSource,
    );
  }

  const origin = prevIdentity.coords ?? (await resolveItemCoords(prev, options));
  const destination = currIdentity.coords ?? (await resolveItemCoords(curr, options));

  // place_id-only stops: still need coords for fingerprint / distance gates.
  // If missing, use a sentinel near (0,0) is wrong — skip distance-based walk upgrade
  // by using zeros only when both missing (rare when placeId present).
  if ((!origin || !destination) && !(prevIdentity.placeId && currIdentity.placeId)) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: routesModeToDirectionsModeLabel(userMode),
      hasOrigin: Boolean(origin),
      hasDestination: Boolean(destination),
      skippedReason: "missing_coords",
    });
    return buildMissingCoordsLeg(legKey, fromName, toName, transportLabel, userMode, region);
  }

  const originLatLng = origin ?? { lat: 0, lng: 0 };
  const destLatLng = destination ?? { lat: 0, lng: 0 };

  if (origin && destination && areEndpointsAbnormallySame(origin, destination)) {
    logDirectionsDebug("skipped", {
      legKey,
      mode: routesModeToDirectionsModeLabel(userMode),
      skippedReason: "same_origin_destination",
    });
    return buildIdentityFailedLeg(
      legKey,
      fromName,
      toName,
      transportLabel,
      userMode,
      "same_origin_destination",
      modeSelectionSource,
    );
  }

  // Distance-first mode: do not lead with walking for long / cross-area legs.
  const straightM =
    origin && destination ? straightLineDistanceMeters(origin, destination) : CROSS_AREA_DRIVE_MIN_METERS + 1;
  const mode = resolveInitialDirectionsMode(userMode, straightM, {
    locationContext: options.locationContext,
    regionCode: region,
  });
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
    originLatLng,
    destLatLng,
    mode,
    departureTime,
    {
      originPlaceId: prev.googlePlaceId ?? prevIdentity.placeId ?? undefined,
      destinationPlaceId: curr.googlePlaceId ?? currIdentity.placeId ?? undefined,
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
      buildLegRouteFingerprint(dayIndex, legIndex, originLatLng, destLatLng, userMode, departureTime, {
        originPlaceId: prev.googlePlaceId ?? prevIdentity.placeId ?? undefined,
        destinationPlaceId: curr.googlePlaceId ?? currIdentity.placeId ?? undefined,
        tripDate: /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined,
      }),
    )
  ) {
    return { ...existing!, legKey };
  }

  try {
    const route = await fetchScopedLegDuration({
      scope,
      origin: originLatLng,
      destination: destLatLng,
      preferredMode: userMode,
      query: {
        ...queryBase,
        departureTime,
        originPlaceId: prev.googlePlaceId ?? prevIdentity.placeId ?? queryBase.originPlaceId,
        destinationPlaceId:
          curr.googlePlaceId ?? currIdentity.placeId ?? queryBase.destinationPlaceId,
      },
      force: forceThisLeg,
      allowModeFallback,
    });

    const incoming = buildTransitLeg(
      legKey,
      fromName,
      toName,
      route,
      transportLabel,
      userMode,
      routeCacheFingerprint,
      modeSelectionSource,
    );
    logRouteResultPersistence({
      legKey,
      existing,
      incoming,
      routeCacheFingerprint,
      options,
      modeSelectionSource,
    });
    return incoming;
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
  if (items.length < 2) {
    debugRouteOnce(
      `sync|not_required|${options.tripId}|${items.length}`,
      `[ROUTE_DURATION] status=not_required reason=insufficient_stops tripId=${options.tripId} stopCount=${items.length}`,
    );
    return pruneTransitLegsToItinerary(items, settings.transitLegs, settings);
  }

  const pruned = pruneTransitLegsToItinerary(items, settings.transitLegs, settings);
  const next: Record<string, TransitLegAdvice> = { ...pruned };
  const groups = groupStopsByDate(items);
  const dateKeys = orderedTripDateKeys(items, settings);
  const routeVersion =
    options.routeVersion ?? buildRouteVersionFingerprint(items, settings);
  let successLegs = 0;
  let fallbackLegs = 0;
  let unavailableLegs = 0;
  let invalidCoordinateLegs = 0;
  let identityMismatchLegs = 0;
  let totalLegs = 0;

  for (let dayIndex = 0; dayIndex < dateKeys.length; dayIndex++) {
    const dateKey = dateKeys[dayIndex]!;
    if (options.onlyDateKey && options.onlyDateKey !== dateKey) {
      continue;
    }
    const dayItems = groups.get(dateKey) ?? [];
    if (dayItems.length < 2) {
      debugRouteOnce(
        `sync|day_insufficient|${options.tripId}|${dateKey}`,
        `[ROUTE_DURATION] status=not_required reason=insufficient_stops tripId=${options.tripId} day=${dateKey} stopCount=${dayItems.length}`,
      );
      continue;
    }
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

      totalLegs += 1;
      const leg = await syncOneLeg(
        prev,
        curr,
        dateKey,
        dayIndex,
        i - 1,
        settings,
        options,
      );
      next[legKey] = leg;

      const status = leg.routeStatus ?? leg.transportStatus;
      if (status === "ok") {
        successLegs += 1;
        if (
          leg.requestedMode &&
          leg.resolvedMode &&
          leg.requestedMode !== leg.resolvedMode
        ) {
          fallbackLegs += 1;
        }
      } else if (
        leg.reason?.includes("invalid") ||
        leg.reason?.includes("missing_coords") ||
        leg.fallbackReason?.includes("missing_coords") ||
        leg.fallbackReason?.includes("approx") ||
        leg.fallbackReason?.includes("unusable")
      ) {
        invalidCoordinateLegs += 1;
        unavailableLegs += 1;
      } else if (
        leg.reason?.includes("identity") ||
        leg.fallbackReason?.startsWith("origin_") ||
        leg.fallbackReason?.startsWith("destination_")
      ) {
        identityMismatchLegs += 1;
        unavailableLegs += 1;
      } else {
        unavailableLegs += 1;
      }
    }
  }

  const dayScope = options.onlyDateKey ?? "all";
  const qualityKey = `quality|${options.tripId}|${dayScope}|${routeVersion}`;

  if (totalLegs === 0) {
    debugRouteOnce(
      `sync|no_legs|${qualityKey}`,
      `[ROUTE_DURATION] status=not_required reason=no_eligible_legs tripId=${options.tripId} day=${dayScope}`,
    );
    return next;
  }

  // One summary per trip / day / routeVersion — never include fluctuating counts in the key.
  logRouteOnce(
    qualityKey,
    [
      "[ROUTE_QUALITY_SUMMARY]",
      `tripId=${options.tripId}`,
      `day=${dayScope}`,
      `routeVersion=${routeVersion.slice(0, 48)}`,
      `totalLegs=${totalLegs}`,
      `successLegs=${successLegs}`,
      `fallbackLegs=${fallbackLegs}`,
      `unavailableLegs=${unavailableLegs}`,
      `invalidCoordinateLegs=${invalidCoordinateLegs}`,
      `identityMismatchLegs=${identityMismatchLegs}`,
    ].join(" "),
  );

  // Real failure: valid stops/legs expected, but none succeeded.
  if (successLegs === 0 && totalLegs > 0) {
    warnRouteOnce(
      `build_failed|${qualityKey}`,
      [
        "[ROUTE_BUILD_FAILED]",
        `tripId=${options.tripId}`,
        `day=${dayScope}`,
        `totalLegs=${totalLegs}`,
        `unavailableLegs=${unavailableLegs}`,
        `invalidCoordinateLegs=${invalidCoordinateLegs}`,
        `identityMismatchLegs=${identityMismatchLegs}`,
      ].join(" "),
    );
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
    // Manual mode switch default: never show another mode's duration.
    // Caller may override allowModeFallback explicitly.
    allowModeFallback: options.allowModeFallback ?? false,
  });
  const leg = merged[legKey] ?? null;
  if (leg && options.allowModeFallback === false) {
    return { ...leg, modeSelectionSource: "manual" };
  }
  return leg;
}
