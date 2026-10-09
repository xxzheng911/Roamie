import { destinationDate, tripCalendarDates, selectTripForecast, validWeatherCoords, TRIP_WEATHER_VERSION } from "@/lib/outfit/trip-weather-policy";
import { requireOpenWeatherApiKey } from "@/lib/openweather-key-resolve.server";
import {
  logOpenWeatherRequest,
  logOpenWeatherResponse,
  maskApiKey,
} from "@/lib/weather-diagnostics";
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
      logOpenWeatherResponse({
        transport: "server",
        endpoint: label,
        ok: false,
        httpStatus: res.status,
        bodyPreview: body.slice(0, 240),
      });
      return new Response(body, { status: res.status, statusText: res.statusText });
    }
    // Consume the body before clearing the deadline (headers alone are not completion).
    return new Response(await res.text(), { status: res.status, statusText: res.statusText, headers: res.headers });
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
  logOpenWeatherRequest({
    transport: "server",
    endpoint: "onecall",
    lat,
    lng,
    url: url.replace(key, "***"),
    keyPrefix: maskApiKey(key),
  });
  const res = await fetchWithTimeout(url, "onecall");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`One Call ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as OneCallResponse;
  logOpenWeatherResponse({
    transport: "server",
    endpoint: "onecall",
    ok: true,
    httpStatus: res.status,
    lat,
    lng,
    hasCurrent: Boolean(json.current),
  });
  return json;
}

async function fetchCurrent25(lat: number, lng: number): Promise<{
  json: Parameters<typeof parseCurrentWeather25>[0];
  city: string;
  tz: number;
}> {
  const key = requireOpenWeatherApiKey();
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${key}&units=${OW_UNITS}&lang=${OW_LANG}`;
  console.info("[WEATHER_FETCH] openWeather request url=", url.replace(key, "***"));
  logOpenWeatherRequest({
    transport: "server",
    endpoint: "current25",
    lat,
    lng,
    url: url.replace(key, "***"),
    keyPrefix: maskApiKey(key),
  });
  const res = await fetchWithTimeout(url, "current");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Current ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = (await res.json()) as Parameters<typeof parseCurrentWeather25>[0] & {
    name?: string;
    timezone?: number;
  };
  logOpenWeatherResponse({
    transport: "server",
    endpoint: "current25",
    ok: true,
    httpStatus: res.status,
    lat,
    lng,
    city: json.name ?? null,
  });
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
    city?: { name?: string; timezone?: number };
  };
  if (!Number.isFinite(json.city?.timezone)) throw new Error("Forecast timezone unavailable");
  return { list: json.list ?? [], tz: json.city!.timezone! };
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

    const { json, tz } = await fetchCurrent25(lat, lng);
    // `name` is the nearest GeoNames populated place (for example Lindefu / 林德富),
    // not a city or district. Home display must not inherit that token.
    return parseCurrentWeather25(json, cityHint, tz);
  });
}

/** 取得每日預報（最多 14 天；One Call 約 8 天） */
export async function openWeatherGetForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<DailyForecast[]> {
  const d = Math.min(Math.max(days, 1), 14);
  const cacheKey = `ow:forecast:${lat.toFixed(3)}:${lng.toFixed(3)}:${d}`;
  return cachedWeatherFetch(cacheKey, async () => {
    try {
      const one = await fetchOneCall(lat, lng);
      const forecast = parseOneCallDailyForecast(one, d);
      if (forecast.length > 0) return forecast;
    } catch (e) {
      console.warn("[OpenWeather] onecall forecast failed, trying 2.5", e);
    }

    const { list, tz } = await fetchForecast25(lat, lng);
    return aggregateForecast25ToDaily(list, tz, d);
  });
}


/** Trip-only boundary: exact local calendar coverage; never relabel the first N days. */
export async function openWeatherGetTripForecast(input: {
  destination: string; lat: number; lng: number; startDate: string; endDate: string;
  timezone?: string; utcOffsetMinutes?: number | null;
}): Promise<DailyForecast[]> {
  const dates = tripCalendarDates(input.startDate, input.endDate);
  if (!dates.length || !validWeatherCoords(input.lat, input.lng)) return [];
  const today = destinationDate(Date.now(), input.timezone,
    input.utcOffsetMinutes == null ? undefined : input.utcOffsetMinutes * 60);
  // Without a known zone, use a conservative UTC +/- one-day envelope only to skip
  // impossible requests. Actual selection always uses provider-local calendar dates.
  const nowDay = Date.parse(today ?? new Date().toISOString().slice(0, 10));
  const first = Date.parse(dates[0]);
  const last = Date.parse(dates[dates.length - 1]);
  if (first < nowDay - (today ? 0 : 86_400_000) || last > nowDay + (today ? 7 : 8) * 86_400_000) return [];
  const key = JSON.stringify([TRIP_WEATHER_VERSION, "openweather", input]);
  return tripForecastCache.getOrFetch(key, async () => {
    try {
      const one = await fetchOneCall(input.lat, input.lng);
      const zone = input.timezone ?? one.timezone;
      if (!zone && !Number.isFinite(one.timezone_offset)) return [];
      // A valid provider response with missing dates is not a reason for more calls.
      return selectTripForecast(parseOneCallDailyForecast(one, 8, zone), dates);
    } catch {
      try {
        const { list, tz } = await fetchForecast25(input.lat, input.lng);
        return selectTripForecast(aggregateForecast25ToDaily(list, tz, 8, input.timezone, true), dates);
      } catch { return []; }
    }
  });
}
const tripForecastCache = createServerRequestCache(API_CACHE_TTL_MS.weather);
