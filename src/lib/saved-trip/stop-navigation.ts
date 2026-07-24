/**
 * Stop navigability + identity checks before Directions.
 * Prefer place_id / navigation coords; reject approx / mismatched stops.
 */
import { isGooglePlaceId } from "@/lib/place-detail-handoff";
import { distanceMeters } from "@/lib/geo-distance";
import type { LatLng } from "@/lib/google-routes-fetch";
import type { DirectionsLocationInput } from "@/lib/directions-endpoint";

export type CoordinateSource =
  | "google_places"
  | "place_details"
  | "navigation"
  | "approx_center"
  | "generated"
  | "fallback"
  | "region_center"
  | "geocode"
  | "unknown";

export type StopNavigationFields = {
  placeName?: string | null;
  title?: string | null;
  localizedDisplayName?: string | null;
  googlePlaceId?: string | null;
  lat?: number | null;
  lng?: number | null;
  navigationLatitude?: number | null;
  navigationLongitude?: number | null;
  coordinateSource?: CoordinateSource | string | null;
  address?: string | null;
};

export type StopNavigationIdentityResult = {
  ok: boolean;
  reason?: string;
  placeId: string | null;
  coords: LatLng | null;
  coordinateSource: CoordinateSource;
  useForDirections: boolean;
};

const APPROX_SOURCES = new Set<string>([
  "approx_center",
  "generated",
  "fallback",
  "region_center",
]);

/** Same-point threshold — likely duplicate / broken identity. */
const SAME_POINT_EPS_M = 5;
/** Name↔coords sanity: if placeId missing and coords look like region center blob. */
const REGION_CENTER_NAMES_RE =
  /^(濟州|濟州島|jeju|서울|首爾|seoul|東京|tokyo|大阪|osaka|台北|taipei|台灣|korea|韓國)$/i;

export function isApproximateCoordinateSource(
  source: string | null | undefined,
): boolean {
  if (!source) return false;
  return APPROX_SOURCES.has(source.trim().toLowerCase());
}

export function normalizeCoordinateSource(
  source: string | null | undefined,
): CoordinateSource {
  const s = (source ?? "").trim().toLowerCase();
  if (
    s === "google_places" ||
    s === "place_details" ||
    s === "navigation" ||
    s === "approx_center" ||
    s === "generated" ||
    s === "fallback" ||
    s === "region_center" ||
    s === "geocode" ||
    s === "unknown"
  ) {
    return s;
  }
  return "unknown";
}

export function isFiniteLatLng(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6)
  );
}

function pickCoords(stop: StopNavigationFields): {
  coords: LatLng | null;
  source: CoordinateSource;
} {
  const navLat = stop.navigationLatitude;
  const navLng = stop.navigationLongitude;
  if (isFiniteLatLng(navLat, navLng)) {
    return {
      coords: { lat: navLat!, lng: navLng! },
      source: "navigation",
    };
  }
  if (isFiniteLatLng(stop.lat, stop.lng)) {
    return {
      coords: { lat: stop.lat!, lng: stop.lng! },
      source: normalizeCoordinateSource(stop.coordinateSource),
    };
  }
  return { coords: null, source: normalizeCoordinateSource(stop.coordinateSource) };
}

function displayNameOf(stop: StopNavigationFields): string {
  return (
    stop.localizedDisplayName?.trim() ||
    stop.placeName?.trim() ||
    stop.title?.trim() ||
    ""
  );
}

/**
 * Validate that name / placeId / coords refer to one coherent place.
 * Mismatched stops must not enter route calculation.
 */
