import { createRequestCache } from "@/services/requestCache";
import { coverDiagnostic } from "@/services/cover-diagnostics";

export const TRIP_COVER_CACHE_NAMESPACE = "trip-cover-v2";
export const TRIP_COVER_REMOTE_TTL_MS = 24 * 60 * 60 * 1000;
export const TRIP_COVER_NEGATIVE_TTL_MS = 60_000;
export type CachedTripCover = { url: string; source: "unsplash" | "roamie"; query: string | null };

/** New namespace intentionally ignores historical place-image fallback entries. */
export function createTripCoverCache() {
  const remote = createRequestCache({ prefix: TRIP_COVER_CACHE_NAMESPACE, ttlMs: TRIP_COVER_REMOTE_TTL_MS, persist: true });
  const negative = new Map<string, { value: CachedTripCover; expiresAt: number }>();
  return async (key: string, resolve: () => Promise<CachedTripCover>): Promise<CachedTripCover> => {
    const cached = remote.getCached<CachedTripCover>(key);
    if (cached?.source === "unsplash") {
      coverDiagnostic({ cache_hit: true, cached_source: "unsplash", final_source: "unsplash" });
      return cached;
    }
    // getOrFetch owns single-flight, including negative-cache checks and resolution.
    return remote.getOrFetch(key, async () => {
      const failed = negative.get(key);
      if (failed && failed.expiresAt > Date.now()) {
        coverDiagnostic({ cache_hit: true, cached_source: "roamie", final_source: "roamie", fallback_reason: "negative_cache" });
        return failed.value;
      }
      negative.delete(key);
      coverDiagnostic({ cache_hit: false, cached_source: "none" });
      const result = await resolve();
      if (result.source === "roamie") {
        // Bound memory without adding timers or automatic retries.
        for (const [k, entry] of negative) if (entry.expiresAt <= Date.now()) negative.delete(k);
        if (negative.size >= 256) negative.delete(negative.keys().next().value!);
        negative.set(key, { value: result, expiresAt: Date.now() + TRIP_COVER_NEGATIVE_TTL_MS });
      }
      coverDiagnostic({ final_source: result.source });
      return result;
    }, { shouldCache: value => value.source === "unsplash" });
  };
}
