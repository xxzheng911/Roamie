import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import { extractGooglePlacePhotoName, preferJpegPngImageUrl } from "@/lib/safe-image-url";

const MEMORY = new Map<string, string>();
const LS_KEY = "roamie:image-cache";
const TTL_MS = API_CACHE_TTL_MS.image;
/** Photo recovered from a historical signed URL. Survives a strict-mode double read after the entry is deleted. */
const recoveredPhotoByKey = new Map<string, string>();

/** Signed /api/place-photo URLs are a 10-minute capability, not a durable image identity. */
export function isSignedPlacePhotoCapabilityUrl(url: string | null | undefined): boolean {
  if (!url || !url.includes("/api/place-photo")) return false;
  try {
    const parsed = new URL(url, "https://roamie.invalid");
    if (!parsed.pathname.includes("/api/place-photo")) return false;
    return parsed.searchParams.has("signature") || parsed.searchParams.has("expires");
  } catch {
    return /(?:^|[?&])(?:signature|expires)=/.test(url);
  }
}

/** Server rejects expires < now. Missing or non-integer expires cannot be prefetched. */
export function isExpiredSignedPlacePhotoUrl(url: string, nowMs = Date.now()): boolean {
  if (!isSignedPlacePhotoCapabilityUrl(url)) return false;
  try {
    const expires = Number(new URL(url, "https://roamie.invalid").searchParams.get("expires"));
    if (!Number.isInteger(expires) || expires <= 0) return true;
    return expires < Math.floor(nowMs / 1000);
  } catch {
    return true;
  }
}

/** URL → 預載 Promise；同一 URL 不重複下載 */
const inflightPrefetch = new Map<string, Promise<void>>();
/** photoReference / photoName + width → URL，避免重建請求 */
const photoUrlByRef = new Map<string, string>();

type CacheEntry = { url: string; at: number };

function browserLocalStorage(): Storage | null {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.getItem !== "function") return null;
  return storage;
}

function readLocal(): Record<string, CacheEntry> {
  const storage = browserLocalStorage();
  if (!storage) return {};
  try {
    return JSON.parse(storage.getItem(LS_KEY) || "{}") as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function writeLocal(data: Record<string, CacheEntry>): void {
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

function durableImageUrl(url: string | null | undefined): string | null {
  if (!url || isSignedPlacePhotoCapabilityUrl(url)) return null;
  const safe = preferJpegPngImageUrl(url);
  if (!safe || isSignedPlacePhotoCapabilityUrl(safe)) return null;
  return safe;
}

/**
 * Historical signed URLs are not final srcs. Return the canonical photo resource
 * and remove the capability from the 24-hour cache. Repeated reads stay stable
 * after the storage entry is gone.
 */
export function recoverPersistedSignedPhoto(key: string): string | null {
  const remembered = recoveredPhotoByKey.get(key);
  const data = readLocal();
  const local = data[key];
  const mem = MEMORY.get(key);
  const signed = [mem, local?.url].find((value) => isSignedPlacePhotoCapabilityUrl(value)) ?? null;
  if (!signed) {
    if ((local?.url && !isSignedPlacePhotoCapabilityUrl(local.url)) || (mem && !isSignedPlacePhotoCapabilityUrl(mem))) {
      recoveredPhotoByKey.delete(key);
      return null;
    }
    return remembered ?? null;
  }
  const photo = extractGooglePlacePhotoName(signed) ?? remembered ?? null;
  if (photo) recoveredPhotoByKey.set(key, photo);
  if (mem && isSignedPlacePhotoCapabilityUrl(mem)) MEMORY.delete(key);
  if (local && isSignedPlacePhotoCapabilityUrl(local.url)) {
    delete data[key];
    writeLocal(data);
  }
  return photo;
}

export function getCachedImage(key: string): string | null {
  recoverPersistedSignedPhoto(key);

  const mem = durableImageUrl(MEMORY.get(key));
  if (mem) return mem;
  if (MEMORY.has(key)) MEMORY.delete(key);

  const local = readLocal()[key];
  if (!local) return null;
  if (Date.now() - local.at > TTL_MS) return null;
  const safe = durableImageUrl(local.url);
  if (!safe) return null;
  MEMORY.set(key, safe);
  return safe;
}

export function setCachedImage(key: string, url: string): void {
  const safe = durableImageUrl(url);
  if (!safe) return;
  recoveredPhotoByKey.delete(key);
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
  if (!hit) return null;
  if (isExpiredSignedPlacePhotoUrl(hit)) {
    photoUrlByRef.delete(key);
    return null;
  }
  return preferJpegPngImageUrl(hit);
}

/**
 * 預載圖片：memory + disk URL 快取，並對同一 URL 去重 in-flight 下載。
 * 瀏覽器會再用 HTTP cache；這裡避免 React remount 重複觸發大量 Image()。
 */
export function prefetchImageUrl(url: string): Promise<void> {
  const safe = preferJpegPngImageUrl(url);
  if (!safe || typeof globalThis.Image !== "function") return Promise.resolve();
  if (isExpiredSignedPlacePhotoUrl(url) || isExpiredSignedPlacePhotoUrl(safe)) return Promise.resolve();

  const existing = inflightPrefetch.get(safe);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const img = new globalThis.Image();
    img.decoding = "async";
    img.onload = () => {
      if (!isSignedPlacePhotoCapabilityUrl(safe)) {
        setCachedImage(cacheKey("prefetched-url", safe), safe);
      }
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

function signAndPrefetch(photo: string): void {
  void import("@/services/signed-place-photo").then(async ({ getSignedPlacePhotoUrl }) => {
    const signed = await getSignedPlacePhotoUrl(photo, HOME_COVER_PREFETCH_WIDTH);
    if (!signed || isExpiredSignedPlacePhotoUrl(signed)) return;
    rememberPhotoUrl(photo, HOME_COVER_PREFETCH_WIDTH, signed);
    await prefetchImageUrl(signed);
  });
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
    const rawUrl = item.url?.trim() || null;
    const photo =
      item.photoName?.trim() || (rawUrl ? extractGooglePlacePhotoName(rawUrl) ?? "" : "");

    if (rawUrl && isSignedPlacePhotoCapabilityUrl(rawUrl)) {
      if (item.placeId?.trim()) {
        recoverPersistedSignedPhoto(cacheKey("home-place-cover", item.placeId.trim()));
      }
      if (isExpiredSignedPlacePhotoUrl(rawUrl)) {
        if (photo) signAndPrefetch(photo);
      } else {
        void prefetchImageUrl(rawUrl);
      }
      n += 1;
      continue;
    }

    let url = rawUrl;
    if (!url && photo) {
      const remembered = getRememberedPhotoUrl(photo, HOME_COVER_PREFETCH_WIDTH);
      if (remembered && !isSignedPlacePhotoCapabilityUrl(remembered)) url = remembered;
      else if (remembered && !isExpiredSignedPlacePhotoUrl(remembered)) {
        void prefetchImageUrl(remembered);
        n += 1;
        continue;
      } else {
        signAndPrefetch(photo);
        continue;
      }
    }
    if (!url || isSignedPlacePhotoCapabilityUrl(url)) continue;
    if (item.placeId?.trim()) {
      setCachedImage(cacheKey("home-place-cover", item.placeId.trim()), url);
    }
    void prefetchImageUrl(url);
    n += 1;
  }
}
