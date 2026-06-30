import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import {
  getLocalPlaceImageFallback,
  resolvePlaceImageUrl,
} from "@/lib/safe-image-url";
import { cn } from "@/lib/utils";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackSrc?: string | null;
  maxWidth?: number;
};

/** Google / 遠端 URL 直載；僅 onError 時 fallback，不 preemptive 攔截 Google photo */
export function SafeImage({ src, fallbackSrc, onError, className, maxWidth, ...rest }: Props) {
  const fallback =
    resolvePlaceImageUrl(fallbackSrc ?? null, { maxWidth }) ?? getLocalPlaceImageFallback();

  const primary = resolvePlaceImageUrl(typeof src === "string" ? src : null, { maxWidth });

  const initialSrc =
    primary && !isImageLoadFailed(primary)
      ? primary
      : !isImageLoadFailed(fallback)
        ? fallback
        : fallback;

  const [displaySrc, setDisplaySrc] = useState(initialSrc);
  const [usedFallback, setUsedFallback] = useState(!primary || isImageLoadFailed(primary));

  useEffect(() => {
    const safePrimary = resolvePlaceImageUrl(typeof src === "string" ? src : null, { maxWidth });
    if (safePrimary && !isImageLoadFailed(safePrimary)) {
      setDisplaySrc(safePrimary);
      setUsedFallback(false);
      return;
    }
    setDisplaySrc(fallback);
    setUsedFallback(true);
  }, [src, fallback, maxWidth]);

  return (
    <img
      {...rest}
      src={displaySrc}
      loading="lazy"
      decoding="async"
      className={cn(className)}
      onError={(event) => {
        markImageLoadFailed(displaySrc);
        if (!usedFallback && displaySrc !== fallback && !isImageLoadFailed(fallback)) {
          setUsedFallback(true);
          setDisplaySrc(fallback);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
