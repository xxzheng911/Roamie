import { PLACES_CACHE_TTL_MS } from "@/lib/places-cache-config";
import type { Locale } from "@/lib/i18n/types";
import { createServerRequestCache } from "@/lib/server-request-cache";

const screenDetailsCache = createServerRequestCache(PLACES_CACHE_TTL_MS.placeDetails);
const introDetailsCache = createServerRequestCache(PLACES_CACHE_TTL_MS.placeDetails);

function normalizePlaceId(placeId: string): string {
  return placeId.replace(/^places\//, "").trim();
}

function detailsKey(placeId: string, locale: Locale | string): string {
  return `${locale}:${normalizePlaceId(placeId)}`;
}

export function getServerCachedPlaceDetailsScreen<T>(
  placeId: string,
  locale: Locale | string,
  fetcher: () => Promise<T>,
  shouldCache: (value: T) => boolean = (v) => v != null,
): Promise<T> {
  return screenDetailsCache.getOrFetch(detailsKey(placeId, locale), fetcher, shouldCache);
}

export function getServerCachedPlaceDetailsIntro<T>(
  placeId: string,
  locale: Locale | string,
  fetcher: () => Promise<T>,
  shouldCache: (value: T) => boolean = (v) => v != null,
): Promise<T> {
  return introDetailsCache.getOrFetch(detailsKey(placeId, locale), fetcher, shouldCache);
}
