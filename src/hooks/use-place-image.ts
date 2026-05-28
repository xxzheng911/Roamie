import { useEffect, useRef, useState } from "react";
import { logPlaceImage } from "@/lib/place-image/place-image-log";
import type { PlaceImageInput } from "@/services/placeImageService";
import { getPlaceImage } from "@/services/placeImageService";

type Options = PlaceImageInput & {
  initialUrl?: string | null;
  /** @deprecated 已不再跳過 AI */
  preferRoamieScene?: boolean;
};

export function usePlaceImage(options: Options): {
  url: string | null;
  loading: boolean;
  source: string | null;
} {
  const { initialUrl, preferRoamieScene: _preferRoamieScene, ...input } = options;
  const [url, setUrl] = useState<string | null>(initialUrl ?? null);
  const [loading, setLoading] = useState(!initialUrl);
  const [source, setSource] = useState<string | null>(initialUrl ? "google" : null);
  const versionRef = useRef(0);

  useEffect(() => {
    if (initialUrl && !/\.webp(\?|#|$)/i.test(initialUrl)) {
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
      logPlaceImage(input.name, {
        googlePhotoFound: result.source === "google",
        unsplashUsed: result.source === "unsplash",
        source: result.source,
      });
    });

    return () => {
      versionRef.current++;
    };
  }, [
    initialUrl,
    input.placeId,
    input.name,
    input.photoName,
    input.categoryId,
    input.category,
    input.city,
    input.country,
    input.primaryType,
  ]);

  return { url, loading, source };
}
