import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";

const MEMORY = new Map<string, string>();
const LS_KEY = "roamie:image-cache";
const TTL_MS = API_CACHE_TTL_MS.image;

type CacheEntry = { url: string; at: number };

function readLocal(): Record<string, CacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}") as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function writeLocal(data: Record<string, CacheEntry>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function getCachedImage(key: string): string | null {
  const mem = MEMORY.get(key);
  if (mem) return preferJpegPngImageUrl(mem);

  const local = readLocal()[key];
  if (!local) return null;
  if (Date.now() - local.at > TTL_MS) return null;
  const safe = preferJpegPngImageUrl(local.url);
  if (!safe) return null;
  MEMORY.set(key, safe);
  return safe;
}

export function setCachedImage(key: string, url: string): void {
  const safe = preferJpegPngImageUrl(url);
  if (!safe) return;
  MEMORY.set(key, safe);
  const local = readLocal();
  local[key] = { url: safe, at: Date.now() };
  writeLocal(local);
}

export function cacheKey(prefix: string, query: string): string {
  return `${prefix}:${query.trim().toLowerCase()}`;
}
