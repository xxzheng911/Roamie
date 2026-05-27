import { buildWeatherRecommendation } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";

const WMO_ZH: Record<number, string> = {
  0: "晴朗",
  1: "大致晴朗",
  2: "多雲",
  3: "陰天",
  45: "有霧",
  48: "霧凇",
  51: "毛毛雨",
  53: "毛毛雨",
  55: "毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  80: "陣雨",
  81: "陣雨",
  82: "強陣雨",
  95: "雷雨",
};

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, label: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Weather] client ${label} failed`, { url, error: msg });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocodeCityClient(lat: number, lng: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
  const res = await fetchWithTimeout(url, "BigDataCloud");
  if (!res.ok) {
    console.warn("[Weather] client geocode http", res.status);
    return "";
  }
  const json = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  return json.city || json.locality || json.principalSubdivision || "";
}

/** 瀏覽器直連 Open-Meteo（bundled 在 serverFn 失敗時使用） */
export async function fetchWeatherClientDirect(
  lat: number,
  lng: number,
): Promise<{ weather: WeatherSummary | null; error: string | null }> {
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day,relative_humidity_2m,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
  console.info("[Weather] client direct request", { lat, lng, openMeteoUrl });

  try {
    const [meteoRes, city] = await Promise.all([
      fetchWithTimeout(openMeteoUrl, "Open-Meteo"),
      reverseGeocodeCityClient(lat, lng).catch((e) => {
        console.warn("[Weather] client geocode error", e);
        return "";
      }),
    ]);

    if (!meteoRes.ok) {
      const text = await meteoRes.text();
      const err = `Open-Meteo HTTP ${meteoRes.status}: ${text.slice(0, 120)}`;
      console.error("[Weather] client direct failed", err);
      return { weather: null, error: err };
    }

    const json = (await meteoRes.json()) as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        precipitation_probability?: number;
        weather_code?: number;
        is_day?: number;
        relative_humidity_2m?: number;
        wind_speed_10m?: number;
      };
      daily?: { sunrise?: string[]; sunset?: string[] };
    };

    const c = json.current;
    const code = c?.weather_code ?? 0;
    const condition = WMO_ZH[code] ?? "多雲";
    const { rec, text } = buildWeatherRecommendation({
      tempC: c?.temperature_2m ?? null,
      precipProbability: c?.precipitation_probability ?? null,
      condition,
      isDaytime: (c?.is_day ?? 1) === 1,
    });

    const summary: WeatherSummary = {
      city: city || "目前位置",
      tempC: c?.temperature_2m ?? null,
      feelsLikeC: c?.apparent_temperature ?? null,
      condition,
      iconType: String(code),
      isDaytime: (c?.is_day ?? 1) === 1,
      precipProbability: c?.precipitation_probability ?? null,
      humidityPercent: c?.relative_humidity_2m ?? null,
      windSpeedKmh: c?.wind_speed_10m ?? null,
      sunrise: json.daily?.sunrise?.[0]?.slice(11, 16) ?? null,
      sunset: json.daily?.sunset?.[0]?.slice(11, 16) ?? null,
      recommendation: rec,
      recommendationText: text,
    };

    console.info("[Weather] client direct ok", {
      city: summary.city,
      condition: summary.condition,
      tempC: summary.tempC,
    });
    return { weather: summary, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Weather] client direct exception", msg);
    return { weather: null, error: msg };
  }
}
