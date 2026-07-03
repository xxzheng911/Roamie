import roamieDefaultCover from "@/assets/roamie-default-cover.png";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { isImageLoadFailed } from "@/lib/image-url-failure-cache";

const GOOGLE_PLACE_PHOTO_NAME_RE = /(places\/[^/?#]+\/photos\/[^/?#]+)/i;

/** 僅明確 WebP（Google Places URL 無副檔名，不可猜測） */
export function isWebpImageUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  const trimmed = url.trim();
  if (/\.webp(\?|$|#)/i.test(trimmed)) return true;
  if (/[?&](fm|format)=webp/i.test(trimmed)) return true;
  return false;
}

export function getLocalPlaceImageFallback(): string {
  return roamieDefaultCover;
}

export function hasRemotePlacePhotoApi(): boolean {
  return Boolean((import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim());
}

export function extractGooglePlacePhotoName(url: string): string | null {
  const match = url.match(GOOGLE_PLACE_PHOTO_NAME_RE);
  return match?.[1] ?? null;
}

export function buildPlacePhotoProxyUrl(photoName: string, maxWidth = 600): string {
  const normalized = photoName.trim();
  const width = Math.min(1600, Math.max(120, maxWidth));
  const relative = `/api/place-photo?photo=${encodeURIComponent(normalized)}&w=${width}`;
  const origin = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim().replace(/\/$/, "");
  if (origin && isCapacitorNativeShell()) {
    return `${origin}${relative}`;
  }
  return relative;
}

function isRelativePlacePhotoProxy(url: string): boolean {
  const trimmed = url.trim();
  return trimmed.startsWith("/api/place-photo") || trimmed.includes("/api/place-photo?");
}

/** Google Places media 在 native 改走 proxy；Web 可用相對 /api/place-photo */
export function proxyGooglePlacePhotoUrl(url: string, maxWidth = 600): string | null {
  const photoName = extractGooglePlacePhotoName(url);
  if (!photoName) return null;
  try {
    const parsed = new URL(url, "https://localhost");
    const w = parsed.searchParams.get("maxWidthPx") ?? parsed.searchParams.get("w") ?? String(maxWidth);
    const width = Math.min(1600, Math.max(120, Number(w) || maxWidth));
    return buildPlacePhotoProxyUrl(photoName, width);
  } catch {
    return buildPlacePhotoProxyUrl(photoName, maxWidth);
  }
}

function coerceUnsplashToJpeg(url: URL): string {
  url.searchParams.set("fm", "jpg");
  url.searchParams.delete("auto");
  url.searchParams.delete("format");
  url.searchParams.delete("q");
  return url.toString();
}

function shouldProxyGoogleMedia(url: string): boolean {
  if (url.includes("places.googleapis.com") && url.includes("/media")) return true;
  if (/googleusercontent\.com|ggpht\.com/i.test(url)) return true;
  if (url.startsWith("places/") && url.includes("/photos/")) return true;
  return false;
}

/**
 * 解析可給 `<img src>` 的 URL：Google photo 優先，僅拒絕明確 WebP / data / blob。
 * 不在載入前 fallback；失敗由 onError + failedUrl cache 處理。
 */
export function resolvePlaceImageUrl(
  url: string | null | undefined,
  options?: { maxWidth?: number },
): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  const maxWidth = options?.maxWidth ?? 600;

  if (trimmed.startsWith("data:")) return null;
  if (trimmed.startsWith("blob:")) return trimmed;
  if (isWebpImageUrl(trimmed)) return null;

  let candidate = trimmed;

  if (shouldProxyGoogleMedia(trimmed)) {
    const proxied = proxyGooglePlacePhotoUrl(trimmed, maxWidth);
    if (proxied) candidate = proxied;
  }

  try {
    if (
      candidate.includes("images.unsplash.com") ||
      candidate.includes("source.unsplash.com") ||
      candidate.includes("plus.unsplash.com")
    ) {
      candidate = coerceUnsplashToJpeg(new URL(candidate));
    }
  } catch {
    /* ignore malformed URLs */
  }

  if (isRelativePlacePhotoProxy(candidate) && isCapacitorNativeShell() && !hasRemotePlacePhotoApi()) {
    return null;
  }

  if (isImageLoadFailed(candidate)) return null;
  return candidate;
}

/** @deprecated 使用 resolvePlaceImageUrl */
export function preferJpegPngImageUrl(
  url: string | null | undefined,
  options?: { maxWidth?: number; photoName?: string | null },
): string | null {
  return resolvePlaceImageUrl(url, { maxWidth: options?.maxWidth });
}

/**
 * 需要立即顯示 fallback 時使用（例如空 URL）。
 * Google Places URL 仍會原樣返回，不在此 preemptive fallback。
 */
export function sanitizePlaceImageUrl(
  url: string | null | undefined,
  options?: { maxWidth?: number; fallback?: string | null },
): string {
  const fallback = options?.fallback?.trim() || getLocalPlaceImageFallback();
  const resolved = resolvePlaceImageUrl(url, { maxWidth: options?.maxWidth });
  if (!resolved) {
    if (options?.fallback === null) return fallback;
    return fallback;
  }
  return resolved;
}

export function resolveSafeImageSrc(
  primary: string | null | undefined,
  fallback?: string | null,
  options?: { maxWidth?: number },
): string | null {
  return (
    resolvePlaceImageUrl(primary, options) ??
    resolvePlaceImageUrl(fallback, options) ??
    null
  );
}

export function filterSafeImageUrls(urls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const safe = resolvePlaceImageUrl(raw);
    if (!safe) continue;
    const key = safe.split("?")[0]?.toLowerCase() ?? safe;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(safe);
  }
  return out;
}
