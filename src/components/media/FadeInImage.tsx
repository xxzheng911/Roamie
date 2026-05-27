import { useEffect, useState } from "react";
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
};

/** 帶 loading skeleton 與淡入動畫的圖片 */
export function FadeInImage({ src, alt = "", loading, className, imgClassName }: Props) {
  const [loaded, setLoaded] = useState(() => Boolean(src && loadedSrcCache.has(src)));

  useEffect(() => {
    if (!src) {
      setLoaded(false);
      return;
    }
    setLoaded(loadedSrcCache.has(src));
  }, [src]);

  return (
    <div className={cn("relative overflow-hidden bg-secondary", className)}>
      {(loading || (src && !loaded)) && (
        <div className="absolute inset-0 animate-pulse bg-secondary/80" aria-hidden />
      )}
      {src ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onLoad={() => {
            if (src) loadedSrcCache.add(src);
            setLoaded(true);
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
