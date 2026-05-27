import { isValidGoogleMapsApiKey } from "@/lib/google-maps-key";

export {
  PLACES_FIELD_MASK,
  PLACE_DETAILS_FIELD_MASK,
  PLACE_DETAILS_SCREEN_FIELD_MASK,
  geocodeReverseUrl,
  placePhotoMediaUrl,
  placesAutocompleteUrl,
  placeDetailsUrl,
  placesSearchNearbyUrl,
  placesSearchTextUrl,
} from "@/lib/google-maps-api";

/** Server runtime API key（僅 process.env，不讀 node:fs，避免被打進 client bundle） */
export function requireGoogleMapsServerKey(): string {
  const key =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
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