export function checkStopNavigationIdentity(
  stop: StopNavigationFields,
  opts?: { silent?: boolean },
): StopNavigationIdentityResult {
  const name = displayNameOf(stop);
  const rawPlaceId = stop.googlePlaceId?.trim() ?? "";
  const placeId = rawPlaceId && isGooglePlaceId(rawPlaceId) ? rawPlaceId : null;
  const { coords, source } = pickCoords(stop);
  const approx = isApproximateCoordinateSource(source);
  const silent = opts?.silent === true;

  const fail = (reason: string, coordinateSource: CoordinateSource = source): StopNavigationIdentityResult => {
    if (!silent) logIdentityCheck(stop, false, reason, placeId, coords, coordinateSource);
    return {
      ok: false,
      reason,
      placeId,
      coords,
      coordinateSource,
      useForDirections: false,
    };
  };

  if (!name) {
    return fail("missing_name");
  }

  if (REGION_CENTER_NAMES_RE.test(name) && !placeId) {
    return fail("region_center_as_stop", source === "unknown" ? "region_center" : source);
  }

  if (approx && !placeId) {
    return fail("approx_coords_without_place_id");
  }

  if (!placeId && !coords) {
    return fail("missing_place_id_and_coords");
  }

  // placeId alone is enough for Directions (place_id:…).
  if (placeId) {
    return {
      ok: true,
      placeId,
      coords,
      coordinateSource: source === "unknown" ? "google_places" : source,
      useForDirections: true,
    };
  }

  // Coords only — allowed when not approx.
  if (coords && !approx) {
    return {
      ok: true,
      placeId: null,
      coords,
      coordinateSource: source,
      useForDirections: true,
    };
  }

  return fail("unusable_coords");
}

function logIdentityCheck(
  stop: StopNavigationFields,
  ok: boolean,
  reason: string,
  placeId: string | null,
  coords: LatLng | null,
  source: CoordinateSource,
): void {
  // Only surface mismatches / unusable stops — avoid per-stop OK spam.
  if (ok) return;
  const name = displayNameOf(stop);
  console.warn(
    [
      "[STOP_NAVIGATION_IDENTITY_CHECK]",
      `ok=${ok}`,
      `name=${name || "n/a"}`,
      `placeId=${placeId ?? "none"}`,
      `coords=${coords ? `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}` : "none"}`,
      `coordinateSource=${source}`,
      `reason=${reason}`,
    ].join(" "),
  );
}

/** Build Directions origin/destination input — place_id first. */
export function toDirectionsLocationInput(
  stop: StopNavigationFields,
  identity?: StopNavigationIdentityResult,
): DirectionsLocationInput | null {
  const checked = identity ?? checkStopNavigationIdentity(stop);
  if (!checked.useForDirections) return null;

  return {
    placeId: checked.placeId,
    coords: checked.coords,
    placeName: displayNameOf(stop),
  };
}

/** Reject origin≈destination as a routable leg. */
export function areEndpointsAbnormallySame(
  a: LatLng | null,
  b: LatLng | null,
): boolean {
  if (!a || !b) return false;
  return distanceMeters(a, b) < SAME_POINT_EPS_M;
}

export type RouteRegionProfile =
  | "short_urban"
  | "mid_long"
  | "transit_dense"
  | "island_rural";

/** Infer region routing profile from location context + distance. */
export function resolveRouteRegionProfile(
  locationContext: string | null | undefined,
  straightLineMeters: number,
  regionCode?: string | null,
): RouteRegionProfile {
  const ctx = (locationContext ?? "").toLowerCase();
  const region = (regionCode ?? "").toLowerCase();

  const islandRural =
    /濟州|jeju|沖繩|okinawa|夏威夷|hawaii|bali|峇里|普吉|phuket|island|島|漢拿|漢拏|西歸浦|涯月|城山|箱根|富士|河口湖|阿里山|日月潭/.test(
      ctx,
    ) || /island|島/.test(ctx);

  if (islandRural) return "island_rural";

  const transitDense =
    /東京|tokyo|大阪|osaka|京都|kyoto|首爾|seoul|台北|taipei|新加坡|singapore|香港|hong\s*kong|paris|倫敦|london|紐約|new\s*york|上海|北京/.test(
      ctx,
    ) ||
    region === "jp" ||
    region === "sg" ||
    region === "hk";

  if (straightLineMeters <= 1_500) return "short_urban";
  if (transitDense && straightLineMeters <= 8_000) return "transit_dense";
  if (straightLineMeters > 3_000) return "mid_long";
  return transitDense ? "transit_dense" : "short_urban";
}
