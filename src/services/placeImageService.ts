import roamieDefaultCover from "@/assets/roamie-default-cover.png";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { ROAMIE_API_FALLBACK, API_CACHE_TTL_MS } from "@/lib/api/constants";
import { isLocalhostAppApiUrl } from "@/lib/api-base-url";
import { buildPlacePhotoUrl } from "@/lib/google-maps-client";
import { getCachedPlacePhotoUrl } from "@/lib/place-photo-url-cache";
import { preferNonWebpImageUrl } from "@/lib/safe-image-url";
import { isBlockedPlaceSceneUrl, pickPlaceSceneFallback } from "@/lib/place-scene-fallback";
import type { PlaceResult } from "@/lib/place-result";
import { createRequestCache } from "@/services/requestCache";
import { normalizeCategoryFromPlace } from "@/lib/place-image/place-category";
import { fetchUnsplashPlaceImage } from "@/lib/place-image/fetch-unsplash-place-image";
import { fetchDestinationCover } from "@/lib/place-image/fetch-destination-cover";
import { logPlaceImage } from "@/lib/place-image/place-image-log";
import { logTripCover } from "@/lib/place-image/trip-cover-log";
import {
  extractPrimaryDestinationLabel,
  normalizeDestinationKey,
} from "@/lib/destination/normalize-destination-key";
import {
  buildPlaceUnsplashQueries,
  buildTripCoverQueries,
  buildTripCoverQuery,
  extractCityFromText,
} from "@/lib/unsplash/unsplash-queries";
import type { PlaceImageInput, TripCoverInput } from "@/lib/place-image/place-image-types";

export type { PlaceImageInput, TripCoverInput } from "@/lib/place-image/place-image-types";

/** 地點卡片圖片來源 */
export type PlaceImageSource = "google" | "unsplash" | "default";

/** 行程封面來源 */
export type TripCoverSource = "custom" | "unsplash" | "default";

/** @deprecated 請改用 PlaceImageSource / TripCoverSource */
export type ImageSource = PlaceImageSource | TripCoverSource | "upload" | "roamie" | "ai";

export const ROAMIE_IMAGE_FALLBACK_MESSAGE = ROAMIE_API_FALLBACK.image;

export const roamieDefaultPlaceImage = roamieDefaultCover;
export const defaultRoamieTripCover = roamieDefaultCover;

const placeImageRequestCache = createRequestCache({
  prefix: "place-image",
  ttlMs: API_CACHE_TTL_MS.image,
  persist: true,
});

function placeImageCacheKey(input: PlaceImageInput): string {
  return [
    input.placeId ?? "",
    input.name,
    input.photoName ?? "",
    input.categoryId ?? "",
    input.category ?? "",
    input.city ?? "",
    input.primaryType ?? "",
  ]
    .join("|")
    .trim()
    .toLowerCase();
}

function tripCoverCacheKey(trip: TripCoverInput): string {
  const dest = trip.destination?.trim() || trip.city?.trim() || "";
  return normalizeDestinationKey(dest || trip.title || "unknown");
}

/** Roamie 分類預設圖（Google / Unsplash 皆無時） */
export function getRoamieDefaultImage(
  category?: string | null,
  name = "",
): string {
  const url = pickPlaceSceneFallback(name, { categoryId: category ?? undefined });
  return isBlockedPlaceSceneUrl(url) ? roamieDefaultPlaceImage : url;
}

export function resolveGooglePlacePhoto(
  photoName: string | null | undefined,
  width = 600,
): string | null {
  if (!photoName) return null;
  return getCachedPlacePhotoUrl(photoName, width, () => {
    const built = buildPlacePhotoUrl(photoName, width);
    if (!built || isLocalhostAppApiUrl(built)) return null;
    return preferNonWebpImageUrl(built);
  });
}

export function resolvePlaceCoverImageSync(
  place: PlaceResult | PlaceImageInput,
  options?: { categoryId?: string; photoWidth?: number },
): string | null {
  const width = options?.photoWidth ?? 600;
  const photoName = "photoName" in place ? place.photoName : undefined;
  return resolveGooglePlacePhoto(photoName, width);
}

