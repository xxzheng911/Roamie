import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DestinationCoverCacheRow = {
  normalized_destination_key: string;
  destination_name: string;
  query: string;
  image_url: string;
  photographer_name: string | null;
  photographer_url: string | null;
  unsplash_photo_id: string | null;
  generated_at: string;
  source: "unsplash";
};

export type PlaceImageCacheRow = {
  cache_key: string;
  place_id: string | null;
  place_name: string;
  query: string;
  image_url: string;
  photographer_name: string | null;
  photographer_url: string | null;
  unsplash_photo_id: string | null;
  place_image_source: "unsplash";
  generated_at: string;
};

const memoryDestination = new Map<string, DestinationCoverCacheRow>();
const memoryPlace = new Map<string, PlaceImageCacheRow>();

function isMissingTable(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? "";
  return err.code === "42P01" || /does not exist|schema cache/i.test(msg);
}

function rowImageUrl(row: Record<string, unknown>): string | null {
  const url =
    (typeof row.image_url === "string" && row.image_url) ||
    (typeof row.ai_generated_destination_cover_url === "string" &&
      row.ai_generated_destination_cover_url) ||
    (typeof row.ai_generated_place_image_url === "string" && row.ai_generated_place_image_url);
  return url?.trim() || null;
}

function normalizeDestinationRow(data: Record<string, unknown>): DestinationCoverCacheRow | null {
  const imageUrl = rowImageUrl(data);
  if (!imageUrl) return null;
  const key = String(data.normalized_destination_key ?? "");
  return {
    normalized_destination_key: key,
    destination_name: String(data.destination_name ?? key),
    query: String(data.query ?? data.cover_query ?? key),
    image_url: imageUrl,
    photographer_name:
      typeof data.photographer_name === "string" ? data.photographer_name : null,
    photographer_url:
      typeof data.photographer_url === "string" ? data.photographer_url : null,
    unsplash_photo_id:
      typeof data.unsplash_photo_id === "string" ? data.unsplash_photo_id : null,
    generated_at: String(data.generated_at ?? new Date().toISOString()),
    source: "unsplash",
  };
}

function normalizePlaceRow(data: Record<string, unknown>): PlaceImageCacheRow | null {
  const imageUrl = rowImageUrl(data);
  if (!imageUrl) return null;
  const cacheKey = String(data.cache_key ?? "");
  return {
    cache_key: cacheKey,
    place_id: typeof data.place_id === "string" ? data.place_id : null,
    place_name: String(data.place_name ?? ""),
    query: String(data.query ?? ""),
    image_url: imageUrl,
    photographer_name:
      typeof data.photographer_name === "string" ? data.photographer_name : null,
    photographer_url:
      typeof data.photographer_url === "string" ? data.photographer_url : null,
    unsplash_photo_id:
      typeof data.unsplash_photo_id === "string" ? data.unsplash_photo_id : null,
    place_image_source: "unsplash",
    generated_at: String(data.generated_at ?? new Date().toISOString()),
  };
}

export async function getDestinationCoverFromCache(
  normalizedKey: string,
): Promise<DestinationCoverCacheRow | null> {
  const mem = memoryDestination.get(normalizedKey);
  if (mem) return mem;

  const { data, error } = await supabaseAdmin
    .from("destination_cover_cache")
    .select("*")
    .eq("normalized_destination_key", normalizedKey)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return null;
    console.warn("[image-cache] destination read failed", error.message);
    return null;
  }
  if (!data) return null;
  const row = normalizeDestinationRow(data as Record<string, unknown>);
  if (!row) return null;
  memoryDestination.set(normalizedKey, row);
  return row;
}

export async function saveDestinationCoverToCache(row: DestinationCoverCacheRow): Promise<void> {
  memoryDestination.set(row.normalized_destination_key, row);
  const { error } = await supabaseAdmin.from("destination_cover_cache").upsert({
    normalized_destination_key: row.normalized_destination_key,
    destination_name: row.destination_name,
    query: row.query,
    image_url: row.image_url,
    ai_generated_destination_cover_url: row.image_url,
    photographer_name: row.photographer_name,
    photographer_url: row.photographer_url,
    unsplash_photo_id: row.unsplash_photo_id,
    generated_at: row.generated_at,
    source: "unsplash",
  });
  if (error && !isMissingTable(error)) {
    console.warn("[image-cache] destination write failed", error.message);
  }
}

export async function getPlaceImageFromCache(cacheKey: string): Promise<PlaceImageCacheRow | null> {
  const mem = memoryPlace.get(cacheKey);
  if (mem) return mem;

  const { data, error } = await supabaseAdmin
    .from("place_image_cache")
    .select("*")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return null;
    console.warn("[image-cache] place read failed", error.message);
    return null;
  }
  if (!data) return null;
  const row = normalizePlaceRow(data as Record<string, unknown>);
  if (!row) return null;
  memoryPlace.set(cacheKey, row);
  return row;
}

export async function savePlaceImageToCache(row: PlaceImageCacheRow): Promise<void> {
  memoryPlace.set(row.cache_key, row);
  const { error } = await supabaseAdmin.from("place_image_cache").upsert({
    cache_key: row.cache_key,
    place_id: row.place_id,
    place_name: row.place_name,
    query: row.query,
    image_url: row.image_url,
    ai_generated_place_image_url: row.image_url,
    photographer_name: row.photographer_name,
    photographer_url: row.photographer_url,
    unsplash_photo_id: row.unsplash_photo_id,
    place_image_source: "unsplash",
    generated_at: row.generated_at,
  });
  if (error && !isMissingTable(error)) {
    console.warn("[image-cache] place write failed", error.message);
  }
}
