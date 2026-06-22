import type { PlaceImageInput } from "@/services/placeImageService";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import { usePlaceImage } from "@/hooks/use-place-image";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import { FadeInImage } from "@/components/media/FadeInImage";
import { cn } from "@/lib/utils";

type Props = PlaceImageInput & {
  initialUrl?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
};

/** 附近地點卡片圖：Google → Unsplash → Roamie 預設 */
export function PlaceImage({
  initialUrl,
  className,
  imgClassName,
  alt = "",
  ...input
}: Props) {
  const { url, loading } = usePlaceImage({ ...input, initialUrl });
  const safeUrl = preferJpegPngImageUrl(url);
  const fallbackSrc = getRoamieDefaultImage(input.categoryId ?? input.category);

  return (
    <FadeInImage
      src={safeUrl}
      fallbackSrc={fallbackSrc}
      alt={alt}
      loading={loading}
      className={cn("h-full w-full", className)}
      imgClassName={imgClassName}
    />
  );
}
