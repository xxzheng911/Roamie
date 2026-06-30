import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import type { PlaceDetailHandoff } from "@/lib/place-detail-handoff";
import { isGooglePlaceId, latLngFallbackPlaceId } from "@/lib/place-detail-handoff";
import { preferJpegPngImageUrl } from "@/lib/safe-image-url";
import type { NewPlace, SavedPlace } from "@/lib/places-storage";
import { pickPlaceSceneFallback } from "@/lib/place-scene-fallback";
import { getPlaceImage } from "@/services/placeImageService";

export type SavedPlaceMetadata = {
  placeId?: string;
  googlePlaceId?: string;
  photoName?: string;
  photoReference?: string;
  primaryType?: string;
  types?: string[];
  rating?: number | null;
  userRatingCount?: number | null;
  phone?: string | null;
  website?: string | null;
};

export function readSavedPlaceMetadata(place: SavedPlace): SavedPlaceMetadata {
  const raw = place.metadata ?? {};
  const asString = (key: string) => {
    const v = raw[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const asNumber = (key: string) => {
    const v = raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  const placeId =
    asString("placeId") ??
    asString("googlePlaceId") ??
    asString("google_place_id") ??
    undefined;
  const photoName =
    asString("photoName") ??
    asString("photo_name") ??
    asString("photoReference") ??
    asString("photo_reference") ??
    undefined;

  const typesRaw = raw.types;
  const types = Array.isArray(typesRaw)
    ? typesRaw.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;

  return {
    placeId,
    googlePlaceId: placeId,
    photoName,
    photoReference: asString("photoReference") ?? asString("photo_reference"),
    primaryType: asString("primaryType") ?? asString("primary_type") ?? place.category ?? undefined,
    types,
    rating: asNumber("rating") ?? null,
    userRatingCount: asNumber("userRatingCount") ?? asNumber("user_rating_count") ?? null,
    phone: asString("phone") ?? null,
    website: asString("website") ?? null,
  };
}

export function resolveSavedPlaceGooglePlaceId(place: SavedPlace): string | undefined {
  const meta = readSavedPlaceMetadata(place);
  const candidate = meta.googlePlaceId ?? meta.placeId;
  if (candidate && isGooglePlaceId(candidate)) return candidate;
  return undefined;
}

/** 同步解析收藏地點封面（Google photo → 已存 URL → Roamie 情境圖） */
export function resolveSavedPlaceCoverImageSync(
  place: SavedPlace,
  options?: { photoWidth?: number },
): string {
  const meta = readSavedPlaceMetadata(place);
  const width = options?.photoWidth ?? 600;

  const fromPhotoName = meta.photoName
    ? preferJpegPngImageUrl(buildPlacePhotoUrl(meta.photoName, width))
    : null;
  if (fromPhotoName) return fromPhotoName;

  for (const candidate of [place.cover_image, place.image_url]) {
    const url = candidate?.trim();
    if (url) return url;
  }

  return pickPlaceSceneFallback(place.name, {
    primaryType: meta.primaryType ?? place.category,
    types: meta.types ?? (place.category ? [place.category] : undefined),
    categoryId: place.category ?? undefined,
  });
}

export async function resolveSavedPlaceCoverImage(
  place: SavedPlace,
  options?: { photoWidth?: number },
): Promise<string> {
  const sync = resolveSavedPlaceCoverImageSync(place, options);
  const meta = readSavedPlaceMetadata(place);
  const googlePlaceId = resolveSavedPlaceGooglePlaceId(place);

  if (meta.photoName || googlePlaceId) {
    try {
      const resolved = await getPlaceImage(
        {
          placeId: googlePlaceId ?? meta.placeId,
          name: place.name,
          photoName: meta.photoName,
          primaryType: meta.primaryType ?? place.category,
          types: meta.types ?? (place.category ? [place.category] : null),
          category: place.category ?? undefined,
          city: place.city,
          photoWidth: options?.photoWidth ?? 600,
        },
        { skipGoogle: !meta.photoName && !googlePlaceId },
      );
      if (resolved.url) return resolved.url;
    } catch {
      /* fallback below */
    }
  }

  return sync;
}

export function savedPlaceToHandoff(place: SavedPlace): PlaceDetailHandoff {
  const meta = readSavedPlaceMetadata(place);
  const googlePlaceId = resolveSavedPlaceGooglePlaceId(place);
  const placeId =
    googlePlaceId ??
    (place.lat != null && place.lng != null
      ? latLngFallbackPlaceId(place.lat, place.lng)
      : `saved-${place.id}`);

  const photoUrl = resolveSavedPlaceCoverImageSync(place, { photoWidth: 800 });
  const fallbackImageUrl = pickPlaceSceneFallback(place.name, {
    primaryType: meta.primaryType ?? place.category,
    types: meta.types ?? (place.category ? [place.category] : undefined),
    categoryId: place.category ?? undefined,
  });

  return {
    placeId,
    googlePlaceId,
    name: place.name,
    address: place.address,
    lat: place.lat,
    lng: place.lng,
    photoUrl,
    photoName: meta.photoName ?? null,
    generatedImageUrl: fallbackImageUrl,
    fallbackImageUrl,
    rating: meta.rating ?? null,
    userRatingCount: meta.userRatingCount ?? null,
    category: place.category,
    reason: place.notes ?? undefined,
  };
}

export function buildNewSavedPlaceInput(input: {
  name: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  mood_tag?: string | null;
  placeId?: string | null;
  googlePlaceId?: string | null;
  photoName?: string | null;
  photoReference?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  rating?: number | null;
  userRatingCount?: number | null;
  phone?: string | null;
  website?: string | null;
  coverImageUrl?: string | null;
}): NewPlace {
  const googlePlaceId = (input.googlePlaceId ?? input.placeId)?.trim() || undefined;
  const photoName = (input.photoName ?? input.photoReference)?.trim() || undefined;
  const coverFromGoogle = photoName
    ? preferJpegPngImageUrl(buildPlacePhotoUrl(photoName, 600))
    : null;
  const cover_image = coverFromGoogle ?? input.coverImageUrl?.trim() ?? null;

  const metadata: Record<string, unknown> = {};
  if (googlePlaceId) {
    metadata.placeId = googlePlaceId;
    metadata.googlePlaceId = googlePlaceId;
  }
  if (photoName) metadata.photoName = photoName;
  if (input.primaryType?.trim()) metadata.primaryType = input.primaryType.trim();
  if (input.types?.length) metadata.types = input.types;
  if (input.rating != null) metadata.rating = input.rating;
  if (input.userRatingCount != null) metadata.userRatingCount = input.userRatingCount;
  if (input.phone?.trim()) metadata.phone = input.phone.trim();
  if (input.website?.trim()) metadata.website = input.website.trim();

  return {
    name: input.name,
    category: input.category ?? input.primaryType ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    notes: input.notes ?? null,
    mood_tag: input.mood_tag ?? null,
    cover_image,
    image_url: cover_image,
    image_source: coverFromGoogle ? "google" : cover_image ? "upload" : null,
    metadata,
  };
}
