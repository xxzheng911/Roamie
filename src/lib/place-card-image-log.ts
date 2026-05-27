import type { ImageSource } from "@/services/placeImageService";
import { placeSceneCategoryLabel } from "@/lib/place-scene-fallback";

export function logPlaceCardImage(
  placeName: string,
  options: {
    categoryId?: string;
    primaryType?: string | null;
    types?: string[] | null;
    imageSource: ImageSource | string;
  },
): void {
  const category = placeSceneCategoryLabel(placeName, {
    categoryId: options.categoryId,
    primaryType: options.primaryType,
    types: options.types,
  });
  console.info(
    "[PLACE_CARD_IMAGE] placeName=",
    placeName,
    "category=",
    category,
    "imageSource=",
    options.imageSource,
  );
}
