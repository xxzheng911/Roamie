import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { KAOHSIUNG_COORDS } from "@/lib/api/constants";
import { geocodeReverseUrl } from "@/lib/google-maps-api";
import { geocodeRegionFromCoordinates } from "@/lib/geo-region";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import { buildUnavailableWeatherSummary } from "@/lib/weather-scene";
import type { DailyForecast, WeatherForecastResult, WeatherSummary } from "@/lib/weather-types";

export type { DailyForecast, WeatherSummary, WeatherForecastResult } from "@/lib/weather-types";

const Input = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

async function reverseGeocodeBigDataCloud(lat: number, lng: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
  const res = await fetch(url);
  if (!res.ok) return "";
  const json = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  return json.city || json.locality || json.principalSubdivision || "";
}

async function reverseGeocodeGoogle(
  lat: number,
  lng: number,
  apiKey: string,
  locale?: string,
): Promise<string> {
  const lang = locale ? localeToGoogleLanguageCode(coerceLocale(locale)) : "zh-TW";
  const res = await fetch(
    geocodeReverseUrl(lat, lng, apiKey, {
      language: lang,
      region: geocodeRegionFromCoordinates(lat, lng),
    }),
  );
  if (!res.ok) return "";
  const json = (await res.json()) as {
    status?: string;
    results?: Array<{ address_components?: Array<{ long_name: string; types: string[] }> }>;
  };
  if (json.status && json.status !== "OK") return "";
  const comps = json.results?.[0]?.address_components ?? [];
  const pick = (t: string) => comps.find((c) => c.types.includes(t))?.long_name;
  return (
    pick("locality") ||
    pick("administrative_area_level_2") ||
    pick("administrative_area_level_1") ||
    ""
  );
}

async function reverseGeocodeCity(lat: number, lng: number, locale?: string): Promise<string> {
  try {
    const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
    const googleKey = requireGoogleMapsServerKey();
    const city = await reverseGeocodeGoogle(lat, lng, googleKey, locale);
    if (city) return city;
  } catch {
    /* no google key */
  }
  return reverseGeocodeBigDataCloud(lat, lng);
}

import { buildWeatherSummaryFromOpenMeteo } from "@/lib/weather/open-meteo-client";

/** @deprecated 使用 openWeatherGetForecast；保留名稱供舊 import */
export async function fetchOpenMeteoDailyForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<DailyForecast[]> {
  const { openWeatherGetForecast } = await import("@/lib/weather/openweather.server");
  return openWeatherGetForecast(lat, lng, days);
}

const ForecastInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  days: z.number().int().min(1).max(14).default(7),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

export const getWeatherForecast = createServerFn({ method: "POST" })
  .inputValidator((input) => ForecastInput.parse(input))
  .handler(async ({ data }): Promise<WeatherForecastResult> => {
    try {
      const { openWeatherGetForecast } = await import("@/lib/weather/openweather.server");
      const [forecast, city] = await Promise.all([
        openWeatherGetForecast(data.lat, data.lng, data.days),
        reverseGeocodeCity(data.lat, data.lng, data.locale).catch(() => ""),
      ]);
      return {
        forecast,
        city: city || "目前位置",
        error: null,
        available: forecast.length > 0,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "forecast failed";
      console.error("[Weather] OpenWeather forecast failed:", msg);
      return { forecast: [], city: "", error: msg, available: false };
    }
  });

export const getWeather = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }): Promise<{ weather: WeatherSummary | null; error: string | null }> => {
    const { hasOpenWeatherApiKey } = await import("@/lib/openweather-key-resolve.server");
    console.info("[WEATHER_SERVICE_VERSION] v-runtime-fallback-001");
    console.info("[WEATHER_FETCH] start");
    console.info("[WEATHER_FETCH] keyLoaded=", hasOpenWeatherApiKey());
    console.info("[WEATHER_FETCH] latLng=", `${data.lat},${data.lng}`);
    try {
      const openWeatherUrl =
        `https://api.openweathermap.org/data/3.0/onecall?lat=${data.lat}&lon=${data.lng}` +
        "&appid=***&units=metric&lang=zh_tw&exclude=minutely,alerts";
      console.info("[WEATHER_FETCH] openWeather request url=", openWeatherUrl);
      const { openWeatherGetCurrent } = await import("@/lib/weather/openweather.server");
      const city = await reverseGeocodeCity(data.lat, data.lng, data.locale).catch(() => "");
      const summary = await openWeatherGetCurrent(data.lat, data.lng, city);
      if (city && summary.city === "目前位置") {
        summary.city = city;
      }
      console.info("[WEATHER_FETCH] openWeather status=", 200);
      console.info(
        "[WEATHER_FETCH] openWeather body=",
        JSON.stringify({
          city: summary.city,
          condition: summary.condition,
          temperature: summary.tempC,
          available: summary.available,
          source: summary.source,
        }),
      );
      console.info("[WEATHER_FETCH] final result=", JSON.stringify(summary));
      return { weather: summary, error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      console.error("[Weather] OpenWeather current failed:", msg);
      console.error("[WEATHER_FETCH] openWeather status=", "error");
      console.error("[WEATHER_FETCH] openWeather body=", msg);
      console.info("[WEATHER_FETCH] fallback start");
      try {
        const summary = await buildWeatherSummaryFromOpenMeteo(data.lat, data.lng);
        console.info("[WEATHER_FETCH] fallback source=open-meteo-fallback");
        console.info("[WEATHER_FETCH] final result=", JSON.stringify(summary));
        return { weather: summary, error: null };
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.error("[WEATHER_FETCH] fallback_error=", fallbackMsg);
        const fallback = buildUnavailableWeatherSummary();
        console.info("[WEATHER_FETCH] final result=", JSON.stringify(fallback));
        return { weather: fallback, error: msg };
      }
    }
  });

/** dev / 連線測試：高雄市天氣 */
export const weatherTestConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { lat, lng } = KAOHSIUNG_COORDS;
  try {
    const { openWeatherGetCurrent, openWeatherGetForecast } =
      await import("@/lib/weather/openweather.server");
    const [summary, forecast] = await Promise.all([
      openWeatherGetCurrent(lat, lng, "高雄"),
      openWeatherGetForecast(lat, lng, 3),
    ]);
    const today = forecast[0];
    return {
      ok: true as const,
      city: summary.city,
      temperature: summary.tempC,
      description: summary.condition,
      rainProbability: today?.precipProbability ?? summary.precipProbability ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenWeather test failed";
    console.error("[Weather] test connection failed:", msg);
    return { ok: false as const, statusCode: 0, message: msg };
  }
});
