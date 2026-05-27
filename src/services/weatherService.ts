/**
 * 統一天氣服務 — 所有功能透過此層取得天氣，不在 component 內直接 fetch API。
 * 資料來源：OpenWeather（serverFn）+ 45 分鐘共用快取 + in-flight deduplication。
 */
import type { Locale } from "@/lib/i18n/types";
import { logOpenWeatherKeyLoadedOnce } from "@/lib/openweather-key-resolve";
import {
  fetchClientWeather,
  shouldUseClientWeatherFetch,
} from "@/lib/weather/client-weather-fetch";
import type { DailyForecast, WeatherForecastResult, WeatherSummary } from "@/lib/weather-types";
import {
  getWeatherCached,
  getWeatherCachedOrFetch,
  isWeatherRequestInFlight,
  weatherCacheKey,
} from "@/services/weatherCache";

const WEATHER_SERVICE_VERSION = "v-client-native-002";

export type WeatherLoadState = "idle" | "loading" | "ready" | "error";

export type WeatherCoords = { lat: number; lng: number };
export type WeatherPlace = {
  name?: string;
  placeId?: string;
  lat: number | null;
  lng: number | null;
};

export type WeatherTestResult =
  | {
      ok: true;
      city?: string;
      temperature: number | null;
      description: string;
      rainProbability: number | null;
    }
  | { ok: false; statusCode?: number; message: string };

type FetchWeatherFn = (args: {
  data: { lat: number; lng: number; locale?: Locale };
}) => Promise<{ weather: WeatherSummary | null; error: string | null }>;

type FetchForecastFn = (args: {
  data: { lat: number; lng: number; days: number; locale?: Locale };
}) => Promise<WeatherForecastResult>;

type TestWeatherFn = () => Promise<WeatherTestResult>;

let boundFetchWeather: FetchWeatherFn | null = null;
let boundFetchForecast: FetchForecastFn | null = null;
let boundTestWeather: TestWeatherFn | null = null;

/** 在 route / hook 初始化時注入 serverFn（避免在非 React 環境硬綁 useServerFn） */
export function bindWeatherServerFns(fns: {
  fetchWeather: FetchWeatherFn;
  fetchForecast: FetchForecastFn;
  testConnection?: TestWeatherFn;
}): void {
  boundFetchWeather = fns.fetchWeather;
  boundFetchForecast = fns.fetchForecast;
  boundTestWeather = fns.testConnection ?? null;
}

function requireFetchWeather(): FetchWeatherFn {
  if (!boundFetchWeather) {
    throw new Error("weatherService: call bindWeatherServerFns() before fetching weather");
  }
  return boundFetchWeather;
}

function requireFetchForecast(): FetchForecastFn {
  if (!boundFetchForecast) {
    throw new Error("weatherService: call bindWeatherServerFns() before fetching forecast");
  }
  return boundFetchForecast;
}

function requireTestWeather(): TestWeatherFn | null {
  return boundTestWeather;
}

function unavailableWeatherSummary(): WeatherSummary {
  return {
    city: "目前位置",
    tempC: null,
    feelsLikeC: null,
    condition: "",
    iconType: "",
    isDaytime: true,
    precipProbability: null,
    humidityPercent: null,
    windSpeedKmh: null,
    cloudCoverPercent: null,
    uvi: null,
    sunrise: null,
    sunset: null,
    recommendation: "indoor",
    recommendationText: "天氣暫時無法取得，稍後重試。",
    source: "unavailable",
    fetchedAt: new Date().toISOString(),
    available: false,
  };
}

async function fetchCurrentWeatherResolved(
  coords: WeatherCoords,
  locale?: Locale,
): Promise<{ weather: WeatherSummary | null; error: string | null }> {
  if (shouldUseClientWeatherFetch()) {
    return fetchClientWeather(coords.lat, coords.lng);
  }

  try {
    const result = await requireFetchWeather()({
      data: { lat: coords.lat, lng: coords.lng, locale },
    });
    if (result.weather?.available) return result;
    console.info("[WEATHER_FETCH] server unavailable, trying client fallback");
    return fetchClientWeather(coords.lat, coords.lng);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[WEATHER_FETCH] openWeather status=", "client-error");
    console.error("[WEATHER_FETCH] server error=", msg);
    try {
      return await fetchClientWeather(coords.lat, coords.lng);
    } catch (fallbackErr) {
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      console.error("[WEATHER_FETCH] fallback_error=", fallbackMsg);
      return { weather: null, error: fallbackMsg || msg };
    }
  }
}

