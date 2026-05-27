import { useState } from "react";
import { PlaceImage } from "@/components/media/PlaceImage";
import { isLocalhostAppApiUrl } from "@/lib/api-base-url";
import { preferNonWebpImageUrl } from "@/lib/safe-image-url";
import type { PlaceImageInput } from "@/services/placeImageService";
import { cn } from "@/lib/utils";

export function sanitizePlaceCardPhotoUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  if (isLocalhostAppApiUrl(url)) return null;
  return preferNonWebpImageUrl(url);
}

type Props = PlaceImageInput & {
  coverImageUrl?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
  preferRoamieScene?: boolean;
  onGoogleLoad?: () => void;
  onGoogleError?: () => void;
};

/** Google 封面優先；載入失敗或無效 URL 時改 PlaceImage（Unsplash / Roamie 預設） */
export function PlaceCardCover({
  coverImageUrl,
  className,
  imgClassName,
  alt = "",
  preferRoamieScene,
  onGoogleLoad,
  onGoogleError,
  ...input
}: Props) {
  const [googleFailed, setGoogleFailed] = useState(false);
  const googleImg = sanitizePlaceCardPhotoUrl(coverImageUrl);

  if (googleImg && !googleFailed) {
    return (
      <img
        src={googleImg}
        alt={alt}
        loading="lazy"
        draggable={false}
        className={cn("h-full w-full object-cover", imgClassName)}
        onLoad={onGoogleLoad}
        onError={() => {
          setGoogleFailed(true);
          onGoogleError?.();
        }}
      />
    );
  }

  return (
    <PlaceImage
      {...input}
      preferRoamieScene={preferRoamieScene}
      alt={alt}
      className={className}
      imgClassName={imgClassName}
    />
  );
}
