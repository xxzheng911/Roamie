import type { PlaceDetailsScreenResult } from "@/lib/places.functions";
import { PLACES_CACHE_TTL_MS } from "@/lib/places-cache-config";
import { createRequestCache } from "@/services/requestCache";

const screenDetailsCache = createRequestCache({
  prefix: "place-details-screen",
  ttlMs: PLACES_CACHE_TTL_MS.placeDetails,
  persist: true,
});

const introDetailsCache = createRequestCache({
  prefix: "place-details-intro",
  ttlMs: PLACES_CACHE_TTL_MS.placeDetails,
  persist: true,
});

function normalizePlaceId(placeId: string): string {
  return placeId.replace(/^places\//, "").trim();
}

export async function getCachedPlaceDetailsForScreen(
  placeId: string,
  locale: string,
  fetcher: () => Promise<PlaceDetailsScreenResult | null>,
): Promise<PlaceDetailsScreenResult | null> {
  const key = `${locale}:${normalizePlaceId(placeId)}`;
  return screenDetailsCache.getOrFetch(key, fetcher);
}

export type PlaceIntroDetails = {
  place: PlaceResult;
  editorialSummary: string | null;
  reviewSnippets: string[];
};

export async function getCachedPlaceDetailsForIntro(
  placeId: string,
  locale: string,
  fetcher: () => Promise<PlaceIntroDetails | null>,
): Promise<PlaceIntroDetails | null> {
  const key = `${locale}:${normalizePlaceId(placeId)}`;
  return introDetailsCache.getOrFetch(key, fetcher);
}
