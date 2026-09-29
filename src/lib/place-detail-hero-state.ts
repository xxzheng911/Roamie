export type PlaceDetailPhotoResolution = "pending" | "settled";
export type PlaceDetailHeroVisual = "loading" | "ready" | "fallback";
export type PlaceDetailHeroMode = "loading" | "provider-photo" | "fallback-visual";

/**
 * Unknown photo (details still hydrating, or a provider photo not yet decoded)
 * stays on the skeleton. The illustrated fallback is only for a settled miss
 * or a failed sign/image load.
 */
export function resolvePlaceDetailHeroMode(input: {
  hasProviderPhoto: boolean;
  photoResolution: PlaceDetailPhotoResolution;
  visual: PlaceDetailHeroVisual;
}): PlaceDetailHeroMode {
  if (!input.hasProviderPhoto) {
    return input.photoResolution === "pending" ? "loading" : "fallback-visual";
  }
  if (input.visual === "ready") return "provider-photo";
  if (input.visual === "fallback") return "fallback-visual";
  return "loading";
}
