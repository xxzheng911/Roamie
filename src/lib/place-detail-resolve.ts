import type { PlaceDetailData } from "@/components/map/PlaceDetailSheet";
import {
  type PlaceDetailHandoff,
  isGooglePlaceId,
  latLngFallbackPlaceId,
} from "@/lib/place-detail-handoff";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import {
  resolvePlaceOpeningDisplay,
} from "@/lib/normalized-opening-status";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import {
  cachePlaceImages,
  cachePlaceOpeningFromResult,
  readPlaceRuntimeCache,
} from "@/lib/place-runtime-cache";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import {
  resolvePlaceDisplayAddress,
  sanitizeGooglePlaceAddress,
} from "@/lib/place-display-address";

export type PlaceDetailSearch = {
  placeId?: string;
  lat?: number;
  lng?: number;
};

export type PlaceDetailViewModel = PlaceDetailData & {
  coverImageUrl?: string;
  website?: string | null;
  phone?: string | null;
  /** Google Places 多張照片 resource name（Details API） */
  photoNames?: string[];
};

export type PlaceImageSources = {
  id?: string;
  photoName?: string | null;
  photoNames?: string[] | null;
  coverImageUrl?: string | null;
  generatedImageUrl?: string | null;
  fallbackImageUrl?: string | null;
  categoryId?: string | null;
  primaryType?: string | null;
};

/** 從 Google photo URL 或 resource name 取出可去重的 reference */
export function extractGooglePhotoReference(urlOrName: string): string | null {
  const s = urlOrName.trim();
  if (!s) return null;
  if (s.startsWith("places/")) {
    return s.split("/media")[0] ?? s;
  }
  const fromPath = s.match(/\/(places\/[^/?]+)(?:\/media|$|\?)/);
  if (fromPath?.[1]) return fromPath[1];
  const fromQuery = s.match(/[?&]photo=([^&]+)/);
  if (fromQuery?.[1]) {
    try {
      return decodeURIComponent(fromQuery[1]).split("/media")[0] ?? null;
    } catch {
      return fromQuery[1].split("/media")[0] ?? null;
    }
  }
  return null;
}

function isGooglePlacePhotoSource(url: string): boolean {
  const s = url.trim();
  return (
    s.startsWith("places/") ||
    s.includes("places.googleapis.com") ||
    s.includes("/api/place-photo")
  );
}

/** 依 photo reference / 正規化 URL 去重 */
export function dedupePlaceImageUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url) continue;
    const ref = extractGooglePhotoReference(url);
    const key = (ref ?? url.split("?")[0] ?? url).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function buildPlaceImageUrls(place: PlaceImageSources): string[] {
  const cached = place.id ? readPlaceRuntimeCache(place.id) : null;
  const names = new Set<string>();
  for (const n of place.photoNames ?? []) {
    if (n?.trim()) names.add(n.trim());
  }
  if (place.photoName?.trim()) names.add(place.photoName.trim());

  const fromNames = [...names]
    .map((name) => buildPlacePhotoUrl(name, 800))
    .filter((u): u is string => Boolean(u));

  const generated =
    place.generatedImageUrl?.trim() ||
    place.fallbackImageUrl?.trim() ||
    cached?.generatedImageUrl?.trim() ||
    cached?.fallbackImageUrl?.trim() ||
    null;
  const cover =
    place.coverImageUrl?.trim() ||
    cached?.coverImageUrl?.trim() ||
    null;

  if (fromNames.length > 0) {
    return dedupePlaceImageUrls(fromNames);
  }
  if (cover) {
    return dedupePlaceImageUrls([cover]);
  }
  if (generated) {
    return dedupePlaceImageUrls([generated]);
  }
  return dedupePlaceImageUrls([
    getRoamieDefaultImage(place.categoryId ?? place.primaryType ?? undefined),
  ]);
}

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

function resolveHandoffAddress(
  handoff: PlaceDetailHandoff,
  snap?: PlaceDetailHandoff["snapshot"],
  locale: Locale = "zh-TW",
): string | null {
  const raw = snap?.address ?? handoff.address;
  const sanitized = raw ? sanitizeGooglePlaceAddress(raw, locale) : null;
  return resolvePlaceDisplayAddress(
    { address: sanitized },
    { hasCoords: (snap?.lat ?? handoff.lat) != null && (snap?.lng ?? handoff.lng) != null, locale },
  );
}

