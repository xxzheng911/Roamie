export function logTripCover(
  fields: {
    destination: string;
    normalizedKey: string;
    customCover: boolean;
    unsplashCacheHit: boolean;
    source: string;
  },
): void {
  console.info(
    "[TRIP_COVER] destination=",
    fields.destination,
    "normalizedKey=",
    fields.normalizedKey,
    "customCover=",
    fields.customCover,
    "unsplashCacheHit=",
    fields.unsplashCacheHit,
    "source=",
    fields.source,
  );
}
