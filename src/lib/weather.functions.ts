import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { geocodeReverseUrl } from "@/lib/google-maps-api";
import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";
import { geocodeRegionFromCoordinates } from "@/lib/geo-region";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import { buildWeatherRecommendation } from "@/lib/weather-scene";
import type { DailyForecast, WeatherSummary } from "@/lib/weather-types";

export type { DailyForecast, WeatherSummary } from "@/lib/weather-types";

const Input = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

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
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Weather] ${label} fetch failed`, msg);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocodeBigDataCloud(lat: number, lng: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
  const res = await fetchWithTimeout(url, "BigDataCloud geocode");
  if (!res.ok) {
    console.warn("[Weather] BigDataCloud geocode failed", res.status);
    return "";
  }
  const json = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  const city = json.city || json.locality || json.principalSubdivision || "";
  console.info("[Weather] parse city (BigDataCloud)", { city: city || "(empty)" });
  return city;
}

async function reverseGeocodeGoogle(
  lat: number,
  lng: number,
  apiKey: string,
  locale?: string,
): Promise<string> {
  const lang = locale ? localeToGoogleLanguageCode(coerceLocale(locale)) : "zh-TW";
  const res = await fetchWithTimeout(
    geocodeReverseUrl(lat, lng, apiKey, {
      language: lang,
      region: geocodeRegionFromCoordinates(lat, lng),
    }),
    "Google geocode",
  );
  if (!res.ok) {
    const text = await res.text();
    console.warn("[Weather] Google geocode failed", res.status, text.slice(0, 120));
    return "";
  }
  const json = (await res.json()) as {
    status?: string;
    results?: Array<{ address_components?: Array<{ long_name: string; types: string[] }> }>;
  };
  if (json.status && json.status !== "OK") {
    console.warn("[Weather] Google geocode status", json.status);
    return "";
  }
  const comps = json.results?.[0]?.address_components ?? [];
  const pick = (t: string) => comps.find((c) => c.types.includes(t))?.long_name;
  const city =
    pick("locality") || pick("administrative_area_level_2") || pick("administrative_area_level_1") || "";
  console.info("[Weather] parse city (Google)", { city: city || "(empty)" });
  return city;
}

async function reverseGeocodeCity(lat: number, lng: number, locale?: string): Promise<string> {
  try {
    const googleKey = requireGoogleMapsServerKey();
    const city = await reverseGeocodeGoogle(lat, lng, googleKey, locale);
    if (city) return city;
  } catch (e) {
    console.warn("[Weather] Google geocode skipped (no key or error)", e);
  }
  return reverseGeocodeBigDataCloud(lat, lng);
}

async function fetchOpenMeteoWeather(lat: number, lng: number): Promise<{
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconType: string;
  isDaytime: boolean;
  precip: number | null;
  humidityPercent: number | null;
  windSpeedKmh: number | null;
  sunrise: string | null;
  sunset: string | null;
}> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day,relative_humidity_2m,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
  const res = await fetchWithTimeout(url, "Open-Meteo current");
  if (!res.ok) {
    const text = await res.text();
    console.error("[Weather] Open-Meteo error", res.status, text.slice(0, 200));
    throw new Error(`Open-Meteo ${res.status}`);
  }
  const json = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      precipitation_probability?: number;
      weather_code?: number;
      is_day?: number;
      relative_humidity_2m?: number;
      wind_speed_10m?: number;
    };
    daily?: {
      sunrise?: string[];
      sunset?: string[];
    };
  };
  const c = json.current;
  const code = c?.weather_code ?? 0;
  const sunriseRaw = json.daily?.sunrise?.[0];
  const sunsetRaw = json.daily?.sunset?.[0];
  const parsed = {
    tempC: c?.temperature_2m ?? null,
    feelsLikeC: c?.apparent_temperature ?? null,
    condition: WMO_ZH[code] ?? "多雲",
    iconType: String(code),
    isDaytime: (c?.is_day ?? 1) === 1,
    precip: c?.precipitation_probability ?? null,
    humidityPercent: c?.relative_humidity_2m ?? null,
    windSpeedKmh: c?.wind_speed_10m ?? null,
    sunrise: sunriseRaw ? sunriseRaw.slice(11, 16) : null,
    sunset: sunsetRaw ? sunsetRaw.slice(11, 16) : null,
  };
  console.info("[Weather] parse current", parsed);
  return parsed;
}

export async function fetchOpenMeteoDailyForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<DailyForecast[]> {
  const d = Math.min(Math.max(days, 1), 14);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${d}`;
  const res = await fetchWithTimeout(url, "Open-Meteo daily");
  if (!res.ok) {
    const text = await res.text();
    console.error("[Weather] daily forecast error", res.status, text.slice(0, 200));
    throw new Error(`Open-Meteo daily ${res.status}`);
  }
  const json = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      weather_code?: number[];
    };
  };
  const daily = json.daily;
  const times = daily?.time ?? [];
  return times.map((date, i) => {
    const code = daily?.weather_code?.[i] ?? 0;
    return {
      date,
      tempHighC: daily?.temperature_2m_max?.[i] ?? null,
      tempLowC: daily?.temperature_2m_min?.[i] ?? null,
      precipProbability: daily?.precipitation_probability_max?.[i] ?? null,
      condition: WMO_ZH[code] ?? "多雲",
      iconType: String(code),
    };
  });
}

const ForecastInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  days: z.number().int().min(1).max(14).default(7),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

export const getWeatherForecast = createServerFn({ method: "POST" })
  .inputValidator((input) => ForecastInput.parse(input))
  .handler(
    async ({ data }): Promise<{ forecast: DailyForecast[]; city: string; error: string | null }> => {
      try {
        const [forecast, city] = await Promise.all([
          fetchOpenMeteoDailyForecast(data.lat, data.lng, data.days),
          reverseGeocodeCity(data.lat, data.lng, data.locale).catch(() => ""),
        ]);
        return { forecast, city: city || "目前位置", error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "forecast failed";
        console.error("[Weather] forecast failed:", msg);
        return { forecast: [], city: "", error: msg };
      }
    },
  );

export const getWeather = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }): Promise<{ weather: WeatherSummary | null; error: string | null }> => {
    console.info("[Weather] api request", { lat: data.lat, lng: data.lng, locale: data.locale });
    try {
      const [wx, city] = await Promise.all([
        fetchOpenMeteoWeather(data.lat, data.lng),
        reverseGeocodeCity(data.lat, data.lng, data.locale).catch((e) => {
          console.warn("[Weather] geocode failed, continuing without city", e);
          return "";
        }),
      ]);

      const { rec, text, scene } = buildWeatherRecommendation({
        tempC: wx.tempC,
        precipProbability: wx.precip,
        condition: wx.condition,
        isDaytime: wx.isDaytime,
      });

      const summary: WeatherSummary = {
        city: city || "目前位置",
        tempC: wx.tempC,
        feelsLikeC: wx.feelsLikeC,
        condition: wx.condition,
        iconType: wx.iconType,
        isDaytime: wx.isDaytime,
        precipProbability: wx.precip,
        humidityPercent: wx.humidityPercent,
        windSpeedKmh: wx.windSpeedKmh,
        sunrise: wx.sunrise,
        sunset: wx.sunset,
        recommendation: rec,
        recommendationText: text,
      };

      console.info("[Weather] api ok", {
        city: summary.city,
        scene,
        condition: summary.condition,
        tempC: summary.tempC,
        isDaytime: summary.isDaytime,
      });

      return { weather: summary, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      console.error("[Weather] api failed:", msg);
      return { weather: null, error: msg };
    }
  });
