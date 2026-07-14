import { useEffect, useRef, useState } from "react";
import { recordPlacesPhotoUrlLoad } from "@/lib/places-api-stats";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { stripMediaUrlQuery } from "@/lib/media-display-url";
import {
  getLocalPlaceImageFallback,
  preferJpegPngImageUrl,
  resolvePlaceImageUrl,
} from "@/lib/safe-image-url";
import { cn } from "@/lib/utils";

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
  src: string | null | undefined;
  alt?: string;
  loading?: boolean;
  className?: string;
  imgClassName?: string;
  fallbackSrc?: string | null;
  /** Prefer eager decode for above-the-fold covers */
  priority?: boolean;
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
}: Props) {
  const stable = src ? stableSrcKey(src) : "";
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedSrcCache.has(stable)));
  const [displaySrc, setDisplaySrc] = useState(src ?? null);
  const [usedFallback, setUsedFallback] = useState(false);
  const prevStable = useRef(stable);

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      setDisplaySrc(
        fallbackSrc
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
      src.startsWith("blob:") || src.startsWith("data:")
        ? src
        : resolvePlaceImageUrl(src);
    if (!safeSrc || isImageLoadFailed(safeSrc)) {
      const safeFallback =
        resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
      if (safeFallback && !isImageLoadFailed(safeFallback)) {
        setDisplaySrc(safeFallback);
        setUsedFallback(true);
        setLoaded(loadedSrcCache.has(stableSrcKey(safeFallback)));
        return;
      }
      setDisplaySrc(null);
      setUsedFallback(false);
      setLoaded(true);
      return;
    }
    setDisplaySrc(safeSrc);
    setUsedFallback(false);
    setLoaded(loadedSrcCache.has(nextStable) || loadedSrcCache.has(safeSrc));
  }, [src, fallbackSrc]);

  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {(loading || (displaySrc && !loaded)) && (
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
          onLoad={() => {
            if (displaySrc) {
              loadedSrcCache.add(displaySrc);
              loadedSrcCache.add(stableSrcKey(displaySrc));
              recordPlacesPhotoUrlLoad(displaySrc);
            }
            setLoaded(true);
          }}
          onError={() => {
            markImageLoadFailed(displaySrc);
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
      ) : fallbackSrc ? (
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
