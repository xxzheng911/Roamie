import { useEffect, useState } from "react";
import roamieDefaultCover from "@/assets/roamie-default-cover.png";
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
  fallbackSrc?: string;
};

/** 帶 loading skeleton 與淡入動畫的圖片 */
export function FadeInImage({
  src,
  alt = "",
  loading,
  className,
  imgClassName,
  fallbackSrc = roamieDefaultCover,
}: Props) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedSrcCache.has(src)));

  useEffect(() => {
    setDisplaySrc(src);
    if (!src) {
      setLoaded(false);
      return;
    }
    setLoaded(loadedSrcCache.has(src));
  }, [src]);

  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {(loading || (displaySrc && !loaded)) && (
        <div className="absolute inset-0 animate-pulse bg-secondary/80" aria-hidden />
      )}
      {displaySrc ? (
        <img
          key={displaySrc}
          src={displaySrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            if (displaySrc) loadedSrcCache.add(displaySrc);
            setLoaded(true);
          }}
          onError={() => {
            if (fallbackSrc && displaySrc !== fallbackSrc) {
              console.warn("[IMAGE] load failed, using fallback");
              setDisplaySrc(fallbackSrc);
              setLoaded(loadedSrcCache.has(fallbackSrc));
            } else {
              setLoaded(true);
            }
          }}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-500",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      ) : null}
    </div>
  );
}
