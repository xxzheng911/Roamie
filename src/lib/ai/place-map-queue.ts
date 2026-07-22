/**
 * Concurrency-limited place-mapping queue for itinerary generation.
 * Never Promise.all() the full candidate list — max 2 in flight, with batch gaps.
 */

const MAP_CONCURRENCY = 2;
const BATCH_GAP_MS = 400;
const QUERY_BACKOFF_MS = [1000, 2000] as const;

export const PLACE_MAP_MAX_CONCURRENCY = MAP_CONCURRENCY;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 250);
}

/** Run tasks with max concurrency; insert a gap after each full batch of workers. */
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  options?: { concurrency?: number; batchGapMs?: number },
): Promise<R[]> {
  const concurrency = Math.max(1, options?.concurrency ?? MAP_CONCURRENCY);
  const batchGapMs = options?.batchGapMs ?? BATCH_GAP_MS;
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completedInBatch = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
      completedInBatch += 1;
      if (completedInBatch >= concurrency && nextIndex < items.length) {
        completedInBatch = 0;
        await sleep(batchGapMs);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Per-generation query / name dedupe so identical searches only run once. */
export function createPlaceMapDedupeScope(generationRequestId: string) {
  const queryCache = new Map<string, Promise<unknown>>();
  const nameResolved = new Map<string, unknown>();
  const id = generationRequestId;

  return {
    generationRequestId: id,
    normalizeQueryKey(query: string): string {
      return `${id}|q:${query.trim().replace(/\s+/g, " ").toLowerCase()}`;
    },
    normalizeNameKey(name: string): string {
      return `${id}|n:${name.trim().replace(/\s+/g, "").toLowerCase()}`;
    },
    getResolvedName<T>(name: string): T | undefined {
      return nameResolved.get(this.normalizeNameKey(name)) as T | undefined;
    },
    setResolvedName<T>(name: string, value: T): void {
      nameResolved.set(this.normalizeNameKey(name), value);
    },
    async dedupeQuery<T>(query: string, runner: () => Promise<T>): Promise<T> {
      const key = this.normalizeQueryKey(query);
      const inflight = queryCache.get(key);
      if (inflight) return inflight as Promise<T>;
      const promise = runner().finally(() => {
        // Keep resolved promise for same-generation reuse; do not delete.
      });
      queryCache.set(key, promise);
      return promise;
    },
  };
}

export type PlaceMapDedupeScope = ReturnType<typeof createPlaceMapDedupeScope>;

export function rateLimitBackoffMs(attemptIndex: number, retryAfterMs?: number): number {
  if (retryAfterMs != null && retryAfterMs > 0) return jitter(retryAfterMs);
  const base = QUERY_BACKOFF_MS[Math.min(attemptIndex, QUERY_BACKOFF_MS.length - 1)] ?? 2000;
  return jitter(base);
}

/** First-round Places candidate cap before mapping (6 days → 24). */
export function computeFirstRoundPlaceMapCap(days: number): number {
  return Math.min(Math.max(days * 4, 12), 24);
}

/**
 * Soft fetch target after mapping — capacity scales with trip days.
 * P1 Step 1：requiredMinimum = days×3；fetchTarget 以 days×4 oversampling 保留去重空間。
 */
export function computeItineraryResolvedTarget(days: number): number {
  const safe = Math.max(1, days);
  return Math.min(Math.max(safe * 4, safe * 3), 30);
}
