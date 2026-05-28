import { resolveAppApiUrl } from "@/lib/api-base-url";
import {
  normalizeDestinationKey,
  extractPrimaryDestinationLabel,
} from "@/lib/destination/normalize-destination-key";
import {
  readLocalDestinationCover,
  writeLocalDestinationCover,
} from "@/lib/place-image/place-image-local-cache";
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

export async function fetchDestinationCover(
  input: FetchDestinationCoverInput,
): Promise<{
  url: string | null;
  normalizedKey: string;
  destinationName: string;
  cacheHit: boolean;
  query?: string;
}> {
  const destinationName = extractPrimaryDestinationLabel(input.destination);
  const normalizedKey = normalizeDestinationKey(destinationName);

  const local = readLocalDestinationCover(normalizedKey);
  if (local) {
    return { url: local, normalizedKey, destinationName, cacheHit: true };
  }

  return destCoverCache.getOrFetch(normalizedKey, async () => {
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
        return { url: null, normalizedKey, destinationName, cacheHit: false };
      }
      const json = (await res.json()) as {
        url?: string;
        cacheHit?: boolean;
        normalizedDestinationKey?: string;
        query?: string;
      };
      const url = json.url?.trim() || null;
      if (url) writeLocalDestinationCover(normalizedKey, url);
      return {
        url,
        normalizedKey: json.normalizedDestinationKey ?? normalizedKey,
        destinationName,
        cacheHit: Boolean(json.cacheHit),
        query: json.query,
      };
    } catch {
      return { url: null, normalizedKey, destinationName, cacheHit: false };
    }
  });
}
