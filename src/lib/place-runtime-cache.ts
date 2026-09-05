import type { NormalizedOpeningStatusValue } from "@/lib/normalized-opening-status";
import type { PlaceOpenStatus } from "@/lib/filter-available-places";

export type PlaceRuntimeCacheEntry = {
  businessStatus?: string | null;
  openNow?: boolean | null;
  normalizedOpeningStatus?: NormalizedOpeningStatusValue;
  normalizedOpeningLabel?: string;
  normalizedOpeningSource?: import("@/lib/normalized-opening-status").NormalizedOpeningSource;
  openStatus?: PlaceOpenStatus;
  openStatusLabel?: string;
  todayHoursLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
  coverImageUrl?: string | null;
  generatedImageUrl?: string | null;
  fallbackImageUrl?: string | null;
  photoName?: string | null;
  photoNames?: string[] | null;
  at: number;
};

const CACHE = new Map<string, PlaceRuntimeCacheEntry>();
const TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 120;

export const PLACE_RUNTIME_CACHE_UPDATED = "roamie:place-runtime-cache-updated";

function trimCache(): void {
  if (CACHE.size <= MAX_ENTRIES) return;
  const oldest = [...CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
  if (oldest) CACHE.delete(oldest);
}

export function readPlaceRuntimeCache(placeId: string): PlaceRuntimeCacheEntry | null {
  const id = placeId.trim();
  if (!id) return null;
  const hit = CACHE.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    CACHE.delete(id);
    return null;
  }
  return hit;
}

export function writePlaceRuntimeCache(
  placeId: string,
  patch: Omit<Partial<PlaceRuntimeCacheEntry>, "at">,
): void {
  const id = placeId.trim();
  if (!id) return;
  const prev = readPlaceRuntimeCache(id);
  trimCache();
  CACHE.set(id, {
    ...prev,
    ...patch,
    at: Date.now(),
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PLACE_RUNTIME_CACHE_UPDATED, { detail: { placeId: id } }));
  }
}

export function mergePlaceRuntimeCache<T extends Record<string, unknown>>(
  placeId: string | null | undefined,
  place: T,
): T {
  const id = placeId?.trim();
  if (!id) return place;
  const cached = readPlaceRuntimeCache(id);
  if (!cached) return place;
  return {
    ...place,
    ...(cached.businessStatus !== undefined ? { businessStatus: cached.businessStatus } : {}),
    ...(cached.openNow !== undefined ? { openNow: cached.openNow } : {}),
    ...(cached.normalizedOpeningStatus
      ? { normalizedOpeningStatus: cached.normalizedOpeningStatus }
      : {}),
    ...(cached.normalizedOpeningLabel
      ? { normalizedOpeningLabel: cached.normalizedOpeningLabel }
      : {}),
    ...(cached.normalizedOpeningSource
      ? { normalizedOpeningSource: cached.normalizedOpeningSource }
      : {}),
    ...(cached.openStatus ? { openStatus: cached.openStatus } : {}),
    ...(cached.openStatusLabel ? { openStatusLabel: cached.openStatusLabel } : {}),
    ...(cached.todayHoursLabel ? { todayHoursLabel: cached.todayHoursLabel } : {}),
    ...(cached.closingSoonNote ? { closingSoonNote: cached.closingSoonNote } : {}),
    ...(cached.nextOpenHint ? { nextOpenHint: cached.nextOpenHint } : {}),
    ...(cached.coverImageUrl ? { coverImageUrl: cached.coverImageUrl } : {}),
    ...(cached.generatedImageUrl ? { generatedImageUrl: cached.generatedImageUrl } : {}),
    ...(cached.fallbackImageUrl ? { fallbackImageUrl: cached.fallbackImageUrl } : {}),
    ...(cached.photoName ? { photoName: cached.photoName } : {}),
    ...(cached.photoNames ? { photoNames: cached.photoNames } : {}),
  };
}

export function cachePlaceImages(
  placeId: string,
  images: {
    coverImageUrl?: string | null;
    generatedImageUrl?: string | null;
    fallbackImageUrl?: string | null;
  },
): void {
  writePlaceRuntimeCache(placeId, images);
}

export function cachePlaceOpeningFromResult(
  place: {
    id?: string | null;
    businessStatus?: string | null;
    openNow?: boolean | null;
    normalizedOpeningStatus?: NormalizedOpeningStatusValue;
    normalizedOpeningLabel?: string;
    normalizedOpeningSource?: import("@/lib/normalized-opening-status").NormalizedOpeningSource;
    openStatus?: PlaceOpenStatus;
    openStatusLabel?: string;
    todayHoursLabel?: string;
    closingSoonNote?: string;
    nextOpenHint?: string;
  },
): void {
  const id = place.id?.trim();
  if (!id) return;
  writePlaceRuntimeCache(id, {
    businessStatus: place.businessStatus,
    openNow: place.openNow,
    normalizedOpeningStatus: place.normalizedOpeningStatus,
    normalizedOpeningLabel: place.normalizedOpeningLabel,
    normalizedOpeningSource: place.normalizedOpeningSource,
    openStatus: place.openStatus,
    openStatusLabel: place.normalizedOpeningLabel ?? place.openStatusLabel,
    todayHoursLabel: place.todayHoursLabel,
    closingSoonNote: place.closingSoonNote,
    nextOpenHint: place.nextOpenHint,
  });
}
