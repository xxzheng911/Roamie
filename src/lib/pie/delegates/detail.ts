/**
 * PIE Detail delegates → 既有 placesService / places.functions / place-detail-resolve
 * 無額外商業邏輯。
 */

import {
  fetchPlaceDetailsForIntro,
  fetchPlaceDetailsForScreen,
  fetchPlaceDetailsForScreenWithKey,
  getPlaceDetails as getPlaceDetailsServerFn,
} from "@/lib/places.functions";
import {
  buildPlaceImageUrls,
  canFetchGooglePlaceDetails,
  fetchGooglePlaceDetailsForHandoff,
  mergeFetchedPlace,
  resolveGooglePlaceIdForDetail,
  resolvePlaceDetailHandoff,
  resolvePlaceDetailReason,
} from "@/lib/place-detail-resolve";
import { getPlaceDetails as getPlaceLiteDetails } from "@/services/placesService";

export const pieDetailDelegate = {
  getPlaceLiteDetails,
  fetchPlaceDetailsForScreen,
  fetchPlaceDetailsForScreenWithKey,
  fetchPlaceDetailsForIntro,
  getPlaceDetailsServerFn,
  resolveGooglePlaceIdForDetail,
  fetchGooglePlaceDetailsForHandoff,
  canFetchGooglePlaceDetails,
  resolvePlaceDetailHandoff,
  resolvePlaceDetailReason,
  mergeFetchedPlace,
  buildPlaceImageUrls,
} as const;
