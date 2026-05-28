import { PLACES_CACHE_TTL_MS } from "@/lib/places-cache-config";
import { createRequestCache } from "@/services/requestCache";

const photoUrlCache = createRequestCache({
  prefix: "place-photo-url",
  ttlMs: PLACES_CACHE_TTL_MS.placePhoto,
  persist: true,
});

/** 快取已解析的 Google 相片 URL（24hr），避免重複組裝與載入 */
export function getCachedPlacePhotoUrl(
  photoName: string,
  maxWidth: number,
  resolve: () => string | null,
): string | null {
  const key = `${photoName.trim()}|${maxWidth}`;
  const cached = photoUrlCache.getCached<string | null>(key);
  if (cached !== null) return cached;
  const url = resolve();
  photoUrlCache.setCached(key, url);
  return url;
}
