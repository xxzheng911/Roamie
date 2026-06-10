import { readOpenWeatherKeyFromClientEnv } from "@/lib/openweather-key-resolve";
import {
  logOpenWeatherRequest,
  logOpenWeatherResponse,
  maskApiKey,
} from "@/lib/weather-diagnostics";
import type { WeatherSummary } from "@/lib/weather-types";
import {
  parseCurrentWeather25,
  parseOneCallCurrent,
  type OneCallResponse,
} from "@/lib/weather/parse-openweather";

const OW_LANG = "zh_tw";
const OW_UNITS = "metric";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logOpenWeatherResponse({
      transport: "client-direct",
      endpoint: label,
      ok: false,
      httpStatus: 0,
      error: msg,
    });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Capacitor bundle 無 server 時，瀏覽器直連 OpenWeather（含診斷 log） */
export async function fetchOpenWeatherCurrentClient(
  lat: number,
  lng: number,
  cityHint = "目前位置",
): Promise<{ weather: WeatherSummary | null; error: string | null }> {
  const key = readOpenWeatherKeyFromClientEnv();
  if (!key) {
    logOpenWeatherResponse({
      transport: "client-direct",
      ok: false,
      skipped: true,
      reason: "missing_client_key",
      lat,
      lng,
    });
    return { weather: null, error: "openweather_client_key_missing" };
  }

  const oneCallUrl =
    `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lng}` +
    `&appid=${key}&units=${OW_UNITS}&lang=${OW_LANG}&exclude=minutely,alerts`;

  logOpenWeatherRequest({
    transport: "client-direct",
    endpoint: "onecall",
    lat,
    lng,
    url: oneCallUrl.replace(key, "***"),
    keyPrefix: maskApiKey(key),
  });

  try {
    const res = await fetchWithTimeout(oneCallUrl, "onecall");
    const bodyText = await res.text();
    if (res.ok) {
      const json = JSON.parse(bodyText) as OneCallResponse;
      const weather = parseOneCallCurrent(json, cityHint);
      logOpenWeatherResponse({
        transport: "client-direct",
        endpoint: "onecall",
        ok: true,
        httpStatus: res.status,
        lat,
        lng,
        city: weather.city,
        tempC: weather.tempC,
        condition: weather.condition,
        available: weather.available,
        source: weather.source,
      });
      return { weather, error: null };
    }

    logOpenWeatherResponse({
      transport: "client-direct",
      endpoint: "onecall",
      ok: false,
      httpStatus: res.status,
      lat,
      lng,
      bodyPreview: bodyText.slice(0, 240),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logOpenWeatherResponse({
      transport: "client-direct",
      endpoint: "onecall",
      ok: false,
      httpStatus: 0,
      lat,
      lng,
      error: msg,
      willTryCurrent25: true,
    });
  }

  const currentUrl =
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}` +
    `&appid=${key}&units=${OW_UNITS}&lang=${OW_LANG}`;

  logOpenWeatherRequest({
    transport: "client-direct",
    endpoint: "current25",
    lat,
    lng,
    url: currentUrl.replace(key, "***"),
    keyPrefix: maskApiKey(key),
  });

  try {
    const res = await fetchWithTimeout(currentUrl, "current25");
    const bodyText = await res.text();
    if (!res.ok) {
      logOpenWeatherResponse({
        transport: "client-direct",
        endpoint: "current25",
        ok: false,
        httpStatus: res.status,
        lat,
        lng,
        bodyPreview: bodyText.slice(0, 240),
      });
      return { weather: null, error: `openweather ${res.status}` };
    }

    const json = JSON.parse(bodyText) as Parameters<typeof parseCurrentWeather25>[0] & {
      name?: string;
      timezone?: number;
    };
    const weather = parseCurrentWeather25(json, cityHint || json.name || "", json.timezone ?? 0);
    logOpenWeatherResponse({
      transport: "client-direct",
      endpoint: "current25",
      ok: true,
      httpStatus: res.status,
      lat,
      lng,
      city: weather.city,
      tempC: weather.tempC,
      condition: weather.condition,
      available: weather.available,
      source: weather.source,
    });
    return { weather, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logOpenWeatherResponse({
      transport: "client-direct",
      endpoint: "current25",
      ok: false,
      httpStatus: 0,
      lat,
      lng,
      error: msg,
    });
    return { weather: null, error: msg };
  }
}
