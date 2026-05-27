import { useEffect, useRef, useState } from "react";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getPlaceImage } from "@/services/placeImageService";

type Options = PlaceImageInput & {
  /** 若已有 Google 封面 URL，跳過 async 解析 */
  initialUrl?: string | null;
};

export function usePlaceImage(options: Options): {
  url: string | null;
  loading: boolean;
  source: string | null;
} {
  const { initialUrl, ...input } = options;
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [loading, setLoading] = useState(!initialUrl);
  const [source, setSource] = useState<string | null>(initialUrl ? "google" : null);
  const versionRef = useRef(0);

  useEffect(() => {
    if (initialUrl) {
      setUrl(initialUrl);
      setSource("google");
      setLoading(false);
      return;
    }

    const version = ++versionRef.current;
    setLoading(true);

    void getPlaceImage(input).then((result) => {
      if (version !== versionRef.current) return;
      setUrl(result.url);
      setSource(result.source);
      setLoading(false);
    });

    return () => {
      versionRef.current++;
    };
  }, [
    initialUrl,
    input.name,
    input.photoName,
    input.categoryId,
    input.category,
    input.city,
    input.primaryType,
  ]);

  return { url, loading, source };
}
