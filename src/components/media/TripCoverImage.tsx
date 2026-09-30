import { resolveTripCoverUrl, type TripCoverFields } from "@/lib/saved-trip/cover";
import { FadeInImage } from "@/components/media/FadeInImage";
import { cn } from "@/lib/utils";

type Props = TripCoverFields & {
  loading?: boolean;
  resolutionPending?: boolean;
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
  resolutionPending,
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

  if (resolutionPending && !isCoverCustomized) {
    return <div className={cn("relative overflow-hidden bg-secondary", className)} aria-busy="true">
      <div className="absolute inset-0 animate-pulse bg-secondary/80" aria-hidden />
    </div>;
  }

  return (
    <FadeInImage
      src={resolved}
      alt={alt}
      loading={loading}
      priority
      waitForDecode
      className={cn("h-full w-full", className)}
      imgClassName={imgClassName}
    />
  );
}
