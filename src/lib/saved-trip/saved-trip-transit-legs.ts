import { devVerboseInfo, isDevVerboseLog } from "@/lib/dev-verbose-log";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { buildDayLegKey, buildLegKey, type TransitLegAdvice, type TransitMode } from "@/lib/transit/types";

type SavedLegStop = {
  placeName?: string | null;
  title?: string | null;
  lat?: number | null;
  lng?: number | null;
  googlePlaceId?: string | null;
};
type SavedLegDuration = { durationMinutes?: number | null; distanceMeters?: number | null };

/** Only these three modes have an estimates slot; other modes keep durationMinutes + resolvedMode. */
function estimateSlot(mode: RoutesTravelMode): "walk" | "drive" | "transit" | null {
  if (mode === "WALK") return "walk";
  if (mode === "DRIVE") return "drive";
  if (mode === "TRANSIT") return "transit";
  return null;
}

function recommendedMode(mode: RoutesTravelMode): TransitMode {
  if (mode === "DRIVE" || mode === "TWO_WHEELER") return "drive";
  if (mode === "TRANSIT") return "transit";
  return "walk";
}

function isFiniteCoord(stop: SavedLegStop | undefined): stop is SavedLegStop & { lat: number; lng: number } {
  return Number.isFinite(stop?.lat) && Number.isFinite(stop?.lng);
}

function endpoint(stop: SavedLegStop & { lat: number; lng: number }) {
  return {
    lat: stop.lat,
    lng: stop.lng,
    ...(stop.googlePlaceId?.trim() ? { placeId: stop.googlePlaceId.trim() } : {}),
  };
}

function validMinutes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Chat save → tripSettings.transitLegs. Every duration came from one Routes request in
 * `requestedMode`, so it is recorded only under that mode; missing or invalid durations
 * stay failed rather than being estimated.
 */
export function buildSavedTripTransitLegs(
  stops: readonly SavedLegStop[],
  legs: readonly SavedLegDuration[],
  requestedMode: RoutesTravelMode,
): Record<string, TransitLegAdvice> {
  const slot = estimateSlot(requestedMode);
  return Object.fromEntries(
    legs.map((leg, idx) => {
      const fromName = stops[idx]?.placeName ?? String(idx);
      const toName = stops[idx + 1]?.placeName ?? String(idx + 1);
      const legKey = `${fromName}→${toName}`;
      const minutes = validMinutes(leg.durationMinutes);
      const distanceMeters = validMinutes(leg.distanceMeters) ?? 0;
      const advice: TransitLegAdvice = {
        legKey,
        fromName,
        toName,
        recommendedMode: recommendedMode(requestedMode),
        headline: `${distanceMeters}m`,
        durationMinutes: minutes ?? 0,
        distanceMeters,
        reason: minutes == null ? "duration_unavailable" : "",
        complexity: "low",
        estimates: minutes != null && slot ? { [slot]: minutes } : {},
        source: "rules",
        requestedMode,
        resolvedMode: requestedMode,
        fallbackReason: null,
        durationSource: minutes == null ? "none" : "directions",
        routeStatus: minutes == null ? "failed" : "ok",
        transportMode: requestedMode,
        transportStatus: minutes == null ? "failed" : "ok",
        transportFallbackMode: null,
        transportDurationMinutes: minutes ?? undefined,
        transitUnavailableProvider: null,
      };
      const from = stops[idx];
      const to = stops[idx + 1];
      if (isFiniteCoord(from) && isFiniteCoord(to)) {
        advice.savedRouteEndpoints = { origin: endpoint(from), destination: endpoint(to) };
      }
      return [legKey, advice];
    }),
  );
}

type DisplayStop = Pick<SavedLegStop, "placeName" | "title" | "lat" | "lng" | "googlePlaceId">;

// Same precision as buildLegRouteFingerprint (route-duration-service coordPart).
const sameCoord = (a: number, b: number) => a.toFixed(4) === b.toFixed(4);

