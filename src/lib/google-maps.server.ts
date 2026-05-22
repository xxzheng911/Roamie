import { resolveGoogleMapsKey } from "@/lib/env.server";
import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";

const PLACES_API = "https://places.googleapis.com/v1";

export const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.photos,places.primaryType,places.businessStatus,places.currentOpeningHours,places.regularOpeningHours,places.utcOffsetMinutes";

export function requireGoogleMapsServerKey(): string {
  const key = resolveGoogleMapsKey();
  if (!key) {
    console.error(
      "[Roamie Maps] Missing API key. Set GOOGLE_MAPS_API_KEY or VITE_GOOGLE_MAPS_API_KEY in .env, then npm run sync:env",
    );
    throw new Error(
      "Google Maps API 金鑰未設定。請在 .env 設定 GOOGLE_MAPS_API_KEY，執行 npm run sync:env 後重啟 dev。",
    );
  }
  if (!isValidGoogleMapsApiKey(key)) {
    throw new Error(
      "Google Maps API 金鑰格式不正確。請使用 Maps API 金鑰（通常以 AIza 開頭），勿使用 OAuth 用戶端密鑰。",
    );
  }
  return key;
}

export function placesSearchTextUrl(): string {
  return `${PLACES_API}/places:searchText`;
}

export function placesSearchNearbyUrl(): string {
  return `${PLACES_API}/places:searchNearby`;
}

export function placePhotoMediaUrl(photoName: string, maxWidth: number, apiKey: string): string {
  return `${PLACES_API}/${photoName}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
}

export function geocodeReverseUrl(lat: number, lng: number, apiKey: string): string {
  return `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=zh-TW&region=tw&result_type=locality|administrative_area_level_1|administrative_area_level_2&key=${apiKey}`;
}
