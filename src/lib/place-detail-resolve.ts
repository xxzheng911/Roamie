import type { PlaceDetailData } from "@/components/map/PlaceDetailSheet";
import {
  type PlaceDetailHandoff,
  isGooglePlaceId,
  latLngFallbackPlaceId,
} from "@/lib/place-detail-handoff";
import { buildPlaceRecommendationReason } from "@/lib/build-place-recommendation-reason";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { preferJpegPngImageUrl, sanitizePlaceImageUrl } from "@/lib/safe-image-url";
import type { Locale } from "@/lib/i18n/types";
import {
  resolvePlaceOpeningDisplay,
} from "@/lib/normalized-opening-status";
import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import type { PlaceDetailBoundaryTelemetry } from "@/lib/place-detail-failure-telemetry";
import type { PlaceResult } from "@/lib/place-result";
import {
  cachePlaceImages,
  cachePlaceOpeningFromResult,
  readPlaceRuntimeCache,
} from "@/lib/place-runtime-cache";
import { searchPlaces } from "@/services/placesService";
import {
  buildUnifiedPlaceDetailsCacheKey,
  readUnifiedPlaceDetailsCache,
  writeUnifiedPlaceDetailsCache,
  isPlaceDetailsCacheComplete,
} from "@/lib/unified-place-cache";
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
    const url = preferJpegPngImageUrl(raw?.trim());
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

  const cover =
    place.coverImageUrl?.trim() ||
    cached?.coverImageUrl?.trim() ||
    null;

  if (fromNames.length > 0) {
    return dedupePlaceImageUrls(fromNames);
  }
  // Place detail: never fall back to generic cafe / scene / Unsplash images when Google photo is missing.
  if (cover && !/scene-cafe|unsplash\.com/i.test(cover)) {
    return dedupePlaceImageUrls([sanitizePlaceImageUrl(cover, { maxWidth: 800 })]);
  }
  return [];
}

