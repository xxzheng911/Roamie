import type { SavedPlace } from "@/lib/places-storage";

type ImageMetadata = Record<string, unknown> | null | undefined;

function readMetadataUrl(metadata: ImageMetadata, ...keys: string[]): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  for (const key of keys) {
    const raw = metadata[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  const place = metadata.place;
  if (place && typeof place === "object") {
    const nested = (place as Record<string, unknown>).photoUrl;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

/** 統一讀取收藏地點圖片 URL（canonical: cover_image → image_url → metadata） */
export function resolveSavedPlaceImageUrl(
  place: Pick<SavedPlace, "cover_image" | "image_url" | "metadata">,
): string | null {
  const cover = place.cover_image?.trim();
  if (cover) return cover;
  const imageUrl = place.image_url?.trim();
  if (imageUrl) return imageUrl;
  return readMetadataUrl(
    place.metadata,
    "image_url",
    "cover_image",
    "photoUrl",
    "photo_url",
    "google_photo_url",
  );
}

/** 寫入時同步 canonical 欄位 */
export function normalizeSavedPlaceImageFields(input: {
  cover_image?: string | null;
  image_url?: string | null;
  image_source?: string | null;
}): Pick<SavedPlace, "cover_image" | "image_url" | "image_source"> {
  const url = input.cover_image?.trim() || input.image_url?.trim() || null;
  return {
    cover_image: url,
    image_url: url,
    image_source: input.image_source?.trim() || null,
  };
}
