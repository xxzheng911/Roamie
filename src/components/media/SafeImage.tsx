import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { acceptImageError, acceptImageLoad } from "@/lib/safe-image-load";
import { getLocalPlaceImageFallback, resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { cn } from "@/lib/utils";
import { extractGooglePlacePhotoName } from "@/lib/safe-image-url";
import { getSignedPlacePhotoUrl } from "@/services/signed-place-photo";

export type SafeImageVisualState = "loading" | "ready" | "fallback";

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  fallbackSrc?: string | null;
  maxWidth?: number;
  /** Parent may paint its own skeleton. SafeImage stays generic. */
  onVisualStateChange?: (state: SafeImageVisualState) => void;
};

/** Google photo stays hidden until the signed URL's img fires onLoad. */
export function SafeImage(props: Props) {
  // Reset before paint, including when a caller reuses SafeImage for another source.
  const sourceKey = JSON.stringify([props.src, props.fallbackSrc, props.maxWidth]);
  return <SafeImageSource key={sourceKey} {...props} />;
}

function SafeImageSource({
  src,
  fallbackSrc,
  onError,
  onLoad,
  onVisualStateChange,
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

  const initialVisual: SafeImageVisualState = requiresSignature
    ? "loading"
    : primary && !isImageLoadFailed(primary)
      ? "loading"
      : "fallback";
  const initialSrc = requiresSignature
    ? null
    : primary && !isImageLoadFailed(primary)
      ? primary
      : fallback;

  const [displaySrc, setDisplaySrc] = useState<string | null>(initialSrc);
  const [imageReady, setImageReady] = useState(initialVisual !== "loading");
  const [visual, setVisual] = useState<SafeImageVisualState>(initialVisual);
  const [loadToken, setLoadToken] = useState(0);
  const generationRef = useRef(0);
  const displaySrcRef = useRef<string | null>(initialSrc);
  const loadTokenRef = useRef(0);
  const usedFallbackRef = useRef(initialVisual === "fallback");
  const activeRef = useRef(true);
  const onVisualStateChangeRef = useRef(onVisualStateChange);
  onVisualStateChangeRef.current = onVisualStateChange;

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    onVisualStateChangeRef.current?.(visual);
  }, [visual]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const photoName = typeof src === "string" ? extractGooglePlacePhotoName(src) : null;
    if (photoName) {
      displaySrcRef.current = null;
      usedFallbackRef.current = false;
      setDisplaySrc(null);
      setImageReady(false);
      setVisual("loading");
      let cancelled = false;
      void getSignedPlacePhotoUrl(photoName, maxWidth ?? 600).then((signed) => {
        if (cancelled || generationRef.current !== generation) return;
        if (signed && !isImageLoadFailed(signed)) {
          displaySrcRef.current = signed;
          loadTokenRef.current = generation;
          usedFallbackRef.current = false;
          setLoadToken(generation);
          setDisplaySrc(signed);
          setImageReady(false);
          setVisual("loading");
          return;
        }
        displaySrcRef.current = fallback;
        loadTokenRef.current = generation;
        usedFallbackRef.current = true;
        setLoadToken(generation);
        setDisplaySrc(fallback);
        setImageReady(true);
        setVisual("fallback");
      });
      return () => {
        cancelled = true;
      };
    }

    const safePrimary = resolvePlaceImageUrl(typeof src === "string" ? src : null, { maxWidth });
    if (safePrimary && !isImageLoadFailed(safePrimary)) {
      displaySrcRef.current = safePrimary;
      loadTokenRef.current = generation;
      usedFallbackRef.current = false;
      setLoadToken(generation);
      setDisplaySrc(safePrimary);
      // Initial state already waits for onLoad; do not undo an early cached load.
      return;
    }

    displaySrcRef.current = fallback;
    loadTokenRef.current = generation;
    usedFallbackRef.current = true;
    setLoadToken(generation);
    setDisplaySrc(fallback);
    setImageReady(true);
    setVisual("fallback");
  }, [src, fallback, maxWidth]);

  return (
    <img
      {...rest}
      key={displaySrc ?? "pending"}
      src={displaySrc ?? undefined}
      data-load-token={loadToken}
      data-safe-image-state={visual}
      loading={loading}
      decoding="async"
      className={cn(
        className,
        "transition-opacity duration-300 ease-out",
        imageReady ? "opacity-100" : "opacity-0",
      )}
      onLoad={(event) => {
        if (!activeRef.current || !event.currentTarget.isConnected) return;
        const elementToken = Number(event.currentTarget.dataset.loadToken);
        if (
          !acceptImageLoad({
            eventToken: elementToken,
            activeToken: loadTokenRef.current,
            eventSrc: event.currentTarget.currentSrc || event.currentTarget.src,
            expectedSrc: displaySrcRef.current,
          })
        ) {
          return;
        }
        if (requiresSignature) {
          console.info("[PLACE_PHOTO_IMAGE]", {
            placeId: extractGooglePlacePhotoName(rawSrc ?? "")?.split("/")[1] ?? null,
            surface: "safe-image",
            imageLoadSucceeded: !usedFallbackRef.current,
            imageLoadFailed: false,
            fallbackLoaded: usedFallbackRef.current,
          });
        }
        setImageReady(true);
        setVisual(usedFallbackRef.current ? "fallback" : "ready");
        onLoad?.(event);
      }}
      onError={(event) => {
        if (
          !activeRef.current ||
          !event.currentTarget.isConnected ||
          event.currentTarget.getAttribute("src") !== displaySrcRef.current
        )
          return;
        const elementToken = Number(event.currentTarget.dataset.loadToken);
        if (!acceptImageError({ eventToken: elementToken, activeToken: loadTokenRef.current })) {
          return;
        }
        if (requiresSignature) {
          console.info("[PLACE_PHOTO_IMAGE]", {
            placeId: extractGooglePlacePhotoName(rawSrc ?? "")?.split("/")[1] ?? null,
            surface: "safe-image",
            imageLoadSucceeded: false,
            imageLoadFailed: true,
            fallbackReason: "image_element_error",
          });
        }
        markImageLoadFailed(displaySrcRef.current);
        if (
          !usedFallbackRef.current &&
          displaySrcRef.current !== fallback &&
          !isImageLoadFailed(fallback)
        ) {
          displaySrcRef.current = fallback;
          loadTokenRef.current = generationRef.current;
          usedFallbackRef.current = true;
          setLoadToken(generationRef.current);
          setDisplaySrc(fallback);
          setImageReady(true);
          setVisual("fallback");
          return;
        }
        setImageReady(true);
        setVisual("fallback");
        onError?.(event);
      }}
    />
  );
}
