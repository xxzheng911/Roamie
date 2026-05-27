import {
  coverFieldsFromStored,
  resolveDisplayCoverImage,
  type TripCoverDisplayFields,
} from "@/lib/saved-trip/display";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import type { ImageSource } from "@/services/placeImageService";

export type TripCoverFields = TripCoverDisplayFields & {
  coverSource?: ImageSource | string | null;
};

/** @deprecated 請改用 coverFieldsFromStored + resolveDisplayCoverImage */
export function splitTripCoverFields(
  row: Pick<
    StoredItinerary,
    | "cover_image"
    | "cover_image_url"
    | "custom_cover_image_url"
    | "is_cover_customized"
    | "cover_source"
    | "mood"
  >,
): TripCoverFields {
  return {
    ...coverFieldsFromStored(row),
    coverSource: row.cover_source ?? null,
  };
}

/** 統一封面顯示：自訂 → 預設 → AI → Roamie 預設 */
export function resolveTripCoverUrl(fields: TripCoverDisplayFields): string {
  return resolveDisplayCoverImage(fields);
}
