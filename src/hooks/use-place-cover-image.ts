import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isImageLoadFailed, markImageLoadFailed } from "@/lib/image-url-failure-cache";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { resolvePlaceImageUrl } from "@/lib/safe-image-url";
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

  const primaryUrl = useMemo(() => {
    if (!enabled) return null;
    const raw =
      url?.trim() ||
      (photoName?.trim() ? (buildPlacePhotoUrl(photoName.trim(), width) ?? null) : null);
    return resolvePlaceImageUrl(raw, { maxWidth: width });
  }, [enabled, url, photoName, width]);

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
      setSrc(primaryUrl);
      setLoading(false);
      return;
    }
    setSrc(fallback);
    setLoading(false);
  }, [enabled, fallback, primaryUrl]);

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
