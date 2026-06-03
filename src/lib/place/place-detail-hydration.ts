import type { PlaceDetailViewModel } from "@/lib/place-detail-resolve";
import {
  buildPlaceImageUrlsWithSource,
  handoffToPlaceDetailData,
  mergeGooglePlaceIntoDetail,
} from "@/lib/place-detail-resolve";
import type { PlaceDetailHandoff } from "@/lib/place-detail-handoff";
import { isGooglePlaceId } from "@/lib/place-detail-handoff";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import {
  logPlaceDetailGoogleDataFetchFailed,
  logPlaceDetailGoogleDataFetchStart,
  logPlaceDetailGoogleDataFetchSuccess,
  logPlaceDetailRenderData,
} from "@/lib/place/place-detail-logs";
import {
  resolveTripPlaceIdForDetail,
  type TripPlaceResolveInput,
} from "@/lib/place/resolve-trip-place-id";
import { logPlaceDetailHoursSource } from "@/lib/place/place-detail-hours";
import { resolvePlaceDetailHoursDisplay } from "@/lib/place/place-detail-hours";

export type PlaceDetailsFetcher = (placeId: string) => Promise<{
  place: PlaceDetailsScreenResult | null;
  error: string | null;
}>;

export type HydratePlaceDetailOptions = {
  handoff: PlaceDetailHandoff;
  source?: string | null;
  tripId?: string;
  destination?: string | null;
  city?: string | null;
  locale?: "zh-TW" | "en" | "ja" | "ko";
  fetchDetails: PlaceDetailsFetcher;
};

export type HydratePlaceDetailResult = {
  handoff: PlaceDetailHandoff;
  googlePlaceId: string | null;
  googleDetails: PlaceDetailsScreenResult | null;
  itineraryBase: PlaceDetailViewModel;
  merged: PlaceDetailViewModel | null;
  error: string | null;
};

export async function hydratePlaceDetailFromTrip(
  options: HydratePlaceDetailOptions,
): Promise<HydratePlaceDetailResult> {
  let handoff = options.handoff;
  let googlePlaceId = isGooglePlaceId(handoff.placeId) ? handoff.placeId : null;

  const item =
    handoff.itineraryItem ??
    ({
      date: "",
      time: "",
      title: handoff.name,
      placeName: handoff.name,
      address: handoff.address ?? undefined,
      lat: handoff.lat ?? undefined,
      lng: handoff.lng ?? undefined,
      googlePlaceId: isGooglePlaceId(handoff.placeId) ? handoff.placeId : undefined,
      placeType: handoff.category ?? undefined,
    } satisfies import("@/lib/ai/types").RoamieItineraryItem);

  if (
    options.source === "trip_detail" ||
    handoff.itineraryItem ||
    !googlePlaceId ||
    handoff.placeId.startsWith("trip-stop:") ||
    handoff.placeId.startsWith("latlng:")
  ) {
    const resolved = await resolveTripPlaceIdForDetail({
      item,
      destination: options.destination ?? handoff.itineraryContext?.destination,
      city: options.city ?? handoff.city ?? handoff.itineraryContext?.city,
      locale: options.locale,
    });
    if (resolved) {
      handoff = {
        ...resolved.handoff,
        itineraryContext: handoff.itineraryContext,
        routeContext: handoff.routeContext,
        tripId: handoff.tripId ?? options.tripId,
        photoUrl: handoff.photoUrl,
        reason: handoff.reason,
      };
      googlePlaceId = isGooglePlaceId(resolved.routePlaceId) ? resolved.routePlaceId : null;
    }
  }

  const itineraryBase = handoffToPlaceDetailData(handoff);

  if (!googlePlaceId) {
    return {
      handoff,
      googlePlaceId: null,
      googleDetails: null,
      itineraryBase,
      merged: null,
      error: "no_google_place_id",
    };
  }

  logPlaceDetailGoogleDataFetchStart({ placeId: googlePlaceId });
  const { place: fetched, error } = await options.fetchDetails(googlePlaceId);

  if (!fetched) {
    logPlaceDetailGoogleDataFetchFailed({
      placeName: handoff.name,
      placeId: googlePlaceId,
      error: error ?? "fetch_failed",
    });
    return {
      handoff,
      googlePlaceId,
      googleDetails: null,
      itineraryBase,
      merged: null,
      error: error ?? "fetch_failed",
    };
  }

  const hasPhotos = Boolean(fetched.photoName || (fetched.photoNames?.length ?? 0) > 0);
  const hasOpeningHours = Boolean(
    fetched.openStatus !== "unknown" ||
      fetched.todayHoursLabel?.trim() ||
      fetched.hoursData?.currentOpeningHours ||
      fetched.hoursData?.regularOpeningHours,
  );

  logPlaceDetailGoogleDataFetchSuccess({
    placeId: googlePlaceId,
    hasPhotos,
    hasOpeningHours,
    hasWebsite: Boolean(fetched.website?.trim()),
    hasPhone: Boolean(fetched.phone?.trim()),
    rating: fetched.rating,
  });

  const merged = mergeGooglePlaceIntoDetail(itineraryBase, fetched, handoff);

  const hours = resolvePlaceDetailHoursDisplay(merged, { fromGoogleDetails: true });
  logPlaceDetailHoursSource({
    placeName: merged.name,
    placeId: merged.id,
    source: hours.hoursSource,
    openNow: hours.openNow,
    todayHoursLabel: hours.hoursLabel || hours.statusLabel || "",
  });

  const photo = buildPlaceImageUrlsWithSource(merged, handoff);

  logPlaceDetailRenderData({
    placeName: merged.name,
    placeId: merged.id,
    hasGoogleData: true,
    hasPhoto: photo.urls.length > 0,
    hasHours: hours.hoursSource !== "none",
    hasWebsite: Boolean(merged.website?.trim()),
    hasPhone: Boolean(merged.phone?.trim()),
  });

  return {
    handoff: { ...handoff, placeId: googlePlaceId },
    googlePlaceId,
    googleDetails: fetched,
    itineraryBase,
    merged,
    error: null,
  };
}

export function buildTripResolveInputFromHandoff(
  handoff: PlaceDetailHandoff,
  overrides?: Partial<TripPlaceResolveInput>,
): TripPlaceResolveInput | null {
  const item = handoff.itineraryItem;
  if (!item) return null;
  return {
    item,
    destination: overrides?.destination ?? handoff.itineraryContext?.destination,
    city: overrides?.city ?? handoff.city ?? handoff.itineraryContext?.city,
    locale: overrides?.locale,
  };
}
