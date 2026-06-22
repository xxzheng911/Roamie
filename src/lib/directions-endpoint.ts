import type { LatLng } from "@/lib/google-routes-fetch";
import type { RoutesTravelMode } from "@/lib/routes/types";

export type DirectionsLocationInput = {
  coords?: LatLng | null;
  placeId?: string | null;
  placeName?: string | null;
  /** 城市／國家脈絡，例如「東京, 日本」 */
  locationContext?: string | null;
};

/** Directions API 一律使用 lat,lng（不使用 place_id / 名稱） */
export function formatDirectionsLocation(input: DirectionsLocationInput): string | null {
  const coords = input.coords;
  if (
    coords &&
    coords.lat != null &&
    coords.lng != null &&
    !Number.isNaN(coords.lat) &&
    !Number.isNaN(coords.lng)
  ) {
    return `${coords.lat},${coords.lng}`;
  }
  return null;
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
  if (mode === "WALK" || mode === "BICYCLE") return "walking";
  if (mode === "DRIVE" || mode === "TWO_WHEELER") return "driving";
  return "walking";
}
