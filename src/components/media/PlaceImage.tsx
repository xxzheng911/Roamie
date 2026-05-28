import type { PlaceImageInput } from "@/services/placeImageService";
import { usePlaceImage } from "@/hooks/use-place-image";
import { FadeInImage } from "@/components/media/FadeInImage";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

type Props = PlaceImageInput & {
  initialUrl?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
  onSourceChange?: (source: "google" | "unsplash" | "default" | null) => void;
};

/** 附近地點卡片圖：Google → AI → 分類預設 */
export function PlaceImage({
  initialUrl,
  className,
  imgClassName,
  alt = "",
  onSourceChange,
  ...input
}: Props) {
  const { url, loading, source } = usePlaceImage({ ...input, initialUrl });

  useEffect(() => {
    onSourceChange?.(source as "google" | "unsplash" | "default" | null);
  }, [onSourceChange, source]);

  return (
    <FadeInImage
      src={url}
      alt={alt}
      loading={loading}
      className={cn("h-full w-full", className)}
      imgClassName={imgClassName}
    />
  );
}
