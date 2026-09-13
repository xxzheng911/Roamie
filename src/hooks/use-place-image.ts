import { useEffect, useRef, useState } from "react";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getPlaceImage } from "@/services/placeImageService";
import { extractGooglePlacePhotoName, resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { logPerfImageLoad } from "@/lib/app-perf";
import { getSignedPlacePhotoUrl } from "@/services/signed-place-photo";

type Options = PlaceImageInput & {
  /** 若已有 Google 封面 URL，跳過 async 解析 */
  initialUrl?: string | null;
  /** false = 延後載入（viewport lazy） */
  enabled?: boolean;
  /** 用於 [PERF_IMAGE_LOAD] */
  perfPage?: string;
};

export function usePlaceImage(options: Options): {
  url: string | null;
  loading: boolean;
  source: string | null;
} {
  const { initialUrl, enabled = true, perfPage, ...input } = options;
  const [url, setUrl] = useState<string | null>(
    initialUrl && !extractGooglePlacePhotoName(initialUrl) ? initialUrl : null,
  );
  const [loading, setLoading] = useState(!initialUrl && enabled);
  const [source, setSource] = useState<string | null>(initialUrl ? "google" : null);
  const versionRef = useRef(0);
  const loggedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    if (initialUrl) {
      const version = ++versionRef.current;
      setLoading(true);
      void getSignedPlacePhotoUrl(initialUrl, input.photoWidth ?? 600).then((signed) => {
        if (version !== versionRef.current) return;
        setUrl(signed ?? resolvePlaceImageUrl(initialUrl) ?? null);
        setSource(signed ? "google" : "existing");
        setLoading(false);
        if (!loggedRef.current) {
          loggedRef.current = true;
          logPerfImageLoad(perfPage ?? "place-image", 1, signed ? "google" : "existing");
        }
      });
      return () => {
        if (versionRef.current === version) versionRef.current += 1;
      };
    }

    loggedRef.current = false;
    const version = ++versionRef.current;
    setLoading(true);

    void getPlaceImage(input).then(async (result) => {
      if (version !== versionRef.current) return;
      const signed =
        result.source === "google"
          ? await getSignedPlacePhotoUrl(input.photoName ?? result.url, input.photoWidth ?? 600)
          : null;
      if (version !== versionRef.current) return;
      setUrl(
        signed ??
          (result.source === "google" ? null : (resolvePlaceImageUrl(result.url) ?? result.url)),
      );
      setSource(result.source);
      setLoading(false);
      if (!loggedRef.current) {
        loggedRef.current = true;
        logPerfImageLoad(perfPage ?? "place-image", 1, result.source ?? "unknown");
      }
    });

    return () => {
      versionRef.current++;
    };
    // PlaceImageInput is reconstructed from props; track its scalar fields so a
    // render-created object identity does not restart photo loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    initialUrl,
    perfPage,
    input.placeId,
    input.name,
    input.photoName,
    input.categoryId,
    input.category,
    input.city,
    input.primaryType,
    input.types,
    input.photoWidth,
  ]);

  return { url, loading, source };
}
