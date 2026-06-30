import { useEffect, useRef, useState } from "react";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getPlaceImage } from "@/services/placeImageService";
import { resolvePlaceImageUrl } from "@/lib/safe-image-url";
import { logPerfImageLoad } from "@/lib/app-perf";

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
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
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
      setUrl(resolvePlaceImageUrl(initialUrl) ?? null);
      setSource("google");
      setLoading(false);
      if (!loggedRef.current) {
        loggedRef.current = true;
        logPerfImageLoad(perfPage ?? "place-image", 1, "google");
      }
      return;
    }

    loggedRef.current = false;
    const version = ++versionRef.current;
    setLoading(true);

    void getPlaceImage(input).then((result) => {
      if (version !== versionRef.current) return;
      setUrl(resolvePlaceImageUrl(result.url) ?? result.url);
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
  ]);

  return { url, loading, source };
}
