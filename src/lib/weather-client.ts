/**
 * @deprecated 請改用 @/services/weatherService（OpenWeather via serverFn）。
 * 保留此檔僅供舊 import 過渡；不再直連 Open-Meteo。
 */
import type { WeatherSummary } from "@/lib/weather-types";
import { buildUnavailableWeatherSummary } from "@/lib/weather-scene";

export async function fetchWeatherClientDirect(
  _lat: number,
  _lng: number,
): Promise<{ weather: WeatherSummary | null; error: string | null }> {
  console.warn("[Weather] fetchWeatherClientDirect is deprecated; use weatherService");
  return {
    weather: buildUnavailableWeatherSummary(),
    error: "client_direct_disabled",
  };
}
