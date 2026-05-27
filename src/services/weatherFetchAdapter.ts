import type { Locale } from "@/lib/i18n/types";
import { fetchClientWeather, shouldUseClientWeatherFetch } from "@/lib/weather/client-weather-fetch";
import type { WeatherSummary } from "@/lib/weather-types";
import { getCurrentWeather } from "@/services/weatherService";

type WeatherServerFn = (args: {
  data: { lat: number; lng: number; locale?: Locale };
}) => Promise<{ weather: WeatherSummary | null; error: string | null }>;

/** Single weather entry for home, chat context, and AI bundle — uses client Open-Meteo on native. */
export async function fetchWeatherForCoords(
  lat: number,
  lng: number,
  locale?: Locale,
  serverFn?: WeatherServerFn,
): Promise<{ weather: WeatherSummary | null; error: string | null }> {
  if (shouldUseClientWeatherFetch()) {
    try {
      return await fetchClientWeather(lat, lng);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[WEATHER_FETCH] client-native error=", msg);
      return { weather: null, error: msg };
    }
  }

  try {
    const viaService = await getCurrentWeather({ lat, lng }, locale);
    if (viaService.weather?.available) return viaService;
  } catch (e) {
    console.warn("[WEATHER_FETCH] weatherService failed", e);
  }

  if (serverFn) {
    try {
      const r = await serverFn({ data: { lat, lng, locale } });
      if (r.weather?.available) return r;
    } catch (e) {
      console.warn("[WEATHER_FETCH] serverFn failed", e);
    }
  }

  try {
    return await fetchClientWeather(lat, lng);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { weather: null, error: msg };
  }
}
