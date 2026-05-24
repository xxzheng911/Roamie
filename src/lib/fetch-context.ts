import { getPreferences } from "@/lib/preferences-storage";
import type { RoamieLocation, RoamieRequestContext } from "@/lib/ai/context";
import type { RoamieAIMode } from "@/lib/ai/context";
import type { WeatherSummary } from "@/lib/weather.functions";
import { tripLocationToRoamie } from "@/lib/location/to-roamie";
import type { TripLocation } from "@/lib/location/types";
import { resolveLocaleSync } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
import { requestDeviceLocation } from "@/lib/device-location";

type WeatherFetchInput = { lat: number; lng: number; locale?: Locale };

export type GeolocationResult = RoamieLocation & {
  usedFallback: boolean;
};

export type ClientContextBundle = {
  preferences: Awaited<ReturnType<typeof getPreferences>>;
  location: RoamieLocation;
  weather: WeatherSummary | null;
  time: string;
  usedFallbackLocation: boolean;
};

export async function getCurrentPosition(): Promise<GeolocationResult> {
  const loc = await requestDeviceLocation();
  console.info("[Weather] location context", {
    lat: loc.lat,
    lng: loc.lng,
    usedFallback: loc.usedFallback,
    permission: loc.permission,
  });
  return {
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city,
    usedFallback: loc.usedFallback,
  };
}

export async function buildClientContextBundle(
  fetchWeatherFn: (args: { data: WeatherFetchInput }) => Promise<{
    weather: WeatherSummary | null;
    error: string | null;
  }>,
): Promise<ClientContextBundle> {
  const locale = resolveLocaleSync();
  const [preferences, geo] = await Promise.all([getPreferences(), getCurrentPosition()]);
  const location: RoamieLocation = {
    lat: geo.lat,
    lng: geo.lng,
    city: geo.city,
  };

  let weather: WeatherSummary | null = null;
  try {
    const r = await fetchWeatherFn({ data: { lat: location.lat, lng: location.lng, locale } });
    console.info("[Weather] api response (context)", {
      error: r.error,
      hasWeather: Boolean(r.weather),
    });
    if (r.error) {
      console.warn("[Weather] fallback state (context):", r.error);
    }
    weather = r.weather;
    if (weather) {
      location.city = weather.city;
      console.info("[Weather] parse ok (context)", {
        city: weather.city,
        condition: weather.condition,
        tempC: weather.tempC,
      });
    }
  } catch (e) {
    console.error("[Weather] api exception (context):", e);
    weather = null;
  }

  return {
    preferences,
    location,
    weather,
    time: new Date().toISOString(),
    usedFallbackLocation: geo.usedFallback,
  };
}

/** 以旅遊目的地為中心取得天氣與位置（規劃表單用） */
export async function buildContextBundleForTrip(
  destination: TripLocation,
  fetchWeatherFn: (args: { data: WeatherFetchInput }) => Promise<{
    weather: WeatherSummary | null;
    error: string | null;
  }>,
): Promise<ClientContextBundle> {
  const locale = resolveLocaleSync();
  const preferences = await getPreferences();
  const location = tripLocationToRoamie(destination);

  let weather: WeatherSummary | null = null;
  try {
    const r = await fetchWeatherFn({ data: { lat: location.lat, lng: location.lng, locale } });
    console.info("[Weather] api response (trip)", { error: r.error, hasWeather: Boolean(r.weather) });
    if (!r.error) weather = r.weather;
    if (weather) {
      location.city =
        destination.formattedName || destination.displayLabel || destination.city || weather.city;
    }
  } catch (e) {
    console.error("[Weather] api exception (trip):", e);
  }

  return {
    preferences,
    location,
    weather,
    time: new Date().toISOString(),
    usedFallbackLocation: false,
  };
}

export function toRoamieRequest(
  mode: RoamieAIMode,
  bundle: ClientContextBundle,
  extra?: Partial<RoamieRequestContext>,
): RoamieRequestContext {
  return {
    mode,
    preferences: bundle.preferences,
    location: bundle.location,
    weather: bundle.weather,
    time: bundle.time,
    ...extra,
  };
}

/** Inclusive day count between ISO date strings (YYYY-MM-DD). */
export function daysBetweenDates(startDate: string, endDate: string): number {
  const s = new Date(`${startDate}T12:00:00`);
  const e = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(14, diff));
}
