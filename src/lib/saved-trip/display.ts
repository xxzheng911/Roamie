import type { StoredItinerary } from "@/lib/itinerary-storage";
import { isLegacySceneCoverUrl } from "@/lib/saved-trip/legacy-cover";
import { defaultRoamieTripCover } from "@/services/placeImageService";

export type TripTitleFields = {
  title: string;
  customTitle: string | null;
  isTitleCustomized: boolean;
};

export type TripCoverDisplayFields = {
  coverImageUrl: string | null;
  customCoverImageUrl: string | null;
  aiGeneratedCoverImageUrl: string | null;
  aiGeneratedDestinationCoverUrl: string | null;
  isCoverCustomized: boolean;
  /** custom | unsplash | default */
  coverImageSource?: string | null;
  destinationName?: string | null;
  normalizedDestinationKey?: string | null;
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

type StoredCoverRow = Pick<
  StoredItinerary,
  | "cover_image"
  | "cover_image_url"
  | "custom_cover_image_url"
  | "is_cover_customized"
  | "cover_source"
  | "mood"
> & {
  ai_generated_destination_cover_url?: string | null;
  destination_name?: string | null;
  normalized_destination_key?: string | null;
};

export function coverFieldsFromStored(trip: StoredCoverRow): TripCoverDisplayFields {
  const aiFromColumn =
    trip.ai_generated_destination_cover_url?.trim() ||
    (trip.cover_image?.trim() && !isLegacySceneCoverUrl(trip.cover_image)
      ? trip.cover_image.trim()
      : null);

  const legacyCustom =
    trip.is_cover_customized ||
    trip.cover_source === "upload" ||
    trip.cover_source === "custom"
      ? trip.custom_cover_image_url?.trim() || trip.cover_image_url?.trim() || null
      : null;

  return {
    coverImageUrl: trip.is_cover_customized ? null : aiFromColumn,
    customCoverImageUrl: legacyCustom,
    aiGeneratedCoverImageUrl: aiFromColumn,
    aiGeneratedDestinationCoverUrl: aiFromColumn,
    isCoverCustomized: Boolean(trip.is_cover_customized),
    coverImageSource: trip.cover_source ?? null,
    destinationName: trip.destination_name ?? null,
    normalizedDestinationKey: trip.normalized_destination_key ?? trip.cover_query ?? null,
    mood: trip.mood,
  };
}

/** 自訂 → AI 目的地封面 → Roamie 預設（不用溫泉圖） */
export function resolveDisplayCoverImage(fields: TripCoverDisplayFields): string {
  if (fields.isCoverCustomized && fields.customCoverImageUrl?.trim()) {
    return fields.customCoverImageUrl.trim();
  }
  const ai =
    fields.aiGeneratedDestinationCoverUrl?.trim() ||
    fields.aiGeneratedCoverImageUrl?.trim();
  if (ai && !isLegacySceneCoverUrl(ai)) return ai;
  const legacy = fields.coverImageUrl?.trim();
  if (legacy && !isLegacySceneCoverUrl(legacy)) return legacy;
  return defaultRoamieTripCover;
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
