import { distanceMeters } from "@/lib/map-explore";
import type { NavigateOptions } from "@tanstack/react-router";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import { buildPlaceRecommendationReason } from "@/lib/build-place-recommendation-reason";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { Locale } from "@/lib/i18n/types";
import {
  isGooglePlaceId,
  latLngFallbackPlaceId,
  setPlaceDetailHandoff,
  type PlaceDetailHandoff,
} from "@/lib/place-detail-handoff";
import type { PlaceResult } from "@/lib/place-result";
import { resolvePlaceDisplayCategory } from "@/lib/unified-place-card";
import {
  saveTripDetailViewState,
  type TripDetailViewState,
} from "@/lib/trip/trip-detail-view-state";
import { persistTripDetailSelectedDay } from "@/lib/trip/trip-detail-selected-day";

function inferExploreCategoryId(place: PlaceResult): string {
  const hay = [
    place.primaryType ?? "",
    ...(place.types ?? []),
    place.name,
  ]
    .join(" ")
    .toLowerCase();
  if (/咖啡|coffee|cafe|茶/.test(hay)) return "coffee";
  if (/景點|觀光|museum|attraction|博物|美術/.test(hay)) return "sight";
  if (/商圈|夜市|購物|shopping|market|百貨/.test(hay)) return "district";
  if (/美食|餐|food|restaurant|小吃|bar|居酒|拉麵|壽司/.test(hay)) return "food";
  if (/公園|park|自然|步道|海/.test(hay)) return "sight";
  if (/酒吧|宵夜|深夜|night/i.test(hay)) return "night";
  return "all";
}

function itineraryItemToPlaceResult(
  item: RoamieItineraryItem,
  googlePlaceId: string,
): PlaceResult {
  const name = item.placeName?.trim() || item.title.trim();
  const id =
    googlePlaceId ||
    (item.lat != null && item.lng != null
      ? latLngFallbackPlaceId(item.lat, item.lng)
      : `trip-${encodeURIComponent(name)}`);
  const primaryType = item.placeType?.trim() || null;
  const types = primaryType ? [primaryType] : null;

  return {
    id,
    name,
    address: item.address ?? null,
    lat: item.lat,
    lng: item.lng,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType,
    types,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

export function itineraryItemToPlaceHandoff(
  item: RoamieItineraryItem,
  locale: Locale = "zh-TW",
): PlaceDetailHandoff {
  const googlePlaceId = item.googlePlaceId?.trim() ?? "";
  const resolvedGooglePlaceId = isGooglePlaceId(googlePlaceId) ? googlePlaceId : "";
  const place = itineraryItemToPlaceResult(item, resolvedGooglePlaceId);
  const reason = buildPlaceRecommendationReason(
    place,
    null,
    null,
    undefined,
    undefined,
    locale,
  );
  const categoryId = inferExploreCategoryId(place);
  const snapshot: HomeNearbyPick = {
    ...place,
    reason,
    categoryId,
    displayCategory: resolvePlaceDisplayCategory(place),
  };

  return {
    placeId: resolvedGooglePlaceId || place.id,
    googlePlaceId: resolvedGooglePlaceId || undefined,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    category: place.primaryType,
    categoryId,
    reason,
    snapshot: {
      ...snapshot,
      id: resolvedGooglePlaceId || place.id,
    },
  };
}

export function openTripItineraryPlaceDetail(
  item: RoamieItineraryItem,
  viewState: TripDetailViewState,
  locale: Locale = "zh-TW",
  opts?: {
    /** Previous stop on the same day — used for distance/transport (not device GPS). */
    previousItem?: RoamieItineraryItem | null;
  },
): { handoff: PlaceDetailHandoff; navigateOptions: NavigateOptions } {
  saveTripDetailViewState(viewState);
  persistTripDetailSelectedDay(viewState.tripId, viewState.activeDayIndex);
  const handoff = itineraryItemToPlaceHandoff(item, locale);
  const previous = opts?.previousItem;
  const originLat = previous?.lat ?? item.lat ?? undefined;
  const originLng = previous?.lng ?? item.lng ?? undefined;
  if (
    previous?.lat != null &&
    previous?.lng != null &&
    item.lat != null &&
    item.lng != null
  ) {
    const place = itineraryItemToPlaceResult(
      item,
      handoff.googlePlaceId?.trim() || "",
    );
    const distM = distanceMeters(
      { lat: previous.lat, lng: previous.lng },
      { lat: item.lat, lng: item.lng },
    );
    handoff.reason = buildPlaceRecommendationReason(
      place,
      null,
      null,
      undefined,
      { distanceMeters: distM },
      locale,
    );
  }
  setPlaceDetailHandoff(handoff);
  const placeId = handoff.googlePlaceId || handoff.placeId || item.googlePlaceId || "";
  console.info(
    `[PLACE_DETAIL_OPEN_FROM_TRIP] tripId=${viewState.tripId} dayIndex=${viewState.activeDayIndex} placeId=${placeId}`,
  );

  return {
    handoff,
    navigateOptions: {
      to: "/place",
      search: {
        placeId: handoff.googlePlaceId || handoff.placeId || undefined,
        lat: item.lat ?? undefined,
        lng: item.lng ?? undefined,
        returnTo: "trip",
        tripId: viewState.tripId,
        day: viewState.activeDayIndex + 1,
        originLat,
        originLng,
      },
    },
  };
}
