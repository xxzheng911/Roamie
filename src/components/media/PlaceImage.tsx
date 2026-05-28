import type { PlaceImageInput } from "@/services/placeImageService";
import { usePlaceImage } from "@/hooks/use-place-image";
import { FadeInImage } from "@/components/media/FadeInImage";
import { cn } from "@/lib/utils";

type Props = PlaceImageInput & {
  initialUrl?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
};

/** 附近地點卡片圖：Google → AI → 分類預設 */
export function PlaceImage({
  initialUrl,
  className,
  imgClassName,
  alt = "",
  ...input
}: Props) {
  const { url, loading } = usePlaceImage({ ...input, initialUrl });

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
