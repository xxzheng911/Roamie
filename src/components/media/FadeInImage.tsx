import { useEffect, useState } from "react";
import { recordPlacesPhotoUrlLoad } from "@/lib/places-api-stats";
import { cn } from "@/lib/utils";

const loadedSrcCache =
  (globalThis as { __roamieLoadedImages?: Set<string> }).__roamieLoadedImages ?? new Set<string>();
(globalThis as { __roamieLoadedImages?: Set<string> }).__roamieLoadedImages = loadedSrcCache;

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
      setDisplaySrc(null);
      setUsedFallback(false);
      return;
    }
    setDisplaySrc(src);
    setUsedFallback(false);
    setLoaded(loadedSrcCache.has(src));
  }, [src]);

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
            if (usedFallback || !fallbackSrc || displaySrc === fallbackSrc) {
              setLoaded(true);
              return;
            }
            setUsedFallback(true);
            setDisplaySrc(fallbackSrc);
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
          src={fallbackSrc}
          alt={alt}
          loading="lazy"
          draggable={false}
          className={cn("h-full w-full object-cover opacity-100", imgClassName)}
        />
      ) : null}
    </div>
  );
}
