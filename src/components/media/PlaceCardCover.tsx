import { useState } from "react";
import { PlaceImage } from "@/components/media/PlaceImage";
import { isLocalhostAppApiUrl } from "@/lib/api-base-url";
import { preferNonWebpImageUrl } from "@/lib/safe-image-url";
import { buildPlacePhotoCandidateUrls } from "@/lib/google-maps-client";
import { logPlacePhotoFallback, logPlacePhotoSource, logPlacePhotoUsed } from "@/lib/place-card-debug";
import type { PlaceImageInput } from "@/services/placeImageService";
import { cn } from "@/lib/utils";

export function sanitizePlaceCardPhotoUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  if (isLocalhostAppApiUrl(url)) return null;
  return preferNonWebpImageUrl(url);
}

type Props = PlaceImageInput & {
  coverImageUrl?: string | null;
  /** 多張 Google photo resource name（優先於 coverImageUrl） */
  photoNames?: string[];
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
  photoNames,
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
  const photoRefs = [
    ...(photoNames ?? []).map((n) => n.trim()).filter(Boolean),
    ...(input.photoName?.trim() ? [input.photoName.trim()] : []),
  ].filter((n, idx, arr) => arr.indexOf(n) === idx);
  /** photoName / photos 優先；不得讓 coverImageUrl 搶在 Google photo 前 */
  const googleCandidates = [
    ...photoRefs.flatMap((ref) =>
      buildPlacePhotoCandidateUrls(ref, 600).map((u) => sanitizePlaceCardPhotoUrl(u)),
    ),
    ...(photoRefs.length === 0 ? [sanitizePlaceCardPhotoUrl(coverImageUrl)] : []),
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
          logPlacePhotoUsed(input.name, input.placeId ?? "", sourceType);
          logPlacePhotoSource(
            { name: input.name, photoName: input.photoName, coverImageUrl },
            sourceType,
          );
          onImageSourceChange?.(sourceType);
          onGoogleLoad?.();
        }}
        onError={() => {
          const nextIdx = googleCandidateIndex + 1;
          if (nextIdx < googleCandidates.length) {
            setGoogleCandidateIndex(nextIdx);
            return;
          }
          logPlacePhotoFallback(input.name, input.placeId ?? "", "google_exhausted");
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
      onSourceChange={(source) => {
        const mapped = source === "unsplash" ? "unsplash" : source === "google" ? "google-photo" : "fallback";
        logPlacePhotoSource(
          { name: input.name, photoName: input.photoName, coverImageUrl },
          mapped,
        );
        onImageSourceChange?.(mapped);
      }}
    />
  );
}
