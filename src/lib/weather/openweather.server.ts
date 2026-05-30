import { requireOpenWeatherApiKey } from "@/lib/openweather-key-resolve.server";
import { API_CACHE_TTL_MS } from "@/lib/api/constants";
import { createServerRequestCache } from "@/lib/server-request-cache";
import {
  aggregateForecast25ToDaily,
  parseCurrentWeather25,
  parseOneCallCurrent,
  parseOneCallDailyForecast,
  type OneCallResponse,
} from "@/lib/weather/parse-openweather";
import type { DailyForecast, WeatherSummary } from "@/lib/weather-types";

const FETCH_TIMEOUT_MS = 15_000;
const OW_LANG = "zh_tw";
const OW_UNITS = "metric";

const serverCache = createServerRequestCache(API_CACHE_TTL_MS.weather);

async function cachedWeatherFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  return serverCache.getOrFetch(key, fetcher);
}

async function fetchWithTimeout(url: string, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    console.info("[WEATHER_FETCH] openWeather status=", res.status);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[WEATHER_FETCH] openWeather body=", body.slice(0, 240));
      return new Response(body, { status: res.status, statusText: res.statusText });
    }
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[OpenWeather] ${label} failed`, msg);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOneCall(lat: number, lng: number): Promise<OneCallResponse> {
  const key = requireOpenWeatherApiKey();
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lng}&appid=${key}&units=${OW_UNITS}&lang=${OW_LANG}&exclude=minutely,alerts`;
  console.info("[WEATHER_FETCH] openWeather request url=", url.replace(key, "***"));
  const res = await fetchWithTimeout(url, "onecall");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`One Call ${res.status}: ${text.slice(0, 120)}`);
  }
  return (await res.json()) as OneCallResponse;
}

async function fetchCurrent25(lat: number, lng: number): Promise<{
  json: Parameters<typeof parseCurrentWeather25>[0];
  city: string;
  tz: number;
}> {
  const key = requireOpenWeatherApiKey();
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${key}&units=${OW_UNITS}&lang=${OW_LANG}`;
  console.info("[WEATHER_FETCH] openWeather request url=", url.replace(key, "***"));
  const res = await fetchWithTimeout(url, "current");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Current ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as Parameters<typeof parseCurrentWeather25>[0] & {
    name?: string;
    timezone?: number;
  };
  return { json, city: json.name ?? "", tz: json.timezone ?? 0 };
}

async function fetchForecast25(lat: number, lng: number): Promise<{
  list: Parameters<typeof aggregateForecast25ToDaily>[0];
  tz: number;
}> {
  const key = requireOpenWeatherApiKey();
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${key}&units=${OW_UNITS}&lang=${OW_LANG}`;
  console.info("[WEATHER_FETCH] openWeather request url=", url.replace(key, "***"));
  const res = await fetchWithTimeout(url, "forecast");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Forecast ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as {
    list: Parameters<typeof aggregateForecast25ToDaily>[0];
    city?: { name?: string };
    timezone?: number;
  };
  return { list: json.list ?? [], tz: json.timezone ?? 0 };
}

/** 取得即時天氣（OpenWeather One Call → 2.5 fallback） */
export async function openWeatherGetCurrent(
  lat: number,
  lng: number,
  cityHint = "",
): Promise<WeatherSummary> {
  const cacheKey = `ow:current:${lat.toFixed(3)}:${lng.toFixed(3)}`;
  return cachedWeatherFetch(cacheKey, async () => {
    try {
      const one = await fetchOneCall(lat, lng);
      return parseOneCallCurrent(one, cityHint);
    } catch (e) {
      console.warn("[OpenWeather] onecall current failed, trying 2.5", e);
    }

    const { json, city, tz } = await fetchCurrent25(lat, lng);
    return parseCurrentWeather25(json, cityHint || city, tz);
  });
}

/** 取得每日預報（最多 14 天；OpenWeather → Open-Meteo 備援） */
export async function openWeatherGetForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<DailyForecast[]> {
  const d = Math.min(Math.max(days, 1), 14);
  const cacheKey = `ow:forecast:${lat.toFixed(3)}:${lng.toFixed(3)}:${d}`;
  return cachedWeatherFetch(cacheKey, async () => {
    const { hasOpenWeatherApiKey } = await import("@/lib/openweather-key-resolve.server");
    if (hasOpenWeatherApiKey()) {
      try {
        const one = await fetchOneCall(lat, lng);
        const forecast = parseOneCallDailyForecast(one, d);
        if (forecast.length > 0) return forecast;
      } catch (e) {
        console.warn("[OpenWeather] onecall forecast failed, trying 2.5", e);
      }

      try {
        const { list, tz } = await fetchForecast25(lat, lng);
        const forecast = aggregateForecast25ToDaily(list, tz, d);
        if (forecast.length > 0) return forecast;
      } catch (e) {
        console.warn("[OpenWeather] 2.5 forecast failed, trying open-meteo", e);
      }
    } else {
      console.warn("[OpenWeather] no API key, using open-meteo for forecast");
    }

    const { fetchOpenMeteoDailyForecast } = await import("@/lib/weather/open-meteo-client");
    const meteo = await fetchOpenMeteoDailyForecast(lat, lng, d);
    if (meteo.length > 0) {
      console.info("[WEATHER_FETCH] forecast source=open-meteo-fallback days=", meteo.length);
      return meteo;
    }
    return [];
  });
}
