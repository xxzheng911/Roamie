import { resolveTripCoverUrl, type TripCoverFields } from "@/lib/saved-trip/cover";
import { FadeInImage } from "@/components/media/FadeInImage";
import { cn } from "@/lib/utils";

type Props = TripCoverFields & {
  loading?: boolean;
  className?: string;
  imgClassName?: string;
  alt?: string;
  /** 優先使用統一 displayCoverImage */
  displayCoverImage?: string;
  /** @deprecated 請改用 coverImageUrl / aiGeneratedCoverImageUrl */
  src?: string | null;
  category?: string | null;
};

/** 行程封面圖：自訂 → 預設 → AI → Roamie 預設 */
export function TripCoverImage({
  src,
  displayCoverImage,
  coverImageUrl,
  aiGeneratedCoverImageUrl,
  isCoverCustomized,
  customCoverImageUrl,
  coverSource,
  mood,
  category,
  loading,
  className,
  imgClassName,
  alt = "",
}: Props) {
  const resolved =
    displayCoverImage?.trim() ||
    (coverImageUrl != null ||
    aiGeneratedCoverImageUrl != null ||
    customCoverImageUrl != null ||
    isCoverCustomized != null
      ? resolveTripCoverUrl({
          coverImageUrl,
          aiGeneratedCoverImageUrl,
          customCoverImageUrl,
          isCoverCustomized: Boolean(isCoverCustomized),
          mood: mood ?? category,
        })
      : src?.trim() || resolveTripCoverUrl({ mood: mood ?? category }));

  return (
    <FadeInImage
      src={resolved}
      alt={alt}
      loading={loading}
      className={cn("h-full w-full", className)}
      imgClassName={imgClassName}
    />
  );
}
