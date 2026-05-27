import type { HomeNearbyPick } from "@/lib/explore-category-search";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";

const HANDOFF_KEY = "roamie:place-detail-handoff";

export type PlaceDetailHandoff = {
  placeId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  photoUrl?: string | null;
  photoName?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  category?: string | null;
  categoryId?: string;
  reason?: string;
  snapshot?: HomeNearbyPick;
};

export function latLngFallbackPlaceId(lat: number, lng: number): string {
  return `latlng:${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function isGooglePlaceId(placeId: string): boolean {
  if (!placeId.trim()) return false;
  if (placeId.startsWith("latlng:")) return false;
  if (placeId.startsWith("saved-")) return false;
  return true;
}

export function pickToPlaceDetailHandoff(pick: HomeNearbyPick): PlaceDetailHandoff {
  const placeId =
    pick.id?.trim() ||
    (pick.lat != null && pick.lng != null ? latLngFallbackPlaceId(pick.lat, pick.lng) : "");

  const photoUrl =
    pick.coverImageUrl ??
    (pick.photoName ? (buildPlacePhotoUrl(pick.photoName, 800) ?? null) : null);

  return {
    placeId,
    name: pick.name,
    address: pick.address,
    lat: pick.lat,
    lng: pick.lng,
    photoUrl,
    photoName: pick.photoName,
    rating: pick.rating,
    userRatingCount: pick.userRatingCount,
    category: pick.displayCategory ?? pick.primaryType ?? null,
    categoryId: pick.categoryId,
    reason: pick.reason,
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
