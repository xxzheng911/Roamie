import { WEATHER_CACHE_TTL_MS } from "@/lib/weather/constants";

type CacheEntry<T> = { data: T; expiresAt: number };

const memory = new Map<string, CacheEntry<unknown>>();
const LS_PREFIX = "roamie:weather:";

function readLocal<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeLocal<T>(key: string, entry: CacheEntry<T>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch {
    /* quota */
  }
}

export function weatherCacheKey(
  kind: "current" | "forecast",
  lat: number,
  lng: number,
  extra?: string,
): string {
  const rounded = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
  return extra ? `${kind}:${rounded}:${extra}` : `${kind}:${rounded}`;
}

export function getWeatherCached<T>(key: string): T | null {
  const now = Date.now();
  const mem = memory.get(key) as CacheEntry<T> | undefined;
  if (mem && mem.expiresAt > now) return mem.data;

  const local = readLocal<T>(key);
  if (local && local.expiresAt > now) {
    memory.set(key, local);
    return local.data;
  }
  return null;
}

export function setWeatherCached<T>(key: string, data: T, ttlMs = WEATHER_CACHE_TTL_MS): void {
  const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };
  memory.set(key, entry);
  writeLocal(key, entry);
}

export function clearWeatherCache(): void {
  memory.clear();
  inflight.clear();
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

const inflight = new Map<string, Promise<unknown>>();

/** 快取命中或 in-flight deduplication — 避免同頁 / 切頁重複 request */
export async function getWeatherCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = WEATHER_CACHE_TTL_MS,
): Promise<T> {
  const cached = getWeatherCached<T>(key);
  if (cached !== null) return cached;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const promise = fetcher()
    .then((data) => {
      setWeatherCached(key, data, ttlMs);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function isWeatherRequestInFlight(key: string): boolean {
  return inflight.has(key);
}
