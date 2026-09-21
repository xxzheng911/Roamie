import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { getLocalPlaceImageFallback, resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { cn } from "@/lib/utils";
import { extractGooglePlacePhotoName } from "@/lib/safe-image-url";
import { getSignedPlacePhotoUrl } from "@/services/signed-place-photo";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackSrc?: string | null;
  maxWidth?: number;
};

/** Google / 遠端 URL 直載；僅 onError 時 fallback，不 preemptive 攔截 Google photo */
export function SafeImage({
  src,
  fallbackSrc,
  onError,
  onLoad,
  className,
  maxWidth,
  loading = "lazy",
  ...rest
}: Props) {
  const fallback =
    resolvePlaceImageUrl(fallbackSrc ?? null, { maxWidth }) ?? getLocalPlaceImageFallback();

  const rawSrc = typeof src === "string" ? src : null;
  const requiresSignature = Boolean(rawSrc && extractGooglePlacePhotoName(rawSrc));
  const primary = requiresSignature ? null : resolvePlaceImageUrl(rawSrc, { maxWidth });

  const initialSrc =
    primary && !isImageLoadFailed(primary) ? primary : requiresSignature ? null : fallback;

  const [displaySrc, setDisplaySrc] = useState<string | null>(initialSrc);
  const [usedFallback, setUsedFallback] = useState(!requiresSignature && !primary);
  const [resolvingSignature, setResolvingSignature] = useState(requiresSignature);

  useEffect(() => {
    const safePrimary = resolvePlaceImageUrl(typeof src === "string" ? src : null, { maxWidth });
    const photoName = typeof src === "string" ? extractGooglePlacePhotoName(src) : null;
    if (photoName) {
      let cancelled = false;
      setDisplaySrc(null);
      setUsedFallback(false);
      setResolvingSignature(true);
      void getSignedPlacePhotoUrl(photoName, maxWidth ?? 600).then((signed) => {
        if (cancelled) return;
        if (signed && !isImageLoadFailed(signed)) {
          setDisplaySrc(signed);
          setUsedFallback(false);
        } else {
          setDisplaySrc(fallback);
          setUsedFallback(true);
        }
        setResolvingSignature(false);
      });
      return () => {
        cancelled = true;
      };
    }
    if (safePrimary && !isImageLoadFailed(safePrimary)) {
      setDisplaySrc(safePrimary);
      setUsedFallback(false);
      setResolvingSignature(false);
      return;
    }
    setDisplaySrc(fallback);
    setUsedFallback(true);
    setResolvingSignature(false);
  }, [src, fallback, maxWidth]);

  return (
    <img
      {...rest}
      src={displaySrc ?? undefined}
      loading={loading}
      decoding="async"
      className={cn(resolvingSignature && "opacity-0", className)}
      onLoad={(event) => {
        if (requiresSignature) console.info("[PLACE_PHOTO_IMAGE]", {
          placeId: extractGooglePlacePhotoName(rawSrc ?? "")?.split("/")[1] ?? null,
          surface: "safe-image", imageLoadSucceeded: !usedFallback,
          imageLoadFailed: false, fallbackLoaded: usedFallback,
        });
        onLoad?.(event);
      }}
      onError={(event) => {
        if (requiresSignature) console.info("[PLACE_PHOTO_IMAGE]", {
          placeId: extractGooglePlacePhotoName(rawSrc ?? "")?.split("/")[1] ?? null,
          surface: "safe-image", imageLoadSucceeded: false,
          imageLoadFailed: true, fallbackReason: "image_element_error",
        });
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
