import type { PlaceDetailData } from "@/components/map/PlaceDetailSheet";
import {
  type PlaceDetailHandoff,
  isGooglePlaceId,
  latLngFallbackPlaceId,
} from "@/lib/place-detail-handoff";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";

export type PlaceDetailSearch = {
  placeId?: string;
  lat?: number;
  lng?: number;
};

export type PlaceDetailViewModel = PlaceDetailData & {
  coverImageUrl?: string;
  website?: string | null;
  phone?: string | null;
};

export function resolvePlaceDetailHandoff(
  search: PlaceDetailSearch,
  consumed: PlaceDetailHandoff | null,
): PlaceDetailHandoff | null {
  if (consumed) {
    const placeId =
      consumed.placeId?.trim() ||
      search.placeId?.trim() ||
      (consumed.lat != null && consumed.lng != null
        ? latLngFallbackPlaceId(consumed.lat, consumed.lng)
        : search.lat != null && search.lng != null
          ? latLngFallbackPlaceId(search.lat, search.lng)
          : "");
    return { ...consumed, placeId };
  }

  if (search.placeId?.trim()) {
    return {
      placeId: search.placeId.trim(),
      name: "地點",
      address: null,
      lat: search.lat ?? null,
      lng: search.lng ?? null,
    };
  }

  if (search.lat != null && search.lng != null) {
    return {
      placeId: latLngFallbackPlaceId(search.lat, search.lng),
      name: "地點",
      address: null,
      lat: search.lat,
      lng: search.lng,
    };
  }

  return null;
}

export function handoffToPlaceDetailData(handoff: PlaceDetailHandoff): PlaceDetailViewModel {
  const snap = handoff.snapshot;
  if (snap) {
    return {
      ...snap,
      coverImageUrl: snap.coverImageUrl ?? handoff.photoUrl ?? undefined,
      reason: snap.reason?.trim() || handoff.reason?.trim() || "適合現在去走走",
      website: null,
      phone: null,
    };
  }
  return {
    id: handoff.placeId,
    name: handoff.name,
    address: handoff.address,
    lat: handoff.lat,
    lng: handoff.lng,
    rating: handoff.rating ?? null,
    userRatingCount: handoff.userRatingCount ?? null,
    photoName: handoff.photoName ?? null,
    primaryType: handoff.category ?? null,
    types: handoff.category ? [handoff.category] : null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    reason: handoff.reason?.trim() || "適合現在去走走",
    coverImageUrl: handoff.photoUrl ?? undefined,
    website: null,
    phone: null,
  };
}

export function canFetchGooglePlaceDetails(placeId: string): boolean {
  return isGooglePlaceId(placeId);
}

export function buildPlaceImageUrls(place: PlaceDetailViewModel): string[] {
  const fromPhoto = place.photoName ? buildPlacePhotoUrl(place.photoName, 800) : null;
  const urls = [fromPhoto, place.coverImageUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  return [...new Set(urls)];
}

export function mergeFetchedPlace(
  base: PlaceDetailViewModel,
  fetched: PlaceDetailsScreenResult,
): PlaceDetailViewModel {
  return {
    ...base,
    ...fetched,
    id: fetched.id || base.id,
    name: fetched.name || base.name,
    address: fetched.address ?? base.address,
    lat: fetched.lat ?? base.lat,
    lng: fetched.lng ?? base.lng,
    reason: base.reason,
    website: fetched.website,
    phone: fetched.phone,
    coverImageUrl: base.coverImageUrl,
  };
}
