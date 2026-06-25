import type { Locale } from "@/lib/i18n/types";
import type { WeatherSummary } from "@/lib/weather-types";
import {
  geocodeDestinationWithFallback,
  type GeocodeDestinationFn,
} from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { FetchWeatherFn } from "@/lib/ai/destination-place-recommendation";
import { unwrapWeatherResult } from "@/lib/ai/unwrap-weather-result";

export async function prefetchDestinationWeather(params: {
  destination: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
  fetchWeatherFn: FetchWeatherFn;
}): Promise<WeatherSummary | null> {
  const label = normalizeDestinationLabel(params.destination);
  try {
    const geocoded = await geocodeDestinationWithFallback({
      destination: label,
      locale: params.locale,
      geocodeFn: params.geocodeFn,
    });
    if (geocoded?.lat == null || geocoded?.lng == null) return null;
    const raw = await params.fetchWeatherFn({
      data: { lat: geocoded.lat, lng: geocoded.lng, locale: params.locale },
    });
    return unwrapWeatherResult(raw);
  } catch (e) {
    console.warn("[WEATHER_PREFETCH] failed", label, e);
    return null;
  }
}
