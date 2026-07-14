import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { logPerfImageLoad } from "@/lib/app-perf";
import { cacheKey, getCachedImage, getRememberedPhotoUrl, rememberPhotoUrl, setCachedImage } from "@/services/image-cache";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import type { PlaceImageInput } from "@/services/placeImageService";

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
  src: string;
  onError: () => void;
  loading: boolean;
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

  const [src, setSrc] = useState(() => primaryUrl ?? fallback);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    failedRef.current = false;
    if (!enabled) {
      setSrc(fallback);
      setLoading(false);
      return;
    }
    if (primaryUrl) {
      if (persistedImageKey) setCachedImage(persistedImageKey, primaryUrl);
      setSrc(primaryUrl);
      setLoading(false);
      if (!failedRef.current) {
        logPerfImageLoad("place-cover", 1, "google");
      }
      return;
    }
    setSrc(fallback);
    setLoading(false);
  }, [enabled, fallback, primaryUrl, persistedImageKey]);

  const onError = useCallback(() => {
    if (failedRef.current) return;
    failedRef.current = true;
    if (primaryUrl) markImageLoadFailed(primaryUrl);
    markImageLoadFailed(src);
    setSrc(fallback);
    setLoading(false);
  }, [fallback, primaryUrl, src]);

  return { src, onError, loading };
}
