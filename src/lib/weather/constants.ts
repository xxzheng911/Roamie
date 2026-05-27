import { API_CACHE_TTL_MS, ROAMIE_API_FALLBACK } from "@/lib/api/constants";

/** 天氣 API 失敗時的 Roamie 溫柔文案（非假天氣數據） */
export const ROAMIE_WEATHER_UNAVAILABLE_MESSAGE = ROAMIE_API_FALLBACK.weather;

export const ROAMIE_WEATHER_UNAVAILABLE_OUTFIT = ROAMIE_API_FALLBACK.weatherOutfit;

export const WEATHER_CACHE_TTL_MS = API_CACHE_TTL_MS.weather;
