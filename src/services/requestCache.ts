type CacheEntry<T> = { data: T; expiresAt: number };

export type RequestCacheOptions = {
  prefix: string;
  ttlMs: number;
  /** 是否寫入 localStorage（僅 browser） */
  persist?: boolean;
};

/**
 * 記憶體 cache + in-flight deduplication。
 * 相同 key 的並發 request 只會發送一次。
 */
export function createRequestCache(options: RequestCacheOptions) {
  const memory = new Map<string, CacheEntry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();
  const lsPrefix = `roamie:cache:${options.prefix}:`;

  function readPersisted<T>(key: string): CacheEntry<T> | null {
    if (!options.persist || typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(lsPrefix + key);
      if (!raw) return null;
      return JSON.parse(raw) as CacheEntry<T>;
    } catch {
      return null;
    }
  }

  function writePersisted<T>(key: string, entry: CacheEntry<T>): void {
    if (!options.persist || typeof window === "undefined") return;
    try {
      localStorage.setItem(lsPrefix + key, JSON.stringify(entry));
    } catch {
      /* quota */
    }
  }

  function getCached<T>(key: string): T | null {
    const now = Date.now();
    const mem = memory.get(key) as CacheEntry<T> | undefined;
    if (mem && mem.expiresAt > now) return mem.data;

    const local = readPersisted<T>(key);
    if (local && local.expiresAt > now) {
      memory.set(key, local);
      return local.data;
    }
    return null;
  }

  function setCached<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + options.ttlMs };
    memory.set(key, entry);
    writePersisted(key, entry);
  }

  async function getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = getCached<T>(key);
    if (cached !== null) return cached;

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = fetcher()
      .then((data) => {
        setCached(key, data);
        return data;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  }

  function clear(): void {
    memory.clear();
    inflight.clear();
    if (!options.persist || typeof window === "undefined") return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(lsPrefix)) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }

  return { getCached, setCached, getOrFetch, clear };
}