function sameEndpoint(
  saved: { lat: number; lng: number; placeId?: string },
  stop: DisplayStop,
): boolean {
  if (!isFiniteCoord(stop)) return false;
  if (!sameCoord(saved.lat, stop.lat) || !sameCoord(saved.lng, stop.lng)) return false;
  const stopPlaceId = stop.googlePlaceId?.trim();
  return !saved.placeId || !stopPlaceId || saved.placeId === stopPlaceId;
}

/**
 * Display-only leg selection. The day-scoped Directions result stays authoritative;
 * only when that sync *failed* may a save-time Routes duration be shown, and only if it
 * proves the same endpoints and the same requested mode. Persisted legs (including the
 * failed leg's retry cooldown) are never modified, so sync coverage is unchanged.
 */
type DisplaySelectionReason =
  | "scoped_not_failed"
  | "no_saved_leg"
  | "no_saved_endpoints"
  | "saved_not_ok"
  | "mode_mismatch"
  | "transit_not_reusable"
  | "invalid_saved_minutes"
  | "endpoint_mismatch"
  | "saved_reused";

const loggedSelections = new Set<string>();

/** Debug-only, once per leg+outcome; enumerated fields, no names/coordinates/IDs. */
function traceDisplaySelection(dedupeKey: string, record: Record<string, string | boolean | null>): void {
  if (!isDevVerboseLog()) return;
  if (loggedSelections.has(dedupeKey)) return;
  if (loggedSelections.size > 500) loggedSelections.clear();
  loggedSelections.add(dedupeKey);
  devVerboseInfo("[ROUTE_DISPLAY_SELECTION]", record);
}

export function selectDisplayTransitLeg(
  transitLegs: Record<string, TransitLegAdvice> | undefined,
  dateKey: string,
  prev: DisplayStop,
  curr: DisplayStop,
): TransitLegAdvice | undefined {
  if (!transitLegs) return undefined;
  const fromName = prev.placeName || prev.title || "";
  const toName = curr.placeName || curr.title || "";
  const scopedKey = buildDayLegKey(dateKey, fromName, toName);
  const scoped = transitLegs[scopedKey];
  const scopedStatus = scoped ? (scoped.routeStatus ?? scoped.transportStatus ?? "unknown") : "missing";
  if (!scoped || scopedStatus !== "failed") return scoped;
  const saved = transitLegs[buildLegKey(fromName, toName)];
  const requestedMode = scoped.requestedMode ?? scoped.transportMode;
  const savedMode = saved?.resolvedMode ?? saved?.transportMode;
  const slot = savedMode ? estimateSlot(savedMode) : null;
  const minutes = slot ? saved?.estimates?.[slot] : saved?.durationMinutes;
  const reason: DisplaySelectionReason = !saved
    ? "no_saved_leg"
    : !saved.savedRouteEndpoints
      ? "no_saved_endpoints"
      : saved.routeStatus !== "ok" || saved.durationSource !== "directions"
        ? "saved_not_ok"
        : !requestedMode || savedMode !== requestedMode
          ? "mode_mismatch"
          : // Transit duration depends on the trip date; the save-time result has none.
            savedMode === "TRANSIT"
            ? "transit_not_reusable"
            : validMinutes(minutes) == null
              ? "invalid_saved_minutes"
              : !sameEndpoint(saved.savedRouteEndpoints.origin, prev) ||
                  !sameEndpoint(saved.savedRouteEndpoints.destination, curr)
                ? "endpoint_mismatch"
                : "saved_reused";
  traceDisplaySelection(`${scopedKey}|${reason}`, {
    selected: reason === "saved_reused" ? "saved" : "scoped_failed",
    scopedStatus,
    scopedReason: scoped.fallbackReason ?? null,
    reason,
    requestedMode: requestedMode ?? null,
    savedMode: savedMode ?? null,
    hasSavedLeg: Boolean(saved),
    hasSavedEndpoints: Boolean(saved?.savedRouteEndpoints),
  });
  return reason === "saved_reused" ? saved : scoped;
}