export function getWeatherLoadState(
  coords: WeatherCoords,
  locale?: Locale,
  kind: "current" | "forecast" = "current",
): WeatherLoadState {
  const key =
    kind === "current"
      ? weatherCacheKey("current", coords.lat, coords.lng, locale)
      : weatherCacheKey("forecast", coords.lat, coords.lng, locale);
  if (isWeatherRequestInFlight(key)) return "loading";
  return "idle";
}

/** 依經緯度取得即時天氣（含快取 + dedup） */
export async function getWeatherByLatLng(
  coords: WeatherCoords,
  locale?: Locale,
): Promise<{ weather: WeatherSummary; error: string | null }> {
  console.info("[WEATHER_SERVICE_VERSION]", WEATHER_SERVICE_VERSION);
  console.info("[WEATHER_FETCH] start");
  const key = weatherCacheKey("current", coords.lat, coords.lng, locale);
  console.info("[WEATHER_FETCH] latLng=", `${coords.lat},${coords.lng}`);
  console.info("[WEATHER_FETCH] clientNative=", shouldUseClientWeatherFetch());

  const cached = getWeatherCached<{ weather: WeatherSummary | null; error: string | null }>(key);
  if (cached?.weather?.available) {
    console.info("[WEATHER_FETCH] openWeather status=", "cache-hit");
    console.info("[WEATHER_FETCH] final result=", JSON.stringify(cached.weather));
    return { weather: cached.weather, error: cached.error };
  }

  const result = await getWeatherCachedOrFetch(key, () => fetchCurrentWeatherResolved(coords, locale));

  if (!result.weather?.available) {
    console.info("[WEATHER_FETCH] openWeather status=", "no-response");
    console.info("[WEATHER_FETCH] final result=", "unavailable");
    return {
      weather: unavailableWeatherSummary(),
      error: result.error ?? "no_weather",
    };
  }

  console.info("[WEATHER_FETCH] final result=", JSON.stringify(result.weather));
  return { weather: result.weather, error: result.error };
}

/** 取得即時天氣（getWeatherByLatLng 別名） */
export const getCurrentWeather = getWeatherByLatLng;

export function normalizeWeather(weather: WeatherSummary | null | undefined): WeatherSummary {
  if (weather) return weather;
  return {
    city: "目的地",
    tempC: null,
    feelsLikeC: null,
    condition: "",
    iconType: "",
    isDaytime: true,
    precipProbability: null,
    humidityPercent: null,
    windSpeedKmh: null,
    cloudCoverPercent: null,
    uvi: null,
    sunrise: null,
    sunset: null,
    recommendation: "indoor",
    recommendationText: "天氣暫時無法取得，先依季節給你穩妥建議。",
    source: "unavailable",
    fetchedAt: new Date().toISOString(),
    available: false,
  };
}

export function getWeatherFallbackBySeason(
  destination: string,
  dateRange: { startDate?: string; endDate?: string },
): WeatherSummary {
  const date = new Date(dateRange.startDate || dateRange.endDate || Date.now());
  const month = date.getMonth() + 1;
  const isWinter = month === 12 || month <= 2;
  const isSummer = month >= 6 && month <= 9;
  const condition = isWinter ? "偏冷" : isSummer ? "炎熱" : "溫和";
  const recommendationText = isWinter
    ? `${destination} 可能偏冷，建議洋蔥式穿搭與保暖外套。`
    : isSummer
      ? `${destination} 可能偏熱潮濕，建議透氣防曬並留意補水。`
      : `${destination} 早晚溫差可能較大，建議薄外套分層穿著。`;
  return normalizeWeather({
    ...normalizeWeather(null),
    city: destination || "目的地",
    condition,
    recommendationText,
    source: "fallback",
    available: false,
  });
}

export async function getCurrentWeatherByPlace(
  place: WeatherPlace,
  locale?: Locale,
): Promise<{ weather: WeatherSummary; error: string | null }> {
  if (place.lat == null || place.lng == null) {
    return { weather: getWeatherFallbackBySeason(place.name ?? "目的地", {}), error: "missing_coords" };
  }
  console.info("[WEATHER_FETCH] current place=", place.name ?? place.placeId ?? "unknown");
  const result = await getWeatherByLatLng({ lat: place.lat, lng: place.lng }, locale);
  if (result.error) {
    return {
      weather: getWeatherFallbackBySeason(place.name ?? result.weather.city ?? "目的地", {}),
      error: result.error,
    };
  }
  return { weather: normalizeWeather(result.weather), error: null };
}

