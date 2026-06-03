import { resolveAppApiUrl } from "@/lib/api-base-url";
import {
  normalizeDestinationKey,
  extractPrimaryDestinationLabel,
} from "@/lib/destination/normalize-destination-key";
import {
  readLocalDestinationCover,
  writeLocalDestinationCover,
} from "@/lib/place-image/place-image-local-cache";
import { logDestCoverCache } from "@/lib/place-image/dest-cover-cache-log";
import { createRequestCache } from "@/services/requestCache";
import { API_CACHE_TTL_MS } from "@/lib/api/constants";

const destCoverCache = createRequestCache({
  prefix: "destination-cover",
  ttlMs: API_CACHE_TTL_MS.image,
  persist: true,
});

export type FetchDestinationCoverInput = {
  destination: string;
  city?: string | null;
  country?: string | null;
  mood?: string | null;
  moodTag?: string | null;
  title?: string | null;
};

type CoverFetchResult = {
  url: string | null;
  normalizedKey: string;
  destinationName: string;
  cacheHit: boolean;
  query?: string;
};

function persistUrlToLocalCache(normalizedKey: string, url: string | null): void {
  if (url?.trim()) writeLocalDestinationCover(normalizedKey, url.trim());
}

export async function fetchDestinationCover(
  input: FetchDestinationCoverInput,
): Promise<CoverFetchResult> {
  const destinationName = extractPrimaryDestinationLabel(input.destination);
  const normalizedKey = normalizeDestinationKey(destinationName);

  const local = readLocalDestinationCover(normalizedKey);
  if (local) {
    logDestCoverCache({
      normalizedKey,
      destinationName,
      layer: "local",
      cacheHit: true,
      url: local,
    });
    return { url: local, normalizedKey, destinationName, cacheHit: true };
  }

  type CachedPayload = CoverFetchResult;
  const sessionCached = destCoverCache.getCached<CachedPayload>(normalizedKey);
  if (sessionCached?.url) {
    persistUrlToLocalCache(normalizedKey, sessionCached.url);
    logDestCoverCache({
      normalizedKey,
      destinationName,
      layer: "session",
      cacheHit: true,
      url: sessionCached.url,
    });
    return { ...sessionCached, cacheHit: true };
  }

  const result = await destCoverCache.getOrFetch(normalizedKey, async () => {
    try {
      const res = await fetch(resolveAppApiUrl("/api/destination-cover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationName,
          normalizedDestinationKey: normalizedKey,
          city: input.city ?? null,
          country: input.country ?? null,
          mood: input.mood ?? null,
          moodTag: input.moodTag ?? null,
          title: input.title ?? null,
        }),
      });
      if (!res.ok) {
        logDestCoverCache({
          normalizedKey,
          destinationName,
          layer: "miss",
          cacheHit: false,
        });
        return { url: null, normalizedKey, destinationName, cacheHit: false };
      }
      const json = (await res.json()) as {
        url?: string;
        cacheHit?: boolean;
        normalizedDestinationKey?: string;
        query?: string;
      };
      const url = json.url?.trim() || null;
      const apiCacheHit = Boolean(json.cacheHit);
      logDestCoverCache({
        normalizedKey,
        destinationName,
        layer: apiCacheHit ? "supabase" : "unsplash",
        cacheHit: apiCacheHit,
        url,
      });
      return {
        url,
        normalizedKey: json.normalizedDestinationKey ?? normalizedKey,
        destinationName,
        cacheHit: apiCacheHit,
        query: json.query,
      };
    } catch {
      logDestCoverCache({
        normalizedKey,
        destinationName,
        layer: "miss",
        cacheHit: false,
      });
      return { url: null, normalizedKey, destinationName, cacheHit: false };
    }
  });

  persistUrlToLocalCache(normalizedKey, result.url);
  return result;
}
