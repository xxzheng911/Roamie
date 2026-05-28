import type { PlaceImageSource } from "@/services/placeImageService";

export function logPlaceImage(
  placeName: string,
  fields: {
    googlePhotoFound: boolean;
    unsplashUsed: boolean;
    source: PlaceImageSource | string;
  },
): void {
  console.info(
    "[PLACE_IMAGE] placeName=",
    placeName,
    "googlePhotoFound=",
    fields.googlePhotoFound,
    "unsplashUsed=",
    fields.unsplashUsed,
    "source=",
    fields.source,
  );
}
