export type PlacePhotoSource = "google_places" | "itinerary" | "unsplash" | "fallback";

export function logPlaceDetailOpened(meta: {
  source?: string;
  placeName: string;
  tripId?: string;
  dayIndex?: number | null;
  placeId?: string;
}): void {
  console.info("[PLACE_DETAIL_OPENED]", meta);
}

export function logPlaceDetailPlaceIdResolveStart(meta: {
  placeName: string;
  tripId?: string;
  query?: string;
}): void {
  console.info("[PLACE_DETAIL_PLACE_ID_RESOLVE_START]", meta);
}

export function logPlaceDetailPlaceIdResolveSuccess(meta: {
  placeName: string;
  placeId: string;
  confidence: "high" | "medium" | "low";
  resolvedName: string;
  resolvedAddress: string;
}): void {
  console.info("[PLACE_DETAIL_PLACE_ID_RESOLVE_SUCCESS]", meta);
}

export function logPlaceDetailGoogleDataFetchStart(meta: { placeId: string }): void {
  console.info("[PLACE_DETAIL_GOOGLE_DATA_FETCH_START]", meta);
}

export function logPlaceDetailGoogleDataFetchSuccess(meta: {
  placeId: string;
  hasPhotos: boolean;
  hasOpeningHours: boolean;
  hasWebsite: boolean;
  hasPhone: boolean;
  rating: number | null;
}): void {
  console.info("[PLACE_DETAIL_GOOGLE_DATA_FETCH_SUCCESS]", meta);
}

export function logPlaceDetailGoogleDataFetchFailed(meta: {
  placeName: string;
  placeId?: string;
  error: string;
}): void {
  console.info("[PLACE_DETAIL_GOOGLE_DATA_FETCH_FAILED]", meta);
}

export function logPlaceDetailRenderData(meta: {
  placeName: string;
  placeId: string;
  hasGoogleData: boolean;
  hasPhoto: boolean;
  hasHours: boolean;
  hasWebsite: boolean;
  hasPhone: boolean;
}): void {
  console.info("[PLACE_DETAIL_RENDER_DATA]", meta);
}

export function logPlaceDetailPhotoSource(meta: {
  placeName: string;
  source: "google_places" | "itinerary" | "unsplash" | "fallback";
  hasGooglePhoto: boolean;
}): void {
  console.info("[PLACE_DETAIL_PHOTO_SOURCE]", meta);
}

export function logPlaceDetailRouteContext(meta: {
  source: "trip_sequence" | "current_location";
  fromPlace: string;
  toPlace: string;
}): void {
  console.info("[PLACE_DETAIL_ROUTE_CONTEXT]", meta);
}
