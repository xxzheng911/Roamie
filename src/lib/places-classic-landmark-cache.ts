import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { getClassicLandmarkWhitelist } from "@/lib/ai/ai-classic-landmark-rules";

export const CLASSIC_LANDMARK_SESSION_TTL_MS = 10 * 60 * 1000;
export const CLASSIC_LANDMARK_DAILY_TTL_MS = 24 * 60 * 60 * 1000;

export const TAITUNG_CLASSIC_LANDMARKS = [
  "三仙台",
  "鹿野高台",
  "池上伯朗大道",
  "多良車站",
  "加路蘭遊憩區",
  "小野柳",
  "鐵花村",
  "台東森林公園",
  "知本森林遊樂區",
  "初鹿牧場",
  "金剛大道",
  "富岡漁港",
  "都歷遊客中心",
  "卑南遺址公園",
  "台東美術館",
] as const;

type CacheEntry = {
  expires: number;
  places: PlaceResult[];
};

const sessionCache = new Map<string, CacheEntry>();
const dailyCache = new Map<string, CacheEntry>();

let rateLimitEncountered = false;

export function logPlacesRateLimitFallback(detail?: string): void {
  devVerboseInfo("[PLACES_RATE_LIMIT_FALLBACK]", detail ? `detail=${detail}` : "");
}

export function logAiPlacesRateLimitFallback(detail: string): void {
  logAiPipeline("[AI_PLACES_RATE_LIMIT_FALLBACK]", detail);
}

export function notePlacesSearchRateLimit(error: string | null | undefined): boolean {
  if (!isPlacesRateLimitError(error)) return false;
  markPlacesRateLimitEncountered();
  logAiPlacesRateLimitFallback("places_api_rate_limited");
  return true;
}

export function isPlacesRateLimitError(error: string | null | undefined): boolean {
  if (!error) return false;
  return error === "places_rate_limited" || error.includes("places_rate_limited");
}

export function markPlacesRateLimitEncountered(): void {
  rateLimitEncountered = true;
}

export function hasPlacesRateLimitEncountered(): boolean {
  return rateLimitEncountered;
}

export function consumePlacesRateLimitEncountered(): boolean {
  const v = rateLimitEncountered;
  rateLimitEncountered = false;
  return v;
}

export function resetPlacesRateLimitEncountered(): void {
  rateLimitEncountered = false;
}

export function classicLandmarkCacheKey(city: string, style: string): string {
  return `${normalizeDestinationLabel(city)}:${style}`;
}

function readCache(map: Map<string, CacheEntry>, key: string, now = Date.now()): PlaceResult[] | null {
  const entry = map.get(key);
  if (!entry || entry.expires <= now) {
    map.delete(key);
    return null;
  }
  return entry.places.length ? entry.places : null;
}

function writeCache(
  map: Map<string, CacheEntry>,
  key: string,
  places: PlaceResult[],
  ttlMs: number,
  now = Date.now(),
): void {
  if (!places.length) return;
  map.set(key, { expires: now + ttlMs, places: [...places] });
}

export function readClassicLandmarkSessionCache(city: string, style: string): PlaceResult[] | null {
  return readCache(sessionCache, classicLandmarkCacheKey(city, style));
}

export function writeClassicLandmarkSessionCache(
  city: string,
  style: string,
  places: PlaceResult[],
): void {
  writeCache(sessionCache, classicLandmarkCacheKey(city, style), places, CLASSIC_LANDMARK_SESSION_TTL_MS);
}

export function readClassicLandmarkDailyCache(city: string, style: string): PlaceResult[] | null {
  return readCache(dailyCache, classicLandmarkCacheKey(city, style));
}

export function writeClassicLandmarkDailyCache(
  city: string,
  style: string,
  places: PlaceResult[],
): void {
  writeCache(dailyCache, classicLandmarkCacheKey(city, style), places, CLASSIC_LANDMARK_DAILY_TTL_MS);
}

export function getLocalClassicLandmarkNames(destination: string): string[] {
  const label = normalizeDestinationLabel(destination);
  const fromRules = getClassicLandmarkWhitelist(label);
  if (fromRules.length) return fromRules;
  if (label === "台東") return [...TAITUNG_CLASSIC_LANDMARKS];
  return [];
}

const DEFAULT_OPENING_HOURS = {
  periods: [{ open: { day: 0, hour: 7, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } }],
};

/** API 不可用時的本地地標 Place（可渲染：name + address + 座標） */
export function buildSyntheticClassicLandmarkPlace(params: {
  name: string;
  destination: string;
  lat: number;
  lng: number;
  index?: number;
}): PlaceResult {
  const { name, destination, lat, lng, index = 0 } = params;
  const norm = normalizePlaceName(name) || name;
  const offset = (index % 5) * 0.008;
  return {
    id: `landmark-cache:${norm}`,
    name,
    address: `${normalizeDestinationLabel(destination)}`,
    lat: lat + offset * 0.3,
    lng: lng + offset,
    types: ["tourist_attraction"],
    primaryType: "tourist_attraction",
    rating: 4.2,
    userRatingCount: 100,
    regularOpeningHours: DEFAULT_OPENING_HOURS,
  };
}

/** 本地補點用合成餐廳（含營業時間，可填入早/午/晚餐 slot） */
export function buildSyntheticRestaurantPlace(params: {
  name: string;
  destination: string;
  lat: number;
  lng: number;
  index?: number;
  mealHint?: "breakfast" | "lunch" | "dinner";
}): PlaceResult {
  const { name, destination, lat, lng, index = 0, mealHint } = params;
  const norm = normalizePlaceName(name) || name;
  const offset = (index % 5) * 0.006;
  const suffix =
    mealHint === "breakfast" ? "早餐" : mealHint === "lunch" ? "午餐" : mealHint === "dinner" ? "晚餐" : "美食";
  const displayName = /餐|食|咖啡|早餐|午餐|晚餐/.test(name) ? name : `${name}${suffix}`;
  return {
    id: `landmark-cache:restaurant:${norm}:${mealHint ?? "food"}`,
    name: displayName,
    address: `${normalizeDestinationLabel(destination)}`,
    lat: lat + offset,
    lng: lng + offset * 0.5,
    types: ["restaurant", "food"],
    primaryType: "restaurant",
    rating: 4.3,
    userRatingCount: 120,
    regularOpeningHours: DEFAULT_OPENING_HOURS,
  };
}

export function buildLocalClassicLandmarkPool(params: {
  destination: string;
  days: number;
  lat: number;
  lng: number;
  minCount?: number;
}): PlaceResult[] {
  const minCount = params.minCount ?? Math.max(3, params.days * 3);
  const names = getLocalClassicLandmarkNames(params.destination);
  const out: PlaceResult[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < names.length && out.length < minCount; i += 1) {
    const name = names[i]!;
    const key = normalizePlaceName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(
      buildSyntheticClassicLandmarkPlace({
        name,
        destination: params.destination,
        lat: params.lat,
        lng: params.lng,
        index: i,
      }),
    );
  }

  logPlacesRateLimitFallback(`local_pool count=${out.length}`);
  return out;
}

export function mergeClassicLandmarkCaches(city: string, style: string): PlaceResult[] | null {
  return (
    readClassicLandmarkSessionCache(city, style) ??
    readClassicLandmarkDailyCache(city, style)
  );
}

export function persistClassicLandmarkCaches(
  city: string,
  style: string,
  places: PlaceResult[],
): void {
  if (!places.length) return;
  writeClassicLandmarkSessionCache(city, style, places);
  writeClassicLandmarkDailyCache(city, style, places);
}
