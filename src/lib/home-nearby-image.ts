import { resolvePlaceImageUrl } from "@/lib/safe-image-url";

/** Display selection only: preserve candidate fields and locale-neutral photo identity. */
export function homeNearbyImageUrl(place: {
  coverImageUrl?: string | null;
  photoUrl?: string | null;
  generatedImageUrl?: string | null;
  fallbackImageUrl?: string | null;
}): string | null {
  for (const value of [place.coverImageUrl, place.photoUrl, place.generatedImageUrl, place.fallbackImageUrl]) {
    const url = resolvePlaceImageUrl(value, { maxWidth: 480 });
    if (url) return url;
  }
  return null;
}
