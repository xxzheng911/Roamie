export type DestCoverCacheLayer = "local" | "session" | "supabase" | "unsplash" | "miss";

export function logDestCoverCache(fields: {
  normalizedKey: string;
  destinationName: string;
  layer: DestCoverCacheLayer;
  cacheHit: boolean;
  url?: string | null;
}): void {
  console.info("[DEST_COVER_CACHE]", {
    normalizedKey: fields.normalizedKey,
    destinationName: fields.destinationName,
    layer: fields.layer,
    cacheHit: fields.cacheHit,
    hasUrl: Boolean(fields.url?.trim()),
  });
}
