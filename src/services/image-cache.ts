import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";

const MEMORY = new Map<string, string>();
const LS_KEY = "roamie:image-cache";
const TTL_MS = API_CACHE_TTL_MS.image;

/** URL → 預載 Promise；同一 URL 不重複下載 */
const inflightPrefetch = new Map<string, Promise<void>>();
/** photoReference / photoName + width → URL，避免重建請求 */
const photoUrlByRef = new Map<string, string>();

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

export function rememberPhotoUrl(photoRef: string, maxWidth: number, url: string): void {
  const key = `${photoRef.trim()}@${maxWidth}`;
  const safe = preferJpegPngImageUrl(url);
  if (!safe) return;
  photoUrlByRef.set(key, safe);
}

export function getRememberedPhotoUrl(photoRef: string, maxWidth: number): string | null {
  const key = `${photoRef.trim()}@${maxWidth}`;
  const hit = photoUrlByRef.get(key);
  return hit ? preferJpegPngImageUrl(hit) : null;
}

/**
 * 預載圖片：memory + disk URL 快取，並對同一 URL 去重 in-flight 下載。
 * 瀏覽器會再用 HTTP cache；這裡避免 React remount 重複觸發大量 Image()。
 */
export function prefetchImageUrl(url: string): Promise<void> {
  const safe = preferJpegPngImageUrl(url);
  if (!safe || typeof window === "undefined") return Promise.resolve();

  const existing = inflightPrefetch.get(safe);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      setCachedImage(cacheKey("prefetched-url", safe), safe);
      inflightPrefetch.delete(safe);
      resolve();
    };
    img.onerror = () => {
      inflightPrefetch.delete(safe);
      resolve();
    };
    img.src = safe;
  });
  inflightPrefetch.set(safe, promise);
  return promise;
}

/** 首頁卡片顯示寬約 480；預載同尺寸避免下載過大原圖 */
const HOME_COVER_PREFETCH_WIDTH = 480;

export function prefetchPlaceCoverUrls(
  items: Array<{ placeId?: string | null; url?: string | null; photoName?: string | null }>,
  maxCount = 5,
): void {
  let n = 0;
  for (const item of items) {
    if (n >= maxCount) break;
    let url = item.url?.trim() || null;
    const photo = item.photoName?.trim();
    if (!url && photo) {
      url =
        getRememberedPhotoUrl(photo, HOME_COVER_PREFETCH_WIDTH) ||
        preferJpegPngImageUrl(buildPlacePhotoUrl(photo, HOME_COVER_PREFETCH_WIDTH));
      if (url && photo) rememberPhotoUrl(photo, HOME_COVER_PREFETCH_WIDTH, url);
    }
    if (!url) continue;
    if (item.placeId?.trim()) {
      setCachedImage(cacheKey("home-place-cover", item.placeId.trim()), url);
    }
    void prefetchImageUrl(url);
    n += 1;
  }
}
