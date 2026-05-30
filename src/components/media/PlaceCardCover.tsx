import { useState } from "react";
import { PlaceImage } from "@/components/media/PlaceImage";
import { isLocalhostAppApiUrl } from "@/lib/api-base-url";
import { preferNonWebpImageUrl } from "@/lib/safe-image-url";
import { buildPlacePhotoCandidateUrls } from "@/lib/google-maps-client";
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
  /** @deprecated 已不再跳過 AI */
  preferRoamieScene?: boolean;
  onGoogleLoad?: () => void;
  onGoogleError?: () => void;
  onImageSourceChange?: (source: "google-photo" | "proxy-photo" | "unsplash" | "fallback") => void;
};

/** Google 封面優先；載入失敗或無效 URL 時改 PlaceImage（AI → 分類預設） */
export function PlaceCardCover({
  coverImageUrl,
  className,
  imgClassName,
  alt = "",
  preferRoamieScene,
  onGoogleLoad,
  onGoogleError,
  onImageSourceChange,
  ...input
}: Props) {
  const [googleCandidateIndex, setGoogleCandidateIndex] = useState(0);
  const [googleFailed, setGoogleFailed] = useState(false);
  const googleCandidates = [
    sanitizePlaceCardPhotoUrl(coverImageUrl),
    ...buildPlacePhotoCandidateUrls(input.photoName ?? "", 600).map((u) =>
      sanitizePlaceCardPhotoUrl(u),
    ),
  ].filter((u, idx, arr): u is string => Boolean(u) && arr.indexOf(u) === idx);
  const googleImg = googleCandidates[googleCandidateIndex] ?? null;

  if (googleImg && !googleFailed) {
    const sourceType = googleImg.includes("/api/place-photo") ? "proxy-photo" : "google-photo";
    return (
      <img
        src={googleImg}
        alt={alt}
        loading="lazy"
        draggable={false}
        className={cn("h-full w-full object-cover", imgClassName)}
        onLoad={() => {
          onImageSourceChange?.(sourceType);
          onGoogleLoad?.();
        }}
        onError={() => {
          const nextIdx = googleCandidateIndex + 1;
          if (nextIdx < googleCandidates.length) {
            setGoogleCandidateIndex(nextIdx);
            return;
          }
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
      onSourceChange={(source) =>
        onImageSourceChange?.(source === "unsplash" ? "unsplash" : "fallback")
      }
    />
  );
}
