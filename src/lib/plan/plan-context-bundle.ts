import type { ClientContextBundle } from "@/lib/fetch-context";
import { getPreferences, type TravelPreferences } from "@/lib/preferences-storage";
import { tripLocationToRoamie } from "@/lib/location/to-roamie";
import type { TripLocation } from "@/lib/location/types";
import { resolveLocaleSync } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
import { fetchWeatherForCoords } from "@/services/weatherFetchAdapter";
import { withTimeout } from "@/lib/async/with-timeout";

type WeatherFetchInput = { lat: number; lng: number; locale?: Locale };

/** 規劃頁：天氣為 optional，逾時後仍回傳 bundle 供 AI 繼續 */
export async function buildPlanContextBundleOptionalWeather(
  destination: TripLocation,
  fetchWeatherFn: (args: { data: WeatherFetchInput }) => Promise<{
    weather: import("@/lib/weather-types").WeatherSummary | null;
    error: string | null;
  }>,
  weatherTimeoutMs = 4_000,
  preferencesOverride?: TravelPreferences,
): Promise<ClientContextBundle> {
  const locale = resolveLocaleSync();
  const preferences = preferencesOverride ?? (await getPreferences());
  const location = tripLocationToRoamie(destination);

  let weather: ClientContextBundle["weather"] = null;
  let weatherError: string | null = null;
  try {
    const r = await withTimeout(
      fetchWeatherForCoords(location.lat, location.lng, locale, fetchWeatherFn),
      weatherTimeoutMs,
      "plan_weather_fetch",
    );
    weatherError = r.error;
    if (r.weather?.available) {
      weather = r.weather;
      location.city =
        destination.formattedName ||
        destination.displayLabel ||
        destination.city ||
        weather.city;
    }
  } catch (e) {
    weatherError = e instanceof Error ? e.message : String(e);
    console.warn("[PLAN_AI] weather optional skip", weatherError);
  }

  return {
    preferences,
    location,
    weather,
    time: new Date().toISOString(),
    usedFallbackLocation: false,
  };
}
