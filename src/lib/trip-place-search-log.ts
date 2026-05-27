import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { isGooglePlacesPermissionError } from "@/lib/places-api-errors";
import type { TripPlaceFieldRole } from "@/lib/trip/trip-place-ref";

export const TRIP_PLACE_USER_MESSAGE = "暫時找不到這個地點，換個關鍵字試試";

function fieldLabel(role: TripPlaceFieldRole): "destination" | "origin" {
  return role === "destination" ? "destination" : "origin";
}

export function logTripPlaceSearchStart(
  query: string,
  mode: string,
  fieldRole?: TripPlaceFieldRole,
): void {
  const key = getGoogleMapsBrowserKey();
  if (fieldRole) {
    console.info("[TRIP_PLACE_SEARCH] field=", fieldLabel(fieldRole));
  }
  console.info("[TRIP_PLACE_SEARCH] query=", query);
  console.info("[TRIP_PLACE_SEARCH] keyLoaded=", Boolean(key));
  console.info("[TRIP_PLACE_SEARCH] mode=", mode);
  if (!key) {
    console.info("[TRIP_PLACE_SEARCH] error=", "missing_api_key");
  }
}

export function logTripPlaceSearchResult(args: {
  status: string;
  predictions: number;
  error?: string | null;
  endpoint?: string;
  fieldRole?: TripPlaceFieldRole;
  rawResponse?: unknown;
}): void {
  if (args.fieldRole) {
    console.info("[TRIP_PLACE_SEARCH] field=", fieldLabel(args.fieldRole));
  }
  if (args.endpoint) {
    console.info("[TRIP_PLACE_SEARCH] endpoint=", args.endpoint);
  }
  console.info("[TRIP_PLACE_SEARCH] status=", args.status);
  console.info("[TRIP_PLACE_SEARCH] predictions=", args.predictions);
  if (args.error) {
    console.info("[TRIP_PLACE_SEARCH] error=", args.error);
    if (isGooglePlacesPermissionError(args.error)) {
      console.info("[TRIP_PLACE_SEARCH] error=", "permission_denied");
    }
  }
  if (args.rawResponse !== undefined) {
    try {
      const raw =
        typeof args.rawResponse === "string"
          ? args.rawResponse.slice(0, 500)
          : JSON.stringify(args.rawResponse).slice(0, 500);
      console.info("[TRIP_PLACE_SEARCH] rawResponse=", raw);
    } catch {
      console.info("[TRIP_PLACE_SEARCH] rawResponse=", "(unserializable)");
    }
  }
}

export function logTripPlaceSelected(place: {
  name?: string;
  placeId?: string;
  lat?: number | null;
  lng?: number | null;
  address?: string;
}): void {
  console.info("[TRIP_PLACE_SELECTED] place=", place.name ?? "(unknown)");
  console.info("[TRIP_PLACE_SELECTED] lat=", place.lat ?? "null");
  console.info("[TRIP_PLACE_SELECTED] lng=", place.lng ?? "null");
  console.info("[TRIP_PLACE_SELECTED] placeId=", place.placeId ?? "(none)");
}

export function logTripPlaceGeocodingFallback(used: boolean): void {
  if (used) {
    console.info("[TRIP_PLACE_FALLBACK] geocodingUsed=true");
  }
}
