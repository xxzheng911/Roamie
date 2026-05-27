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

/** 可放進 /place/$placeId path 的 Google place id（排除地址、URL、假 id） */
export function isRoutableGooglePlaceId(placeId: string): boolean {
  const id = placeId.replace(/^places\//, "").trim();
  if (!id || id.length < 8) return false;
  if (/[/?#&\s\n]/.test(id)) return false;
  if (id.startsWith("latlng:")) return false;
  if (id.startsWith("saved-")) return false;
  if (id.startsWith("temp:")) return false;
  if (id.startsWith("rec-")) return false;
  if (/^https?:/i.test(id)) return false;
  if (!/[A-Za-z]/.test(id)) return false;
  return true;
}

export function isGooglePlaceId(placeId: string): boolean {
  return isRoutableGooglePlaceId(placeId);
}

/** 非 Google place id（收藏、暫存、座標 stub）— 不應打 Places Details API */
export function isSyntheticPlaceRouteId(placeId: string): boolean {
  const id = placeId.trim();
  if (!id) return true;
  if (id.startsWith("latlng:")) return true;
  if (id.startsWith("saved-")) return true;
  if (id.startsWith("temp:saved-")) return true;
  if (id.startsWith("temp:")) return true;
  if (id.startsWith("mock-")) return true;
  return false;
}

/** 遠端 Places Details：收藏一律用本地 handoff，避免 iOS 金鑰 403 */
export function shouldFetchRemotePlaceDetails(
  placeId: string,
  source?: string | null,
): boolean {
  if (source === "saved") return false;
  if (isSyntheticPlaceRouteId(placeId)) return false;
  return isGooglePlaceId(placeId);
}

export function extractGooglePlaceIdFromMapsUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  const patterns = [
    /[?&]query_place_id=([^&]+)/i,
    /[?&]place_id=([^&]+)/i,
    /\/place\/([^/?]+)/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    try {
      const id = decodeURIComponent(match[1].replace(/\+/g, " ")).trim();
      if (isRoutableGooglePlaceId(id)) return id.replace(/^places\//, "");
    } catch {
      /* ignore malformed segment */
    }
  }
  return null;
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