/** 取得每日預報（含快取 + dedup） */
export async function getForecast(
  coords: WeatherCoords,
  days: number,
  locale?: Locale,
): Promise<WeatherForecastResult> {
  const d = Math.min(Math.max(days, 1), 14);
  const key = weatherCacheKey("forecast", coords.lat, coords.lng, `${d}:${locale ?? ""}`);

  return getWeatherCachedOrFetch(key, () =>
    requireFetchForecast()({
      data: { lat: coords.lat, lng: coords.lng, days: d, locale },
    }),
  );
}

export async function getForecastByPlaceAndDate(
  place: WeatherPlace,
  startDate: string,
  endDate: string,
  locale?: Locale,
): Promise<WeatherForecastResult> {
  if (place.lat == null || place.lng == null) {
    const fallback = getWeatherFallbackBySeason(place.name ?? "目的地", { startDate, endDate });
    return {
      forecast: [],
      city: fallback.city,
      available: false,
      error: "missing_coords",
    };
  }
  const span = Math.max(
    1,
    Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  console.info("[WEATHER_FETCH] forecast place=", place.name ?? place.placeId ?? "unknown");
  const result = await getForecast({ lat: place.lat, lng: place.lng }, span, locale);
  if (result.error) {
    const fallback = getWeatherFallbackBySeason(place.name ?? "目的地", { startDate, endDate });
    return {
      forecast: [],
      city: fallback.city,
      available: false,
      error: result.error,
    };
  }
  return {
    forecast: result.forecast,
    city: result.city,
    available: result.available,
    error: result.error,
  };
}

export function generateOutfitSuggestion(
  trip: {
    destinationPlace?: { name?: string } | null;
    startDate?: string;
    endDate?: string;
    transportMode?: string;
  },
  weather: WeatherSummary,
): string {
  const destination = trip.destinationPlace?.name ?? weather.city ?? "目的地";
  const month = new Date(trip.startDate || Date.now()).getMonth() + 1;
  const tempHigh = weather.tempC ?? (month >= 6 && month <= 9 ? 31 : month <= 2 || month === 12 ? 8 : 21);
  const tempLow = weather.feelsLikeC ?? tempHigh - 5;
  const rain = weather.precipProbability ?? 20;
  const transport = trip.transportMode ?? "walk";
  const walking = /walk|步行/i.test(transport);

  let suggestion = "建議洋蔥式穿搭與好走鞋。";
  if (/日本|韓國|首爾|釜山|大阪/i.test(destination) && (month === 12 || month <= 2)) {
    suggestion = "保暖外套、圍巾、手套、暖暖包，室內可脫層。";
  } else if (/泰國|bangkok|曼谷/i.test(destination) || tempHigh >= 30) {
    suggestion = "短袖、透氣衣物、防曬帽與補水，盡量安排室內避暑時段。";
  } else if (month >= 3 && month <= 5 || month >= 9 && month <= 11) {
    suggestion = "薄外套與可增減層次，早晚加件外層。";
  }
  if (rain >= 40) suggestion += " 記得帶摺疊傘或輕便雨衣。";
  if (Math.abs(tempHigh - tempLow) >= 8) suggestion += " 日夜溫差大，務必分層。";
  if (walking) suggestion += " 以步行為主，建議防滑且久走舒適的鞋。";
  console.info("[OUTFIT_GENERATED] destination=", destination);
  return suggestion;
}

/** dev：高雄市天氣連線測試 */
export async function testWeatherApiConnection(options?: {
  silent?: boolean;
}): Promise<WeatherTestResult> {
  logOpenWeatherKeyLoadedOnce();

  const testFn = requireTestWeather();
  if (!testFn) {
    const msg = "weatherService: testConnection serverFn 尚未注入";
    if (!options?.silent) console.error("❌ OpenWeather API failed", msg);
    return { ok: false, message: msg };
  }

  const result = await testFn();

  if (!options?.silent) {
    if (result.ok) {
      console.info("✅ API connected");
      console.info("temperature:", result.temperature);
      console.info("description:", result.description);
      console.info("rain probability:", result.rainProbability);
    } else {
      console.error("❌ API failed");
      console.error("status code:", result.statusCode ?? "—");
      console.error("error message:", result.message);
    }
  }

  return result;
}

/** @deprecated 使用 runApiBootstrap */
export function runDevWeatherBootstrap(fns: Parameters<typeof bindWeatherServerFns>[0]): void {
  bindWeatherServerFns(fns);
  logOpenWeatherKeyLoadedOnce();
  if (import.meta.env.DEV) void testWeatherApiConnection();
}

export type { DailyForecast, WeatherForecastResult, WeatherSummary };
