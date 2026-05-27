import { buildWeatherSummaryFromOpenMeteo } from "@/lib/weather/open-meteo-client";
import type { WeatherSummary } from "@/lib/weather-types";
import { detectPlatform } from "@/services/platform";

/** Native Capacitor has no TanStack Start server — fetch weather on device. */
export function shouldUseClientWeatherFetch(): boolean {
  if (typeof window === "undefined") return false;
  return detectPlatform().isCapacitor;
}

export async function fetchClientWeather(
  lat: number,
  lng: number,
  cityHint?: string,
): Promise<{ weather: WeatherSummary; error: null }> {
  console.info("[WEATHER_FETCH] client-native-fallback");
  console.info("[WEATHER_FETCH] fallback source=open-meteo-fallback");
  const weather = await buildWeatherSummaryFromOpenMeteo(lat, lng, cityHint);
  console.info("[WEATHER_FETCH] openWeather status=", "client-open-meteo");
  console.info("[WEATHER_FETCH] final result=", JSON.stringify(weather));
  return { weather, error: null };
}
