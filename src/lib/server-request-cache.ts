/** Server-only：記憶體 cache + in-flight deduplication */

type Entry<T> = { data: T; expiresAt: number };

export function createServerRequestCache(ttlMs: number) {
  const memory = new Map<string, Entry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();

  function get<T>(key: string): T | null {
    const hit = memory.get(key) as Entry<T> | undefined;
    if (!hit || hit.expiresAt <= Date.now()) return null;
    return hit.data;
  }

  function set<T>(key: string, data: T): void {
    memory.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  async function getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    shouldCache: (value: T) => boolean = () => true,
  ): Promise<T> {
    const cached = get<T>(key);
    if (cached !== null) return cached;

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = fetcher()
      .then((data) => {
        if (shouldCache(data)) set(key, data);
        return data;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  }

  return { get, set, getOrFetch };
}
