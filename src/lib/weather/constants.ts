import { API_CACHE_TTL_MS, ROAMIE_API_FALLBACK } from "@/lib/api/constants";

/** 天氣 API 失敗時的 Roamie 溫柔文案（非假天氣數據） */
export const ROAMIE_WEATHER_UNAVAILABLE_MESSAGE = ROAMIE_API_FALLBACK.weather;

export const ROAMIE_WEATHER_UNAVAILABLE_OUTFIT = ROAMIE_API_FALLBACK.weatherOutfit;

export const WEATHER_CACHE_TTL_MS = API_CACHE_TTL_MS.weather;

/** 同座標 hook 層最短 refetch 間隔（含 unavailable） */
export const WEATHER_HOOK_MIN_REFETCH_MS = 8 * 60 * 1000;

/** unavailable / API 失敗結果的快取 TTL */
export const WEATHER_UNAVAILABLE_CACHE_TTL_MS = 8 * 60 * 1000;
