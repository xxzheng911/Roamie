import { resolveAppApiUrl } from "@/lib/api-base-url";
import {
  readLocalPlaceImage,
  writeLocalPlaceImage,
} from "@/lib/place-image/place-image-local-cache";
import { createRequestCache } from "@/services/requestCache";
import { API_CACHE_TTL_MS } from "@/lib/api/constants";

const unsplashPlaceCache = createRequestCache({
  prefix: "unsplash-place",
  ttlMs: API_CACHE_TTL_MS.image,
  persist: true,
});

export function buildPlaceImageCacheKey(input: {
  placeId?: string | null;
  name: string;
  city?: string | null;
}): string {
  if (input.placeId?.trim()) return `id:${input.placeId.trim()}`;
  const name = input.name.trim().toLowerCase();
  const city = (input.city ?? "").trim().toLowerCase();
  return `name:${name}|${city}`;
}

export type FetchUnsplashPlaceImageInput = {
  placeId?: string | null;
  name: string;
  category?: string;
  city?: string | null;
  country?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
};

export async function fetchUnsplashPlaceImage(
  input: FetchUnsplashPlaceImageInput,
): Promise<{ url: string | null; cacheHit: boolean; query?: string }> {
  const cacheKey = buildPlaceImageCacheKey(input);
  const local = readLocalPlaceImage(cacheKey);
  if (local) return { url: local, cacheHit: true };

  return unsplashPlaceCache.getOrFetch(cacheKey, async () => {
    try {
      const res = await fetch(resolveAppApiUrl("/api/place-image"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cacheKey,
          placeId: input.placeId ?? null,
          name: input.name,
          category: input.category,
          city: input.city ?? null,
          country: input.country ?? null,
          primaryType: input.primaryType ?? null,
          types: input.types ?? null,
        }),
      });
      if (!res.ok) return { url: null, cacheHit: false };
      const json = (await res.json()) as { url?: string; cacheHit?: boolean; query?: string };
      const url = json.url?.trim() || null;
      if (url) writeLocalPlaceImage(cacheKey, url);
      return { url, cacheHit: Boolean(json.cacheHit), query: json.query };
    } catch {
      return { url: null, cacheHit: false };
    }
  });
}
