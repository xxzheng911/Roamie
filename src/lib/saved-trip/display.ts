import type { StoredItinerary } from "@/lib/itinerary-storage";
import { isLegacySceneCoverUrl } from "@/lib/saved-trip/legacy-cover";
import { getRoamieDefaultImage } from "@/services/placeImageService";

export type TripTitleFields = {
  /** 自動產生的預設名稱 */
  title: string;
  customTitle: string | null;
  isTitleCustomized: boolean;
};

export type TripCoverDisplayFields = {
  /** 非自訂預設封面（地點圖等；目前多與 AI 相同） */
  coverImageUrl: string | null;
  customCoverImageUrl: string | null;
  aiGeneratedCoverImageUrl: string | null;
  isCoverCustomized: boolean;
  mood?: string | null;
};

export function titleFieldsFromStored(
  trip: Pick<StoredItinerary, "title" | "custom_title" | "is_title_customized">,
): TripTitleFields {
  return {
    title: trip.title?.trim() || "我的行程",
    customTitle: trip.custom_title?.trim() || null,
    isTitleCustomized: Boolean(trip.is_title_customized),
  };
}

export function resolveDisplayTitle(fields: TripTitleFields): string {
  if (fields.isTitleCustomized && fields.customTitle) {
    return fields.customTitle;
  }
  return fields.title || "我的行程";
}

export function coverFieldsFromStored(
  trip: Pick<
    StoredItinerary,
    | "cover_image"
    | "cover_image_url"
    | "custom_cover_image_url"
    | "is_cover_customized"
    | "cover_source"
    | "mood"
  >,
): TripCoverDisplayFields {
  const rawCover = trip.cover_image?.trim() || null;
  const aiGeneratedCoverImageUrl = rawCover && !isLegacySceneCoverUrl(rawCover) ? rawCover : null;
  const legacyCustom =
    trip.is_cover_customized || trip.cover_source === "upload"
      ? trip.custom_cover_image_url?.trim() || trip.cover_image_url?.trim() || null
      : null;

  return {
    coverImageUrl: trip.is_cover_customized ? null : aiGeneratedCoverImageUrl,
    customCoverImageUrl: legacyCustom,
    aiGeneratedCoverImageUrl,
    isCoverCustomized: Boolean(trip.is_cover_customized),
    mood: trip.mood,
  };
}

export function resolveDisplayCoverImage(fields: TripCoverDisplayFields): string {
  if (fields.isCoverCustomized && fields.customCoverImageUrl?.trim()) {
    return fields.customCoverImageUrl.trim();
  }
  const ai = fields.aiGeneratedCoverImageUrl?.trim();
  if (ai && !isLegacySceneCoverUrl(ai)) return ai;
  const legacy = fields.coverImageUrl?.trim();
  if (legacy && !isLegacySceneCoverUrl(legacy)) return legacy;
  return getRoamieDefaultImage(fields.mood);
}

export function buildCustomTitlePatch(
  customTitle: string,
): Pick<StoredItinerary, "custom_title" | "is_title_customized"> {
  const trimmed = customTitle.trim();
  return {
    custom_title: trimmed,
    is_title_customized: true,
  };
}

export function buildCustomCoverPatch(
  url: string,
): Pick<StoredItinerary, "custom_cover_image_url" | "cover_image_url" | "is_cover_customized"> {
  const trimmed = url.trim();
  return {
    custom_cover_image_url: trimmed,
    cover_image_url: trimmed,
    is_cover_customized: true,
  };
}