export type GetPlaceImageOptions = {
  /** @deprecated 已不再跳過 Unsplash */
  preferRoamieScene?: boolean;
};

/**
 * 地點圖片：Google Places → Unsplash → 分類預設
 */
export async function getPlaceImage(
  input: PlaceImageInput,
  _options?: GetPlaceImageOptions,
): Promise<{ url: string; source: PlaceImageSource }> {
  const key = placeImageCacheKey(input);
  return placeImageRequestCache.getOrFetch(key, async () => {
    const width = input.photoWidth ?? 600;
    const fromGoogle = resolveGooglePlacePhoto(input.photoName, width);
    if (fromGoogle) {
      logPlaceImage(input.name, {
        googlePhotoFound: true,
        unsplashUsed: false,
        source: "google",
      });
      return { url: fromGoogle, source: "google" as const };
    }

    const category = normalizeCategoryFromPlace(input);
    const unsplash = await fetchUnsplashPlaceImage({
      placeId: input.placeId,
      name: input.name,
      category,
      city: input.city ?? extractCityFromText(input.name),
      country: input.country,
      primaryType: input.primaryType,
      types: input.types,
    });

    if (unsplash.url && !isBlockedPlaceSceneUrl(unsplash.url)) {
      logPlaceImage(input.name, {
        googlePhotoFound: false,
        unsplashUsed: true,
        source: "unsplash",
      });
      return { url: unsplash.url, source: "unsplash" as const };
    }

    const categoryDefault = getRoamieDefaultImage(category, input.name);
    logPlaceImage(input.name, {
      googlePhotoFound: false,
      unsplashUsed: false,
      source: "default",
    });
    return { url: categoryDefault, source: "default" as const };
  });
}

export type TripCoverResult = {
  url: string;
  source: TripCoverSource;
  query: string | null;
  destinationName: string | null;
  normalizedDestinationKey: string | null;
  unsplashDestinationCoverUrl: string | null;
};

/** 行程封面：Unsplash 目的地（共用 cache）→ Roamie 預設 */
export async function getTripCoverImage(trip: TripCoverInput): Promise<TripCoverResult> {
  const destRaw = trip.destination?.trim() || trip.city?.trim() || trip.title?.trim() || "";
  const destinationName = extractPrimaryDestinationLabel(destRaw);
  const normalizedDestinationKey = normalizeDestinationKey(destinationName || destRaw);
  const cacheKey = tripCoverCacheKey(trip);

  return placeImageRequestCache.getOrFetch(`trip:${cacheKey}`, async () => {
    const cover = await fetchDestinationCover({
      destination: destinationName || destRaw,
      city: trip.city ?? extractCityFromText(destRaw),
      country: trip.country,
      mood: trip.mood ?? trip.moodTag,
      moodTag: trip.moodTag,
      title: trip.title,
    });

    logTripCover({
      destination: destinationName || destRaw,
      normalizedKey: cover.normalizedKey,
      customCover: false,
      unsplashCacheHit: cover.cacheHit,
      source: cover.url ? "unsplash" : "default",
    });

    if (cover.url && !isBlockedPlaceSceneUrl(cover.url)) {
      return {
        url: cover.url,
        source: "unsplash" as const,
        query: cover.query ?? cover.normalizedKey,
        destinationName: cover.destinationName,
        normalizedDestinationKey: cover.normalizedKey,
        unsplashDestinationCoverUrl: cover.url,
      };
    }

    return {
      url: defaultRoamieTripCover,
      source: "default" as const,
      query: null,
      destinationName: destinationName || null,
      normalizedDestinationKey: cover.normalizedKey,
      unsplashDestinationCoverUrl: null,
    };
  });
}

export function tripCoverInputFromPayload(payload: RoamiePayloadV2): TripCoverInput {
  const firstStop = payload.itinerary?.[0];
  const category = firstStop?.placeType ?? undefined;
  return {
    destination: payload.destination ?? payload.destinationLocation?.displayLabel,
    title: payload.title,
    moodTag: payload.moodTag,
    mood: payload.moodTag,
    city: payload.destinationLocation?.city ?? extractCityFromText(payload.destination ?? ""),
    category,
  };
}

export { buildPlaceUnsplashQueries, buildTripCoverQuery, buildTripCoverQueries };
