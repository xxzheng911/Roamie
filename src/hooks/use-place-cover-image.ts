import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { logPerfImageLoad } from "@/lib/app-perf";
import {
  cacheKey,
  getCachedImage,
  getRememberedPhotoUrl,
  rememberPhotoUrl,
  setCachedImage,
} from "@/services/image-cache";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getSignedPlacePhotoUrl } from "@/services/signed-place-photo";

type Options = PlaceImageInput & {
  url?: string | null;
  maxWidth?: number;
  /** false = 延後載入（viewport lazy） */
  enabled?: boolean;
};

/** Photo ref wins over a signed URL so a refreshed URL does not start a new load. */
export function placeCoverRequestIdentity(input: {
  placeId?: string | null;
  photoName?: string | null;
  url?: string | null;
}): string {
  const placeId = input.placeId?.trim() || "";
  const photoName = input.photoName?.trim() || "";
  if (photoName) return `${placeId}|${photoName}`;
  return `${placeId}|url:${input.url?.trim() || ""}`;
}

export function shouldRestartPlaceCoverLoad(input: {
  previousIdentity: string | null;
  nextIdentity: string;
  hasDisplayedImage: boolean;
}): boolean {
  if (input.hasDisplayedImage && input.previousIdentity === input.nextIdentity) return false;
  return true;
}

/**
 * 地點封面：img src = Google Places photo URL；僅 onError 時 fallback 本地圖。
 */
export function usePlaceCoverImage(options: Options): {
  src: string | null;
  onLoad: () => void;
  onError: () => void;
  loading: boolean;
  failed: boolean;
} {
  const { url, photoName, maxWidth, photoWidth, enabled = true, ...placeInput } = options;
  const width = maxWidth ?? photoWidth ?? 600;
  const fallback = getRoamieDefaultImage(placeInput.categoryId ?? placeInput.category);
  const failedRef = useRef(false);
  const persistedImageKey = placeInput.placeId?.trim()
    ? cacheKey("home-place-cover", placeInput.placeId.trim())
    : null;

  const primaryUrl = useMemo(() => {
    if (!enabled) return null;
    const rawFromProps = url?.trim() || null;
    if (rawFromProps) {
      const resolved = resolvePlaceImageUrl(rawFromProps, { maxWidth: width });
      if (resolved) return resolved;
    }
    const photo = photoName?.trim();
    if (photo) {
      const remembered = getRememberedPhotoUrl(photo, width);
      if (remembered) return remembered;
      const built = buildPlacePhotoUrl(photo, width);
      const resolved = resolvePlaceImageUrl(built, { maxWidth: width });
      if (resolved) {
        rememberPhotoUrl(photo, width, resolved);
        return resolved;
      }
    }
    if (persistedImageKey) return getCachedImage(persistedImageKey);
    return null;
  }, [enabled, url, photoName, width, persistedImageKey]);

  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && (photoName || primaryUrl)));
  const [failed, setFailed] = useState(false);
  const displayedRef = useRef<{ identity: string; src: string } | null>(null);
  const inflightIdentityRef = useRef<string | null>(null);
  const urlRef = useRef(url);
  const primaryUrlRef = useRef(primaryUrl);
  urlRef.current = url;
  primaryUrlRef.current = primaryUrl;
  const identity = placeCoverRequestIdentity({
    placeId: placeInput.placeId,
    photoName,
    url,
  });

  useEffect(() => {
    const displayed = displayedRef.current;
    if (
      !shouldRestartPlaceCoverLoad({
        previousIdentity: displayed?.identity ?? null,
        nextIdentity: identity,
        hasDisplayedImage: Boolean(displayed?.src),
      })
    ) {
      return;
    }
    if (!enabled) return;
    if (inflightIdentityRef.current === identity) return;

    failedRef.current = false;
    setFailed(false);
    const currentUrl = urlRef.current?.trim() || primaryUrlRef.current || null;
    const photoResource =
      photoName?.trim() || (currentUrl?.includes("/api/place-photo") ? currentUrl : null);
    if (photoResource) {
      let cancelled = false;
      inflightIdentityRef.current = identity;
      setSrc(null);
      setLoading(true);
      void getSignedPlacePhotoUrl(photoResource, width, { placeId: placeInput.placeId }).then((signed) => {
        if (cancelled || inflightIdentityRef.current !== identity) return;
        inflightIdentityRef.current = null;
        console.info("[PLACE_COVER_IMAGE_RESOLVED]", {
          placeId: placeInput.placeId ?? null,
          resolutionResult: signed ? "signed" : "fallback-after-retry",
        });
        if (signed) {
          if (persistedImageKey) setCachedImage(persistedImageKey, signed);
          displayedRef.current = { identity, src: signed };
          setSrc(signed);
          logPerfImageLoad("place-cover", 1, "google");
        } else {
          displayedRef.current = { identity, src: fallback };
          setSrc(fallback);
          setFailed(true);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
        if (inflightIdentityRef.current === identity) inflightIdentityRef.current = null;
      };
    }
    if (currentUrl) {
      displayedRef.current = { identity, src: currentUrl };
      setSrc(currentUrl);
      setLoading(true);
      return;
    }
    displayedRef.current = { identity, src: fallback };
    setSrc(fallback);
    setLoading(false);
  }, [enabled, fallback, identity, persistedImageKey, photoName, width, placeInput.placeId]);

  const onLoad = useCallback(() => {
    console.info("[PLACE_PHOTO_IMAGE]", {
      placeId: placeInput.placeId ?? null, imageLoadSucceeded: src !== fallback,
      imageLoadFailed: false, fallbackLoaded: src === fallback,
    });
    setLoading(false);
  }, [placeInput.placeId, src, fallback]);

  const onError = useCallback(() => {
    if (failedRef.current) return;
    failedRef.current = true;
    console.info("[PLACE_COVER_IMAGE_ERROR]", {
      placeId: placeInput.placeId ?? null, resolutionResult: "image-load-failed",
      imageLoadSucceeded: false, imageLoadFailed: true, fallbackReason: "image_element_error",
    });
    if (primaryUrl) markImageLoadFailed(primaryUrl);
    markImageLoadFailed(src);
    setSrc(fallback);
    setFailed(true);
    setLoading(false);
  }, [fallback, primaryUrl, src, placeInput.placeId]);

  return { src, onLoad, onError, loading, failed };
}
