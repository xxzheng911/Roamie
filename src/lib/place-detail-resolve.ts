import type { PlaceDetailData } from "@/components/map/PlaceDetailSheet";
import {
  type PlaceDetailHandoff,
  isGooglePlaceId,
  latLngFallbackPlaceId,
} from "@/lib/place-detail-handoff";
import { peekPlaceDetailHandoff } from "@/lib/place-detail-handoff";
import { peekPlaceDetailStore } from "@/lib/place-detail-store";
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

function decodeRoutePlaceId(routePlaceId?: string): string {
  if (!routePlaceId?.trim()) return "";
  try {
    return decodeURIComponent(routePlaceId).trim();
  } catch {
    return routePlaceId.trim();
  }
}

function handoffMatchesRoute(handoff: PlaceDetailHandoff, resolvedId: string): boolean {
  if (!resolvedId) return true;
  const hid = handoff.placeId?.trim() ?? "";
  if (!hid) return true;
  if (hid === resolvedId) return true;
  try {
    return decodeURIComponent(hid) === resolvedId;
  } catch {
    return false;
  }
}

/** 依 route placeId 還原 handoff（session handoff / place store / 最小 stub） */
export function resolvePlaceDetailHandoff(
  routePlaceId: string | undefined,
  search: PlaceDetailSearch,
  consumed: PlaceDetailHandoff | null,
): PlaceDetailHandoff | null {
  const paramId = decodeRoutePlaceId(routePlaceId);
  const searchId = search.placeId?.trim() ?? "";
  const resolvedId = paramId || searchId;
  if (!resolvedId) {
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

  const candidates: PlaceDetailHandoff[] = [];
  if (consumed?.name) candidates.push(consumed);
  const peeked = peekPlaceDetailHandoff();
  if (peeked?.name) candidates.push(peeked);
  const stored = peekPlaceDetailStore(resolvedId);
  if (stored) candidates.push(stored);
  if (resolvedId.startsWith("saved-")) {
    const legacy = peekPlaceDetailStore(`temp:${resolvedId}`);
    if (legacy) candidates.push(legacy);
  }
  if (resolvedId.startsWith("temp:saved-")) {
    const withoutTemp = resolvedId.replace(/^temp:/, "");
    const modern = peekPlaceDetailStore(withoutTemp);
    if (modern) candidates.push(modern);
  }

  for (const c of candidates) {
    if (!c.name) continue;
    if (handoffMatchesRoute(c, resolvedId)) {
      return { ...c, placeId: resolvedId };
    }
  }

  if (peeked?.name) {
    return { ...peeked, placeId: resolvedId };
  }

  return {
    placeId: resolvedId,
    name: "地點",
    address: null,
    lat: search.lat ?? null,
    lng: search.lng ?? null,
  };
}

export function handoffToPlaceDetailData(handoff: PlaceDetailHandoff): PlaceDetailViewModel {
  const snap = handoff.snapshot;
  if (snap) {
    return {
      id: snap.id || handoff.placeId,
      name: snap.name || handoff.name,
      address: snap.address ?? handoff.address,
      lat: snap.lat ?? handoff.lat,
      lng: snap.lng ?? handoff.lng,
      rating: snap.rating ?? handoff.rating ?? null,
      userRatingCount: snap.userRatingCount ?? handoff.userRatingCount ?? null,
      photoName: snap.photoName ?? handoff.photoName ?? null,
      primaryType: snap.primaryType ?? handoff.category ?? null,
      types: snap.types ?? (handoff.category ? [handoff.category] : null),
      businessStatus: snap.businessStatus ?? null,
      openStatus: snap.openStatus ?? "unknown",
      openStatusLabel: snap.openStatusLabel ?? "",
      todayHoursLabel: snap.todayHoursLabel ?? "",
      closingSoonNote: snap.closingSoonNote ?? "",
      nextOpenHint: snap.nextOpenHint ?? "",
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

export { shouldFetchRemotePlaceDetails } from "@/lib/place-detail-handoff";

export function buildPlaceImageUrls(place: PlaceDetailViewModel): string[] {
  const url =
    (place.photoName ? buildPlacePhotoUrl(place.photoName, 800) : null) ??
    place.coverImageUrl ??
    null;
  return url ? [url] : [];
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
    coverImageUrl: base.coverImageUrl ?? fetched.coverImageUrl ?? undefined,
    photoName: fetched.photoName ?? base.photoName,
  };
}
