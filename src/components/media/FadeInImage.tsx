import { traceCover, type CoverTraceContext } from "@/lib/saved-trip/cover-runtime-diagnostics";
import { useEffect, useRef, useState } from "react";
import { recordPlacesPhotoUrlLoad } from "@/lib/places-api-stats";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { stripMediaUrlQuery } from "@/lib/media-display-url";
import {
  extractGooglePlacePhotoName,
  getLocalPlaceImageFallback,
  preferJpegPngImageUrl,
  resolvePlaceImageUrl,
} from "@/lib/safe-image-url";
import { cn } from "@/lib/utils";
import { isUnsignedPlacePhotoProxyUrl } from "@/services/image-cache";
import { getSignedPlacePhotoUrl, readSignedPlacePhotoUrl } from "@/services/signed-place-photo";

/** 未簽名 proxy 的 photo name 與寬度；其他 URL 回 null。 */
function unsignedPlacePhotoTarget(src: string): { photo: string; width: number } | null {
  if (src.startsWith("blob:") || src.startsWith("data:")) return null;
  const resolved = resolvePlaceImageUrl(src);
  if (!resolved || !isUnsignedPlacePhotoProxyUrl(resolved)) return null;
  const photo = extractGooglePlacePhotoName(resolved);
  if (!photo) return null;
  let width = 600;
  try {
    width = Number(new URL(resolved, "https://roamie.invalid").searchParams.get("w")) || 600;
  } catch {
    /* keep default width */
  }
  return { photo, width };
}

/** 未簽名 /api/place-photo 但解析不出 photo name：不得當 <img src>（必 401），直接預設圖。 */
function isUnparseableUnsignedPlacePhoto(src: string): boolean {
  if (src.startsWith("blob:") || src.startsWith("data:")) return false;
  const resolved = resolvePlaceImageUrl(src) ?? src;
  if (!isUnsignedPlacePhotoProxyUrl(resolved)) return false;
  return !extractGooglePlacePhotoName(resolved);
}

const loadedSrcCache =
  (globalThis as { __roamieLoadedImages?: Set<string> }).__roamieLoadedImages ?? new Set<string>();
(globalThis as { __roamieLoadedImages?: Set<string> }).__roamieLoadedImages = loadedSrcCache;

/** Decode / load identity without query/token noise */
function stableSrcKey(url: string): string {
  return stripMediaUrlQuery(url);
}

/** 上傳新封面後清除同路徑舊圖的 loaded 快取 */
export function invalidateLoadedImageCache(url: string | null | undefined): void {
  if (!url?.trim()) return;
  const base = stripMediaUrlQuery(url);
  for (const key of [...loadedSrcCache]) {
    if (stripMediaUrlQuery(key) === base) loadedSrcCache.delete(key);
  }
}

type Props = {
  /** Optional Saved Trip observation only; no effect on other image callers. */
  coverTrace?: CoverTraceContext;
  src: string | null | undefined;
  alt?: string;
  loading?: boolean;
  className?: string;
  imgClassName?: string;
  fallbackSrc?: string | null;
  /** Prefer eager decode for above-the-fold covers */
  priority?: boolean;
  waitForDecode?: boolean;
  /** 主圖（非 fallback）實際載入失敗時通知；不影響既有 fallback 行為。 */
  onSourceError?: (failedSrc: string) => void;
};

