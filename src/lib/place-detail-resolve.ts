import type { PlaceDetailData } from "@/components/map/PlaceDetailSheet";
import type { PlacePhotoSource } from "@/lib/place/place-detail-logs";
import { isGenericPlaceReason } from "@/lib/place/place-intro-constants";
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

function resolveHandoffReason(
  snapReason?: string | null,
  handoffReason?: string | null,
): string {
  for (const candidate of [snapReason, handoffReason]) {
    const t = candidate?.trim();
    if (t && !isGenericPlaceReason(t)) return t;
  }
  return "";
}

export type PlaceDetailViewModel = PlaceDetailData & {
  coverImageUrl?: string;
  website?: string | null;
  phone?: string | null;
  googleMapsUri?: string | null;
  photoNames?: string[];
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

function emptyOpeningFields() {
  return {
    businessStatus: null as string | null,
    openStatus: "unknown" as const,
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    hoursFromGoogleDetails: false,
  };
}

export function handoffToPlaceDetailData(handoff: PlaceDetailHandoff): PlaceDetailViewModel {
  const omitCardHours = canFetchGooglePlaceDetails(handoff.placeId);
  const snap = handoff.snapshot;
  if (snap) {
    const opening = omitCardHours ? emptyOpeningFields() : {
      businessStatus: snap.businessStatus ?? null,
      openStatus: snap.openStatus ?? ("unknown" as const),
      openStatusLabel: snap.openStatusLabel ?? "",
      todayHoursLabel: snap.todayHoursLabel ?? "",
      closingSoonNote: snap.closingSoonNote ?? "",
      nextOpenHint: snap.nextOpenHint ?? "",
      hoursFromGoogleDetails: false,
    };
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
      ...opening,
      coverImageUrl: snap.coverImageUrl ?? handoff.photoUrl ?? undefined,
      reason: resolveHandoffReason(snap.reason, handoff.reason),
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
    ...emptyOpeningFields(),
    reason: resolveHandoffReason(undefined, handoff.reason),
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
  return buildPlaceImageUrlsWithSource(place).urls;
}

export function buildPlaceImageUrlsWithSource(
  place: PlaceDetailViewModel,
  handoff?: { photoUrl?: string | null },
): { urls: string[]; source: PlacePhotoSource; hasGooglePhoto: boolean } {
  const googleUrl = place.photoName ? buildPlacePhotoUrl(place.photoName, 800) : null;
  const googlePhotos = (place.photoNames ?? [])
    .map((name) => buildPlacePhotoUrl(name, 800))
    .filter((u): u is string => Boolean(u));

  if (googleUrl || googlePhotos.length > 0) {
    const urls = googlePhotos.length > 0 ? googlePhotos : googleUrl ? [googleUrl] : [];
    return { urls, source: "google_places", hasGooglePhoto: true };
  }

  const itineraryUrl = handoff?.photoUrl?.trim() || place.coverImageUrl?.trim();
  if (itineraryUrl && !itineraryUrl.includes("unsplash")) {
    return { urls: [itineraryUrl], source: "itinerary", hasGooglePhoto: false };
  }
  if (itineraryUrl) {
    return { urls: [itineraryUrl], source: "unsplash", hasGooglePhoto: false };
  }

  return { urls: [], source: "fallback", hasGooglePhoto: false };
}

/** Google Details 優先，不讓 itinerary / fallback 蓋掉 Google 欄位 */
export function mergeGooglePlaceIntoDetail(
  itineraryBase: PlaceDetailViewModel,
  fetched: PlaceDetailsScreenResult,
  handoff?: { photoUrl?: string | null },
): PlaceDetailViewModel {
  const googlePhoto = fetched.photoName ?? fetched.photoNames?.[0] ?? null;
  const googlePhotoUrl = googlePhoto ? buildPlacePhotoUrl(googlePhoto, 800) : null;

  return {
    ...itineraryBase,
    id: fetched.id || itineraryBase.id,
    name: fetched.name || itineraryBase.name,
    address: fetched.address ?? itineraryBase.address,
    lat: fetched.lat ?? itineraryBase.lat,
    lng: fetched.lng ?? itineraryBase.lng,
    rating: fetched.rating ?? itineraryBase.rating,
    userRatingCount: fetched.userRatingCount ?? itineraryBase.userRatingCount,
    primaryType: fetched.primaryType ?? itineraryBase.primaryType,
    types: fetched.types ?? itineraryBase.types,
    businessStatus: fetched.businessStatus ?? itineraryBase.businessStatus,
    openStatus: fetched.openStatus,
    openStatusLabel: fetched.openStatusLabel,
    todayHoursLabel: fetched.todayHoursLabel,
    closesAtLabel: fetched.closesAtLabel,
    closingSoonNote: fetched.closingSoonNote,
    nextOpenHint: fetched.nextOpenHint,
    hoursFromGoogleDetails: true,
    website: fetched.website ?? itineraryBase.website,
    phone: fetched.phone ?? itineraryBase.phone,
    googleMapsUri: fetched.googleMapsUri ?? itineraryBase.googleMapsUri,
    photoName: googlePhoto ?? itineraryBase.photoName,
    photoNames: fetched.photoNames ?? itineraryBase.photoNames,
    coverImageUrl: googlePhotoUrl ?? handoff?.photoUrl ?? itineraryBase.coverImageUrl,
    reason: itineraryBase.reason,
  };
}

/** @deprecated 使用 mergeGooglePlaceIntoDetail */
export function mergeFetchedPlace(
  base: PlaceDetailViewModel,
  fetched: PlaceDetailsScreenResult,
): PlaceDetailViewModel {
  return mergeGooglePlaceIntoDetail(base, fetched);
}
