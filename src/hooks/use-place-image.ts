import { useEffect, useRef, useState } from "react";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getPlaceImage } from "@/services/placeImageService";
import { extractGooglePlacePhotoName, resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { logPerfImageLoad } from "@/lib/app-perf";
import { getSignedPlacePhotoUrl, readSignedPlacePhotoUrl } from "@/services/signed-place-photo";
import { isUnsignedPlacePhotoProxyUrl } from "@/services/image-cache";

type Options = PlaceImageInput & {
  /** 若已有 Google 封面 URL，跳過 async 解析 */
  initialUrl?: string | null;
  /** false = 延後載入（viewport lazy） */
  enabled?: boolean;
  /** 用於 [PERF_IMAGE_LOAD] */
  perfPage?: string;
};

/** 非 Google photo 的既有 URL 才可直接顯示；未簽名 proxy 一律回 null（交由簽名或預設圖）。 */
function resolveDirectDisplayUrl(url: string): string | null {
  const resolved = resolvePlaceImageUrl(url);
  return resolved && !isUnsignedPlacePhotoProxyUrl(resolved) ? resolved : null;
}

export function usePlaceImage(options: Options): {
  url: string | null;
  loading: boolean;
  source: string | null;
} {
  const { initialUrl, enabled = true, perfPage, ...input } = options;
  const immediateUrl =
    initialUrl && !extractGooglePlacePhotoName(initialUrl)
      ? resolveDirectDisplayUrl(initialUrl)
      : readSignedPlacePhotoUrl(input.photoName || initialUrl || "", input.photoWidth ?? 600);
  const [url, setUrl] = useState<string | null>(immediateUrl);
  const [loading, setLoading] = useState(!immediateUrl && enabled);
  const [source, setSource] = useState<string | null>(initialUrl ? "google" : null);
  const versionRef = useRef(0);
  const loggedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    if (immediateUrl) {
      setUrl(immediateUrl);
      setSource(initialUrl && !extractGooglePlacePhotoName(initialUrl) ? "existing" : "google");
      setLoading(false);
      return;
    }

    if (initialUrl) {
      const version = ++versionRef.current;
      setLoading(true);
      void getSignedPlacePhotoUrl(initialUrl, input.photoWidth ?? 600)
        .then((signed) => {
          if (version !== versionRef.current) return;
          setUrl(
            signed ??
              (!extractGooglePlacePhotoName(initialUrl) ? resolveDirectDisplayUrl(initialUrl) : null),
          );
          setSource(signed ? "google" : "existing");
          setLoading(false);
          if (!loggedRef.current) {
            loggedRef.current = true;
            logPerfImageLoad(perfPage ?? "place-image", 1, signed ? "google" : "existing");
          }
        })
        .catch(() => {
          if (version !== versionRef.current) return;
          setUrl(null);
          setLoading(false);
        });
      return () => {
        if (versionRef.current === version) versionRef.current += 1;
      };
    }

    loggedRef.current = false;
    const version = ++versionRef.current;
    setLoading(true);
    setUrl(null);

    void getPlaceImage(input)
      .then(async (result) => {
        if (version !== versionRef.current) return;
        // 非 google 來源（例如 runtime／持久化快取的舊 proxy URL）若可解析出 photo name，同樣先簽名。
        const photoSource =
          result.source === "google"
            ? (input.photoName ?? result.url)
            : extractGooglePlacePhotoName(result.url)
              ? result.url
              : null;
        const signed = photoSource
          ? await getSignedPlacePhotoUrl(photoSource, input.photoWidth ?? 600)
          : null;
        if (version !== versionRef.current) return;
        setUrl(
          signed ??
            (photoSource
              ? null
              : (resolveDirectDisplayUrl(result.url) ??
                (isUnsignedPlacePhotoProxyUrl(result.url) ? null : result.url))),
        );
        setSource(result.source);
        setLoading(false);
        if (!loggedRef.current) {
          loggedRef.current = true;
          logPerfImageLoad(perfPage ?? "place-image", 1, result.source ?? "unknown");
        }
      })
      .catch(() => {
        if (version !== versionRef.current) return;
        setUrl(null);
        setSource(null);
        setLoading(false);
      });

    return () => {
      versionRef.current++;
    };
    // PlaceImageInput is reconstructed from props; track its scalar fields so a
    // render-created object identity does not restart photo loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    immediateUrl,
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