/** 帶 loading skeleton 與淡入動畫的圖片 */
export function FadeInImage({
  src,
  alt = "",
  loading,
  className,
  imgClassName,
  fallbackSrc,
  priority = false,
  waitForDecode = false,
  coverTrace,
  onSourceError,
}: Props) {
  const onSourceErrorRef = useRef(onSourceError);
  onSourceErrorRef.current = onSourceError;
  const stable = src ? stableSrcKey(src) : "";
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedSrcCache.has(stable)));
  const [initialUnsigned] = useState(() => (src ? unsignedPlacePhotoTarget(src) : null));
  const [displaySrc, setDisplaySrc] = useState(() =>
    initialUnsigned
      ? readSignedPlacePhotoUrl(initialUnsigned.photo, initialUnsigned.width)
      : src && isUnparseableUnsignedPlacePhoto(src)
        ? (resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback())
        : (src ?? null),
  );
  const [usedFallback, setUsedFallback] = useState(false);
  const [signing, setSigning] = useState(() => Boolean(initialUnsigned && !displaySrc));
  const prevStable = useRef(stable);
  const currentSrc = useRef(src);
  currentSrc.current = src;
  const currentDisplaySrc = useRef(displaySrc);
  currentDisplaySrc.current = displaySrc;

  useEffect(() => {
    if (displaySrc) traceCover(coverTrace, "COVER_IMAGE_LOAD_START", displaySrc, "loading");
  }, [displaySrc, coverTrace?.correlationId]);

  useEffect(() => {
    setSigning(false);
    const unsigned = src ? unsignedPlacePhotoTarget(src) : null;
    if (src && unsigned) {
      // 未簽名 /api/place-photo 會被 Worker 401：先簽名（沿用 cache／inflight），失敗才 fallback。
      prevStable.current = stableSrcKey(src);
      const applySigned = (signed: string | null) => {
        if (signed && !isImageLoadFailed(signed)) {
          setDisplaySrc(signed);
          setUsedFallback(false);
          setLoaded(loadedSrcCache.has(signed));
          return;
        }
        // 已記錄過載入失敗（非簽名失敗）同樣通知，讓呼叫端有機會換新來源。
        if (signed) onSourceErrorRef.current?.(signed);
        const safeFallback =
          resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
        traceCover(coverTrace, "COVER_FALLBACK_APPLIED", safeFallback, "fallback", "invalid_url");
        setDisplaySrc(safeFallback);
        setUsedFallback(true);
        setLoaded(loadedSrcCache.has(stableSrcKey(safeFallback)));
      };
      const cached = readSignedPlacePhotoUrl(unsigned.photo, unsigned.width);
      if (cached) {
        applySigned(cached);
        return;
      }
      let cancelled = false;
      setDisplaySrc(null);
      setUsedFallback(false);
      setLoaded(false);
      setSigning(true);
      void getSignedPlacePhotoUrl(unsigned.photo, unsigned.width).then((signed) => {
        if (cancelled) return;
        setSigning(false);
        applySigned(signed);
      });
      return () => {
        cancelled = true;
      };
    }
    if (src && isUnparseableUnsignedPlacePhoto(src)) {
      prevStable.current = stableSrcKey(src);
      const safeFallback =
        resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
      traceCover(coverTrace, "COVER_FALLBACK_APPLIED", safeFallback, "fallback", "invalid_url");
      setDisplaySrc(safeFallback);
      setUsedFallback(true);
      setLoaded(loadedSrcCache.has(stableSrcKey(safeFallback)));
      return;
    }
    if (!src) {
      traceCover(coverTrace, "COVER_FALLBACK_APPLIED", fallbackSrc, loading ? "pending" : "fallback", "missing_url");
      setLoaded(false);
      setDisplaySrc(
        loading
          ? null
          : fallbackSrc
            ? (resolvePlaceImageUrl(fallbackSrc) ?? getLocalPlaceImageFallback())
            : null,
      );
      setUsedFallback(false);
      prevStable.current = "";
      return;
    }
    const nextStable = stableSrcKey(src);
    // Same image identity — do not reset to skeleton / opacity 0 on remount or ?v= churn.
    if (nextStable && nextStable === prevStable.current && loadedSrcCache.has(nextStable)) {
      setDisplaySrc(
        src.startsWith("blob:") || src.startsWith("data:")
          ? src
          : (resolvePlaceImageUrl(src) ?? src),
      );
      setLoaded(true);
      return;
    }
    prevStable.current = nextStable;

    const safeSrc =
      src.startsWith("blob:") || src.startsWith("data:") ? src : resolvePlaceImageUrl(src);
    if (!safeSrc || isImageLoadFailed(safeSrc)) {
      if (safeSrc) onSourceErrorRef.current?.(safeSrc);
      const safeFallback =
        resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
      if (safeFallback && !isImageLoadFailed(safeFallback)) {
        traceCover(coverTrace, "COVER_FALLBACK_APPLIED", safeFallback, "fallback", !safeSrc ? "invalid_url" : "failed_url_cache");
        setDisplaySrc(safeFallback);
        setUsedFallback(true);
        setLoaded(loadedSrcCache.has(stableSrcKey(safeFallback)));
        return;
      }
      traceCover(coverTrace, "COVER_IMAGE_LOAD_FAILURE", src, "failed", "fallback_exhausted");
      setDisplaySrc(null);
      setUsedFallback(false);
      setLoaded(true);
      return;
    }
    setDisplaySrc(safeSrc);
    setUsedFallback(false);
    setLoaded(loadedSrcCache.has(nextStable) || loadedSrcCache.has(safeSrc));
  }, [src, fallbackSrc, loading]);

  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {(loading || signing || (displaySrc && !loaded)) && (
        <div className="absolute inset-0 animate-pulse bg-secondary/80" aria-hidden />
      )}
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          draggable={false}
          onLoad={async (event) => {
            const image = event.currentTarget;
            const sourceAtLoad = src;
            if (waitForDecode && typeof image.decode === "function") {
              try { await image.decode(); } catch { /* onLoad remains authoritative on decode rejection */ }
            }
            const current = currentSrc.current === sourceAtLoad && currentDisplaySrc.current === displaySrc && image.isConnected;
            traceCover(coverTrace, "COVER_IMAGE_LOAD_SUCCESS", displaySrc, "loaded", current ? "none" : "stale_callback", current);
            if (waitForDecode && (currentSrc.current !== sourceAtLoad || !image.isConnected)) return;
            if (displaySrc) {
              loadedSrcCache.add(displaySrc);
              loadedSrcCache.add(stableSrcKey(displaySrc));
              recordPlacesPhotoUrlLoad(displaySrc);
            }
            setLoaded(true);
          }}
          onError={() => {
            const current = currentSrc.current === src && currentDisplaySrc.current === displaySrc;
            traceCover(coverTrace, "COVER_IMAGE_LOAD_FAILURE", displaySrc, "failed", current ? "image_error" : "stale_callback", current);
            markImageLoadFailed(displaySrc);
            if (current && displaySrc && !usedFallback) onSourceErrorRef.current?.(displaySrc);
            const safeFallback =
              resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
            if (
              usedFallback ||
              !safeFallback ||
              displaySrc === safeFallback ||
              isImageLoadFailed(safeFallback)
            ) {
              setLoaded(true);
              return;
            }
            traceCover(coverTrace, "COVER_FALLBACK_APPLIED", safeFallback, "fallback", "image_error", current);
            setUsedFallback(true);
            setDisplaySrc(safeFallback);
            setLoaded(false);
          }}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : !signing && !loading && fallbackSrc ? (
        <img
          src={preferJpegPngImageUrl(fallbackSrc) ?? fallbackSrc}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          draggable={false}
          className={cn("h-full w-full object-cover opacity-100", imgClassName)}
        />
      ) : null}
    </div>
  );
}