export function handoffToPlaceDetailData(
  handoff: PlaceDetailHandoff,
  locale: Locale = "zh-TW",
): PlaceDetailViewModel {
  const snap = handoff.snapshot;
  let place: PlaceDetailViewModel;
  if (snap) {
    place = {
      ...snap,
      address: resolveHandoffAddress(handoff, snap, locale),
      coverImageUrl:
        snap.coverImageUrl ??
        handoff.photoUrl ??
        handoff.generatedImageUrl ??
        handoff.fallbackImageUrl ??
        undefined,
      generatedImageUrl:
        snap.generatedImageUrl ??
        handoff.generatedImageUrl ??
        handoff.fallbackImageUrl ??
        null,
      fallbackImageUrl:
        snap.fallbackImageUrl ??
        handoff.fallbackImageUrl ??
        handoff.generatedImageUrl ??
        null,
      openNow: snap.openNow ?? handoff.openNow ?? null,
      normalizedOpeningStatus:
        snap.normalizedOpeningStatus ?? handoff.normalizedOpeningStatus,
      reason: snap.reason?.trim() || handoff.reason?.trim() || "適合現在去走走",
      website: null,
      phone: null,
    };
  } else {
    place = {
      id: handoff.placeId,
      name: handoff.name,
      address: resolveHandoffAddress(handoff, undefined, locale),
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
      openNow: handoff.openNow ?? null,
      normalizedOpeningStatus: handoff.normalizedOpeningStatus,
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
      reason: handoff.reason?.trim() || "適合現在去走走",
      coverImageUrl:
        handoff.photoUrl ?? handoff.generatedImageUrl ?? handoff.fallbackImageUrl ?? undefined,
      generatedImageUrl: handoff.generatedImageUrl ?? handoff.fallbackImageUrl ?? null,
      fallbackImageUrl: handoff.fallbackImageUrl ?? handoff.generatedImageUrl ?? null,
      website: null,
      phone: null,
    };
  }

  const opening = resolvePlaceOpeningDisplay(place);
  return {
    ...place,
    normalizedOpeningLabel: opening.label,
    openStatusLabel: opening.label,
    todayHoursLabel: opening.hoursLine ?? place.todayHoursLabel,
    closingSoonNote: opening.closingSoonNote ?? "",
    nextOpenHint: opening.nextOpenHint ?? "",
  };
}

export function canFetchGooglePlaceDetails(placeId: string): boolean {
  return isGooglePlaceId(placeId);
}

export function mergeFetchedPlace(
  base: PlaceDetailViewModel,
  fetched: PlaceDetailsScreenResult,
  locale: Locale = "zh-TW",
): PlaceDetailViewModel {
  const hasCoords =
    (fetched.lat ?? base.lat) != null && (fetched.lng ?? base.lng) != null;
  const resolvedAddress = resolvePlaceDisplayAddress(
    {
      formattedAddress: fetched.googleFormattedAddress,
      shortFormattedAddress: fetched.googleShortFormattedAddress,
      vicinity: fetched.googleVicinity,
    },
    { hasCoords, locale, googleFieldsOnly: true },
  );

  const googleCover = fetched.photoName
    ? (buildPlacePhotoUrl(fetched.photoName, 800) ?? null)
    : null;
  const coverImageUrl =
    googleCover ??
    base.coverImageUrl ??
    base.generatedImageUrl ??
    base.fallbackImageUrl ??
    null;
  const generatedImageUrl = base.generatedImageUrl ?? base.fallbackImageUrl ?? null;
  const merged: PlaceDetailViewModel = {
    ...base,
    ...fetched,
    id: fetched.id || base.id,
    name: fetched.name || base.name,
    address: resolvedAddress,
    lat: fetched.lat ?? base.lat,
    lng: fetched.lng ?? base.lng,
    reason: base.reason,
    website: fetched.website,
    phone: fetched.phone,
    coverImageUrl: coverImageUrl ?? undefined,
    generatedImageUrl,
    fallbackImageUrl: generatedImageUrl,
    photoNames: fetched.photoNames ?? base.photoNames,
    openNow: fetched.openNow ?? base.openNow ?? null,
    normalizedOpeningStatus:
      fetched.normalizedOpeningStatus ?? base.normalizedOpeningStatus,
    normalizedOpeningSource:
      fetched.normalizedOpeningSource ?? base.normalizedOpeningSource,
  };

  const opening = resolvePlaceOpeningDisplay(merged);
  const finalized: PlaceDetailViewModel = {
    ...merged,
    normalizedOpeningLabel: opening.label,
    openStatusLabel: opening.label,
    openStatus:
      merged.openNow === true
        ? "open"
        : merged.openNow === false
          ? "closed_now"
          : merged.openStatus,
    todayHoursLabel: opening.hoursLine ?? merged.todayHoursLabel,
    closingSoonNote: opening.closingSoonNote ?? "",
    nextOpenHint: opening.nextOpenHint ?? "",
  };

  if (isGooglePlaceId(finalized.id)) {
    cachePlaceOpeningFromResult(finalized);
    cachePlaceImages(finalized.id, {
      coverImageUrl: coverImageUrl,
      generatedImageUrl,
      fallbackImageUrl: generatedImageUrl,
    });
  }

  return finalized;
}
