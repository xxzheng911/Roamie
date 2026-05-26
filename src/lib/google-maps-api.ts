/** Google Maps / Places URL 與欄位常數（client-safe，不含 server env） */

const PLACES_API = "https://places.googleapis.com/v1";

export const PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.photos,places.primaryType,places.types,places.businessStatus,places.currentOpeningHours,places.regularOpeningHours,places.utcOffsetMinutes";

export function placesSearchTextUrl(): string {
  return `${PLACES_API}/places:searchText`;
}

export function placesSearchNearbyUrl(): string {
  return `${PLACES_API}/places:searchNearby`;
}

export function placesAutocompleteUrl(): string {
  return `${PLACES_API}/places:autocomplete`;
}

export function placeDetailsUrl(placeId: string): string {
  return `${PLACES_API}/places/${encodeURIComponent(placeId)}`;
}

export const PLACE_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,rating,userRatingCount,photos,primaryType,types,regularOpeningHours,currentOpeningHours,businessStatus,utcOffsetMinutes,editorialSummary,reviews";

export function placePhotoMediaUrl(photoName: string, maxWidth: number, apiKey: string): string {
  return `${PLACES_API}/${photoName}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
}

export function geocodeReverseUrl(
  lat: number,
  lng: number,
  apiKey: string,
  options?: { language?: string; region?: string },
): string {
  const language = options?.language ?? "zh-TW";
  const region = options?.region ? `&region=${options.region}` : "";
  return `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=${language}${region}&result_type=locality|administrative_area_level_1|administrative_area_level_2&key=${apiKey}`;
}

/** 文字 → 座標（規劃表單：日本大阪、韓國首爾等） */
export function geocodeForwardUrl(
  address: string,
  apiKey: string,
  options?: { language?: string; region?: string },
): string {
  const language = options?.language ?? "zh-TW";
  const region = options?.region ? `&region=${options.region}` : "";
  return `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&language=${language}${region}&key=${apiKey}`;
}
