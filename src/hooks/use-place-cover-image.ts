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

  useEffect(() => {
    failedRef.current = false;
    setFailed(false);
    if (!enabled) {
      setSrc(null);
      setLoading(false);
      return;
    }
    const photoResource =
      photoName?.trim() || (primaryUrl?.includes("/api/place-photo") ? primaryUrl : null);
    if (photoResource) {
      let cancelled = false;
      setSrc(null);
      setLoading(true);
      void getSignedPlacePhotoUrl(photoResource, width, { placeId: placeInput.placeId }).then((signed) => {
        if (cancelled) return;
        console.info("[PLACE_COVER_IMAGE_RESOLVED]", {
          placeId: placeInput.placeId ?? null,
          resolutionResult: signed ? "signed" : "fallback-after-retry",
        });
        if (signed) {
          if (persistedImageKey) setCachedImage(persistedImageKey, signed);
          setSrc(signed);
          logPerfImageLoad("place-cover", 1, "google");
        } else {
          setSrc(fallback);
          setFailed(true);
          setLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }
    if (primaryUrl) {
      setSrc(primaryUrl);
      setLoading(true);
      return;
    }
    setSrc(fallback);
    setLoading(false);
  }, [enabled, fallback, photoName, primaryUrl, persistedImageKey, width, placeInput.placeId]);

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
