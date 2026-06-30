import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { sanitizePlaceImageUrl } from "@/lib/safe-image-url";
import type { NormalizedOpeningStatusValue } from "@/lib/normalized-opening-status";
import {
  cachePlaceImages,
  cachePlaceOpeningFromResult,
  readPlaceRuntimeCache,
} from "@/lib/place-runtime-cache";

const HANDOFF_KEY = "roamie:place-detail-handoff";

export type PlaceDetailHandoff = {
  placeId: string;
  /** 真實 Google place id（行程 stop 可能另存） */
  googlePlaceId?: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl?: string | null;
  photoName?: string | null;
  generatedImageUrl?: string | null;
  fallbackImageUrl?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  category?: string | null;
  categoryId?: string;
  reason?: string;
  openNow?: boolean | null;
  normalizedOpeningStatus?: NormalizedOpeningStatusValue;
  normalizedOpeningLabel?: string;
  openStatusLabel?: string;
  snapshot?: HomeNearbyPick;
};

export function latLngFallbackPlaceId(lat: number, lng: number): string {
  return `latlng:${lat.toFixed(6)},${lng.toFixed(6)}`;
}

const SYNTHETIC_PLACE_ID_PREFIXES = ["latlng:", "saved-", "trip-", "mock-", "rec-"] as const;

export function isGooglePlaceId(placeId: string): boolean {
  const id = placeId.trim();
  if (!id) return false;
  if (SYNTHETIC_PLACE_ID_PREFIXES.some((prefix) => id.startsWith(prefix))) return false;
  return true;
}

export function pickToPlaceDetailHandoff(pick: HomeNearbyPick): PlaceDetailHandoff {
  const placeId =
    pick.id?.trim() ||
    (pick.lat != null && pick.lng != null ? latLngFallbackPlaceId(pick.lat, pick.lng) : "");

  const cached = isGooglePlaceId(placeId) ? readPlaceRuntimeCache(placeId) : null;
  const googlePhoto = pick.photoName
    ? sanitizePlaceImageUrl(buildPlacePhotoUrl(pick.photoName, 800), { maxWidth: 800 })
    : null;
  const generatedImageUrl =
    pick.generatedImageUrl ??
    pick.fallbackImageUrl ??
    cached?.generatedImageUrl ??
    cached?.fallbackImageUrl ??
    null;
  const photoUrl = sanitizePlaceImageUrl(
    googlePhoto ??
      pick.coverImageUrl ??
      cached?.coverImageUrl ??
      generatedImageUrl,
    { maxWidth: 800 },
  );

  if (isGooglePlaceId(placeId)) {
    cachePlaceImages(placeId, {
      coverImageUrl: photoUrl,
      generatedImageUrl,
      fallbackImageUrl: generatedImageUrl,
    });
    cachePlaceOpeningFromResult(pick);
  }

  return {
    placeId,
    name: pick.name,
    address: pick.address,
    lat: pick.lat,
    lng: pick.lng,
    photoUrl,
    photoName: pick.photoName,
    generatedImageUrl,
    fallbackImageUrl: generatedImageUrl,
    rating: pick.rating,
    userRatingCount: pick.userRatingCount,
    category: pick.displayCategory ?? pick.primaryType ?? null,
    categoryId: pick.categoryId,
    reason: pick.reason,
    openNow: pick.openNow ?? null,
    normalizedOpeningStatus: pick.normalizedOpeningStatus,
    normalizedOpeningLabel: pick.normalizedOpeningLabel ?? pick.openStatusLabel,
    openStatusLabel: pick.normalizedOpeningLabel ?? pick.openStatusLabel,
    snapshot: pick,
  };
}

export function setPlaceDetailHandoff(handoff: PlaceDetailHandoff): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch (e) {
    console.warn("[Roamie] setPlaceDetailHandoff failed", e);
  }
}

export function consumePlaceDetailHandoff(): PlaceDetailHandoff | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(raw) as PlaceDetailHandoff;
    if (!parsed?.name) return null;
    if (!parsed.placeId && parsed.lat == null && parsed.lng == null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function peekPlaceDetailHandoff(): PlaceDetailHandoff | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaceDetailHandoff;
    if (!parsed?.name) return null;
    return parsed;
  } catch {
    return null;
  }
}
