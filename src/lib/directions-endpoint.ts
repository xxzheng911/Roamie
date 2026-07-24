import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { isGooglePlaceId } from "@/lib/place-detail-handoff";

export type DirectionsLocationInput = {
  coords?: LatLng | null;
  placeId?: string | null;
  placeName?: string | null;
  /** 城市／國家脈絡，例如「東京, 日本」 */
  locationContext?: string | null;
};

/**
 * Directions origin/destination formatter.
 * Prefer place_id:<id> (routable entrance) over raw lat,lng (often POI centroid).
 */
export function formatDirectionsLocation(input: DirectionsLocationInput): string | null {
  const placeId = input.placeId?.trim() ?? "";
  if (placeId && isGooglePlaceId(placeId)) {
    return `place_id:${placeId.replace(/^places\//i, "")}`;
  }

  const coords = input.coords;
  if (
    coords &&
    coords.lat != null &&
    coords.lng != null &&
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng) &&
    !Number.isNaN(coords.lat) &&
    !Number.isNaN(coords.lng)
  ) {
    return `${coords.lat},${coords.lng}`;
  }
  return null;
}

export function directionsLocationType(formatted: string | null): "place_id" | "latlng" | "none" {
  if (!formatted) return "none";
  if (formatted.startsWith("place_id:")) return "place_id";
  return "latlng";
}

export function formatDirectionsLatLng(coords: LatLng): string {
  return `${coords.lat},${coords.lng}`;
}

/** Google Directions `region` bias（避免日本行程誤用 tw） */
export function resolveDirectionsRegion(countryOrContext?: string | null): string {
  const s = (countryOrContext ?? "").toLowerCase();
  if (/日本|japan|\bjp\b|東京|tokyo|大阪|osaka|京都|kyoto|北海道|沖繩|okinawa|名古屋|橫濱|yokohama|福岡|fukuoka|札幌|sapporo/.test(s)) {
    return "jp";
  }
  if (/韓國|korea|\bkr\b|首爾|seoul|釜山|busan|濟州|jeju/.test(s)) {
    return "kr";
  }
  if (/台灣|臺灣|taiwan|\btw\b|台北|taipei|台中|taichung|高雄|kaohsiung/.test(s)) {
    return "tw";
  }
  if (/香港|hong kong|\bhk\b/.test(s)) {
    return "hk";
  }
  if (/新加坡|singapore|\bsg\b/.test(s)) {
    return "sg";
  }
  if (/泰國|thailand|\bth\b|曼谷|bangkok/.test(s)) {
    return "th";
  }
  return "tw";
}

export function routesModeToDirectionsModeLabel(mode: RoutesTravelMode): string {
  if (mode === "TRANSIT") return "transit";
  if (mode === "WALK") return "walking";
  if (mode === "BICYCLE") return "bicycling";
  if (mode === "DRIVE" || mode === "TWO_WHEELER") return "driving";
  return "walking";
}
