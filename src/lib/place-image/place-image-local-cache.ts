const PLACE_KEY = "roamie:place-image-cache:v1";
const DEST_KEY = "roamie:destination-cover-cache:v1";

type PlaceEntry = { url: string; source: "ai"; at: number };
type DestEntry = { url: string; normalizedKey: string; at: number };

function readMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, T>;
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, map: Record<string, T>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

export function readLocalPlaceImage(cacheKey: string): string | null {
  const hit = readMap<PlaceEntry>(PLACE_KEY)[cacheKey];
  return hit?.url?.trim() || null;
}

export function writeLocalPlaceImage(cacheKey: string, url: string): void {
  const map = readMap<PlaceEntry>(PLACE_KEY);
  map[cacheKey] = { url, source: "ai", at: Date.now() };
  writeMap(PLACE_KEY, map);
}

export function readLocalDestinationCover(normalizedKey: string): string | null {
  const hit = readMap<DestEntry>(DEST_KEY)[normalizedKey];
  return hit?.url?.trim() || null;
}

export function writeLocalDestinationCover(normalizedKey: string, url: string): void {
  const map = readMap<DestEntry>(DEST_KEY);
  map[normalizedKey] = { url, normalizedKey, at: Date.now() };
  writeMap(DEST_KEY, map);
}