export function resolvePlaceDetailHandoff(
  search: PlaceDetailSearch,
  consumed: PlaceDetailHandoff | null,
): PlaceDetailHandoff | null {
  if (consumed) {
    const googleId = consumed.googlePlaceId?.trim();
    const explicitGoogleId =
      googleId && isGooglePlaceId(googleId)
        ? googleId
        : consumed.placeId?.trim() && isGooglePlaceId(consumed.placeId.trim())
          ? consumed.placeId.trim()
          : "";
    const placeId =
      explicitGoogleId ||
      consumed.placeId?.trim() ||
      search.placeId?.trim() ||
      (consumed.lat != null && consumed.lng != null
        ? latLngFallbackPlaceId(consumed.lat, consumed.lng)
        : search.lat != null && search.lng != null
          ? latLngFallbackPlaceId(search.lat, search.lng)
          : "");
    return { ...consumed, placeId, googlePlaceId: explicitGoogleId || consumed.googlePlaceId };
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

const GENERIC_DETAIL_REASONS = new Set([
  "適合現在去走走",
  "Good for right now",
  "今行くのに合いそう",
  "지금 가기 좋아요",
]);

function handoffToPlaceResult(
  handoff: PlaceDetailHandoff,
  snap?: PlaceDetailHandoff["snapshot"],
): PlaceResult {
  if (snap) {
    return {
      ...snap,
      id: snap.id || handoff.placeId,
      name: snap.name || handoff.name,
      address: snap.address ?? handoff.address,
      lat: snap.lat ?? handoff.lat,
      lng: snap.lng ?? handoff.lng,
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
    openStatusLabel: handoff.openStatusLabel ?? handoff.normalizedOpeningLabel ?? "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

export function resolvePlaceDetailReason(
  handoff: PlaceDetailHandoff,
  locale: Locale = "zh-TW",
  snap?: PlaceDetailHandoff["snapshot"],
): string {
  const explicit = snap?.reason?.trim() || handoff.reason?.trim();
  if (explicit && !GENERIC_DETAIL_REASONS.has(explicit)) {
    return explicit;
  }
  return buildPlaceRecommendationReason(
    handoffToPlaceResult(handoff, snap),
    null,
    null,
    undefined,
    undefined,
    locale,
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
      reason: resolvePlaceDetailReason(handoff, locale, snap),
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
      reason: resolvePlaceDetailReason(handoff, locale),
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

/** 無有效 placeId 時，以名稱 + 地址 (+ 座標 bias) 查 Autocomplete 補回 Google placeId */
export async function resolveGooglePlaceIdForDetail(
  handoff: PlaceDetailHandoff,
  locale: Locale = "zh-TW",
): Promise<string | null> {
  const direct = handoff.googlePlaceId?.trim() || handoff.placeId?.trim() || "";
  if (direct && isGooglePlaceId(direct)) return direct;

  const name = handoff.name?.trim();
  if (!name) return null;

  const center =
    handoff.lat != null && handoff.lng != null
      ? { lat: handoff.lat, lng: handoff.lng }
      : undefined;

  const queries = [
    handoff.address?.trim() ? `${name} ${handoff.address.trim()}` : null,
    name,
  ].filter((q): q is string => Boolean(q?.trim()));

  for (const query of queries) {
    try {
      const { suggestions } = await searchPlaces(query, { locale, center });
      if (!suggestions.length) continue;

      const normalizedName = name.toLowerCase();
      const scored = suggestions
        .map((s) => {
          const label = s.label.trim();
          const labelLower = label.toLowerCase();
          let score = 0;
          if (labelLower === normalizedName) score += 100;
          if (label.includes(name) || name.includes(label)) score += 40;
          if (handoff.address?.trim() && s.secondary?.includes(handoff.address.trim())) {
            score += 30;
          }
          return { suggestion: s, score };
        })
        .sort((a, b) => b.score - a.score);

      for (const { suggestion } of scored) {
        const placeId = suggestion.placeId?.trim();
        if (!placeId || !isGooglePlaceId(placeId)) continue;
        console.info("[PLACE_DETAIL] resolved placeId", placeId, "query=", query);
        return placeId;
      }
    } catch (e) {
      console.warn("[PLACE_DETAIL] resolve placeId failed", query, e);
    }
  }

  return null;
}

export async function fetchGooglePlaceDetailsForHandoff(
  placeId: string,
  locale: Locale,
  fetchPlaceDetailsFn: (args: {
    data: { placeId: string; locale?: Locale };
  }) => Promise<{ place: PlaceDetailsScreenResult | null; error: string | null }>,
  fetchClientDetails?: (
    placeId: string,
    locale: Locale,
  ) => Promise<PlaceDetailsScreenResult | null>,
  cacheScope?: { cityLabel?: string; country?: string; lat?: number; lng?: number },
): Promise<{
  place: PlaceDetailsScreenResult | null;
  error: string | null;
  boundaryTelemetry?: PlaceDetailBoundaryTelemetry;
}> {
  const cacheKey = buildUnifiedPlaceDetailsCacheKey(placeId, locale, cacheScope);
  const cached = readUnifiedPlaceDetailsCache(cacheKey);
  if (cached?.place) {
    return { place: cached.place, error: null };
  }

  const server = await fetchPlaceDetailsFn({ data: { placeId, locale } });
  if (server.place) {
    if (isPlaceDetailsCacheComplete(server.place)) {
      writeUnifiedPlaceDetailsCache(cacheKey, server.place, null);
    }
    return server;
  }

  if (fetchClientDetails) {
    const clientPlace = await fetchClientDetails(placeId, locale);
    if (clientPlace) {
      console.info("[PLACE_DETAIL] client places details ok", placeId);
      writeUnifiedPlaceDetailsCache(cacheKey, clientPlace, null);
      return { place: clientPlace, error: null };
    }
  }

  const serverErrorPresent = typeof server.error === "string" && server.error.length > 0;
  return {
    ...server,
    boundaryTelemetry: {
      cacheHit: false,
      cachePlacePresent: false,
      cacheEnvelopeValid: false,
      serverAttempted: true,
      serverPlacePresent: false,
      serverErrorPresent,
      serverErrorCode: serverErrorPresent ? (server.error ?? "") : "",
      clientFallbackAttempted: Boolean(fetchClientDetails),
      clientPlacePresent: false,
      clientErrorPresent: false,
      clientErrorCode: "",
      firstNullErrorBoundary: serverErrorPresent
        ? fetchClientDetails
          ? "capacitor_client_null_result"
          : "none"
        : "server_result_null_error",
    },
  };
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
