import { useEffect, useState } from "react";
import { recordPlacesPhotoUrlLoad } from "@/lib/places-api-stats";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { stripMediaUrlQuery } from "@/lib/media-display-url";
import { getLocalPlaceImageFallback, preferJpegPngImageUrl, resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { cn } from "@/lib/utils";

const loadedSrcCache =
  (globalThis as { __roamieLoadedImages?: Set<string> }).__roamieLoadedImages ?? new Set<string>();
(globalThis as { __roamieLoadedImages?: Set<string> }).__roamieLoadedImages = loadedSrcCache;

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
};

/** 帶 loading skeleton 與淡入動畫的圖片 */
export function FadeInImage({
  src,
  alt = "",
  loading,
  className,
  imgClassName,
  fallbackSrc,
}: Props) {
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedSrcCache.has(src)));
  const [displaySrc, setDisplaySrc] = useState(src ?? null);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      setDisplaySrc(fallbackSrc ? (resolvePlaceImageUrl(fallbackSrc) ?? getLocalPlaceImageFallback()) : null);
      setUsedFallback(false);
      return;
    }
    const safeSrc = resolvePlaceImageUrl(src);
    if (!safeSrc || isImageLoadFailed(safeSrc)) {
      const safeFallback = resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
      if (safeFallback && !isImageLoadFailed(safeFallback)) {
        setDisplaySrc(safeFallback);
        setUsedFallback(true);
        setLoaded(loadedSrcCache.has(safeFallback));
        return;
      }
      setDisplaySrc(null);
      setUsedFallback(false);
      setLoaded(true);
      return;
    }
    setDisplaySrc(safeSrc);
    setUsedFallback(false);
    setLoaded(loadedSrcCache.has(safeSrc));
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
          loading="lazy"
          draggable={false}
          onLoad={() => {
            if (displaySrc) {
              loadedSrcCache.add(displaySrc);
              recordPlacesPhotoUrlLoad(displaySrc);
            }
            setLoaded(true);
          }}
          onError={() => {
            markImageLoadFailed(displaySrc);
            const safeFallback = resolvePlaceImageUrl(fallbackSrc ?? null) ?? getLocalPlaceImageFallback();
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
            "h-full w-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : fallbackSrc ? (
        <img
          src={preferJpegPngImageUrl(fallbackSrc) ?? fallbackSrc}
          alt={alt}
          loading="lazy"
          draggable={false}
          className={cn("h-full w-full object-cover opacity-100", imgClassName)}
        />
      ) : null}
    </div>
  );
}
