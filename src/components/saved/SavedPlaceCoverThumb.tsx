import { useCallback, useEffect, useRef, useState } from "react";
import {
  isRoamieDefaultImageUrl,
  resolveSavedPlaceGooglePlaceId,
  resolveSavedPlacePhotoResource,
} from "@/lib/saved-place-utils";
import { readPlaceRuntimeCache } from "@/lib/place-runtime-cache";
import {
  readRefreshedSavedPlacePhotoName,
  refreshSavedPlacePhotoName,
} from "@/lib/saved-place-photo-refresh";
import { extractGooglePlacePhotoName } from "@/lib/safe-image-url";
import { PlaceImage } from "@/components/media/PlaceImage";
import { useInViewport } from "@/hooks/use-in-viewport";
import { getRoamieDefaultImage } from "@/services/placeImageService";
import { cn } from "@/lib/utils";
import type { SavedPlace } from "@/lib/places-storage";

type Props = {
  place: SavedPlace;
  className?: string;
  alt?: string;
};

export function SavedPlaceCoverThumb({ place, className, alt }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInViewport(containerRef, { rootMargin: "80px" });
  const placeId = resolveSavedPlaceGooglePlaceId(place);
  const [refreshedPhotoName, setRefreshedPhotoName] = useState<string | null>(() =>
    readRefreshedSavedPlacePhotoName(placeId),
  );
  const cached = placeId ? readPlaceRuntimeCache(placeId) : null;
  const photoName =
    refreshedPhotoName ?? cached?.photoName ?? resolveSavedPlacePhotoResource(place);
  const storedCover = cached?.coverImageUrl ?? (place.cover_image || place.image_url);
  // 有 Google placeId、沒有可用的 photo name，且封面只有 Roamie 預設圖或空白（使用者上傳／其他真實網址不算）。
  const needsPhotoLookup =
    Boolean(placeId) &&
    !photoName &&
    [cached?.coverImageUrl, place.cover_image, place.image_url].every(
      (url) => !url || isRoamieDefaultImageUrl(url),
    );
  const initialUrl = refreshedPhotoName
    ? null
    : needsPhotoLookup
      ? storedCover || getRoamieDefaultImage(place.category)
      : (cached?.coverImageUrl ?? (!photoName ? place.cover_image || place.image_url : null));

  // 收藏只有預設圖／無封面：進入畫面時以 placeId 查一次 Details（每個 placeId 每次執行最多一次）。
  useEffect(() => {
    if (!needsPhotoLookup || !inView) return;
    void refreshSavedPlacePhotoName(place).then((next) => {
      if (next) setRefreshedPhotoName(next);
    });
  }, [needsPhotoLookup, inView, place]);

  // 同 placeId 的另一筆收藏已在本次執行換新（僅採用本功能換新的名稱，不採用 runtime cache）：
  // 這筆 row 存的是過期名稱、或只有預設圖／空白時，對它寫回一次（走已換新分支，不查 Details）。
  const storedPhotoName = resolveSavedPlacePhotoResource(place);
  const adoptRefreshed = readRefreshedSavedPlacePhotoName(placeId);
  const needsPersistOnly =
    Boolean(adoptRefreshed) &&
    storedPhotoName !== adoptRefreshed &&
    (Boolean(storedPhotoName) ||
      [place.cover_image, place.image_url].every((url) => !url || isRoamieDefaultImageUrl(url)));
  useEffect(() => {
    if (!needsPersistOnly) return;
    void refreshSavedPlacePhotoName(place);
  }, [needsPersistOnly, place]);

  // 僅在 Google 照片實際載入失敗時，以 placeId 換新 photo name（每個 placeId 每次執行最多一次）。
  const handleImageError = useCallback(
    (failedSrc: string) => {
      if (!placeId) return;
      const failedPhotoName = extractGooglePlacePhotoName(failedSrc);
      if (!failedPhotoName) return;
      void refreshSavedPlacePhotoName(place, failedPhotoName).then((next) => {
        if (next) setRefreshedPhotoName(next);
      });
    },
    [place, placeId],
  );

  return (
    <div ref={containerRef} className={cn("h-full w-full", className)}>
      <PlaceImage
        initialUrl={initialUrl}
        placeId={placeId}
        name={place.name}
        photoName={photoName}
        primaryType={place.category}
        category={place.category ?? undefined}
        photoWidth={256}
        alt={alt ?? place.name}
        imgClassName="h-full w-full object-cover"
        lazy
        onImageError={handleImageError}
      />
    </div>
  );
}
