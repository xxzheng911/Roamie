import type { Locale } from "@/lib/i18n/types";
import {
  ensureEffectiveLocationBootstrap,
  getEffectiveLocationSnapshot,
  subscribeEffectiveLocation,
  type EffectiveLocationSnapshot,
} from "@/lib/effective-location";
import {
  getWeatherFetchInFlight,
  markWeatherFetchStarted,
  registerWeatherFetchInFlight,
  shouldSkipWeatherFetch,
  weatherCoordKey,
} from "@/lib/home-weather-fetch-policy";
import {
  readHomeSessionUserLocation,
  readHomeSessionWeather,
  writeHomeSessionWeather,
} from "@/lib/home-session-cache";
import { rememberLastSearchLocation } from "@/lib/last-search-location";
import type { WeatherSummary } from "@/lib/weather-types";
import type { HomeSessionUserLocation } from "@/lib/home-session-cache";
import type { LocationPermissionState } from "@/lib/device-location";

/** 避免與主 bundle 循環依賴（Capacitor 啟動時會拿到 undefined export） */
function logHomeWeather(event: string, extra?: Record<string, unknown>): void {
  console.info("[HOME_WEATHER]", event, extra ?? {});
}

function logWeatherFetch(event: string, extra?: Record<string, unknown>): void {
  console.info("[WEATHER_FETCH]", event, extra ?? {});
}

export type HomeWeatherBootstrapState = {
  weather: WeatherSummary | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  userLocation: HomeSessionUserLocation | null;
  usedFallbackLocation: boolean;
  locationPermission: LocationPermissionState;
};

const FETCH_TIMEOUT_MS = 20_000;

type Listener = () => void;
const listeners = new Set<Listener>();

let bootstrapped = false;
let locale: Locale = "zh-TW";
let loadId = 0;
let hasDisplayedWeather = Boolean(readHomeSessionWeather()?.available);
let lastAppliedCoordKey = "";

let state: HomeWeatherBootstrapState = {
  weather: readHomeSessionWeather(),
  status: readHomeSessionWeather() ? "ready" : "loading",
  error: null,
  userLocation: readHomeSessionUserLocation(),
  usedFallbackLocation: false,
  locationPermission: "unknown",
};

function unavailableWeatherSummary(city: string): WeatherSummary {
  return {
    city: city || "目前位置",
    tempC: null,
    feelsLikeC: null,
    condition: "",
    iconType: "",
    isDaytime: true,
    precipProbability: null,
    humidityPercent: null,
    windSpeedKmh: null,
    cloudCoverPercent: null,
    uvi: null,
    sunrise: null,
    sunset: null,
    recommendation: "indoor",
    recommendationText: "天氣暫時無法取得，稍後重試。",
    source: "unavailable",
    fetchedAt: new Date().toISOString(),
    available: false,
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function patchState(patch: Partial<HomeWeatherBootstrapState>): void {
  state = { ...state, ...patch };
  notify();
}

export function subscribeHomeWeatherBootstrap(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHomeWeatherBootstrapState(): HomeWeatherBootstrapState {
  return state;
}

/** 與 homeNearbyLoadKey 相同精度，避免 GPS 微調反覆 patch state */
function coordBucketKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

function coordsEqual(
  a: { lat: number; lng: number } | null | undefined,
  b: { lat: number; lng: number },
): boolean {
  if (a == null) return false;
  return coordBucketKey(a.lat, a.lng) === coordBucketKey(b.lat, b.lng);
}

/** @returns true when state was patched (coords changed) */
function applyEffectiveLocation(eff: EffectiveLocationSnapshot): boolean {
  if (eff.locationKey === lastAppliedCoordKey) {
    console.info("[LOCATION_PATCH_SKIP_SAME_KEY]", {
      locationKey: eff.locationKey,
      via: "home_weather",
    });
    return false;
  }

  const prev = state.userLocation;
  const next: HomeSessionUserLocation = {
    lat: eff.lat,
    lng: eff.lng,
    city: eff.city || "",
    source: eff.source === "gps" ? "capacitor" : "fallback",
  };
  if (coordsEqual(prev, next)) {
    console.info("[LOCATION_PATCH_SKIP_SAME_KEY]", {
      locationKey: eff.locationKey,
      via: "home_weather_coords",
    });
    return false;
  }

  if (import.meta.env.DEV) {
    console.info("[LOCATION_UPDATE]", {
      trigger: "effective_location",
      lat: eff.lat,
      lng: eff.lng,
      locationKey: eff.locationKey,
      source: eff.source,
    });
    logHomeWeather("location_applied", {
      lat: eff.lat,
      lng: eff.lng,
      city: eff.city || null,
      source: eff.source,
      locationKey: eff.locationKey,
    });
  }

  lastAppliedCoordKey = eff.locationKey;
  console.info("[LOCATION_PATCH_APPLIED]", {
    locationKey: eff.locationKey,
    lat: eff.lat,
    lng: eff.lng,
    via: "home_weather",
  });
  patchState({
    userLocation: next,
    usedFallbackLocation: eff.isFallback,
    locationPermission: eff.permission,
  });
  return true;
}

async function fetchWeatherForCoords(
  lat: number,
  lng: number,
  locMeta: {
    city: string;
    usedFallback: boolean;
    source: "capacitor" | "browser" | "fallback";
    permission: LocationPermissionState;
  },
  options?: { force?: boolean; showLoading?: boolean },
): Promise<void> {
  const fetchKey = weatherCoordKey(lat, lng, locale);
  const force = options?.force === true;

  if (!force && shouldSkipWeatherFetch(fetchKey)) {
    logHomeWeather("fetch_skip_ttl", { key: fetchKey, lat, lng });
    logWeatherFetch("skip_ttl", { key: fetchKey, trigger: "location_effect", lat, lng });
    return;
  }

  const inFlight = getWeatherFetchInFlight(fetchKey);
  if (!force && inFlight) {
    logHomeWeather("fetch_skip_in_flight", { key: fetchKey, lat, lng });
    logWeatherFetch("skip_in_flight", { key: fetchKey, trigger: "location_effect", lat, lng });
    await inFlight;
    return;
  }

  const showLoading = options?.showLoading !== false && !hasDisplayedWeather;
  if (showLoading) {
    patchState({ status: "loading", error: null });
  }

  const currentLoadId = ++loadId;
  markWeatherFetchStarted(fetchKey);

  const runFetch = async () => {
    logHomeWeather("requesting_weather", {
      lat,
      lng,
      city: locMeta.city || "目前位置",
      fetchKey,
      force: force ?? false,
      locSource: locMeta.source,
      usedFallback: locMeta.usedFallback,
    });
    logWeatherFetch("bootstrap_latLng", { lat, lng, fetchKey, force: force ?? false });

    try {
      const { getCurrentWeather } = await import(
        /* @vite-ignore */ "@/services/weatherService"
      );
      const result = await Promise.race([
        getCurrentWeather({ lat, lng }, locale),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("weather timeout")), FETCH_TIMEOUT_MS);
        }),
      ]);

      if (currentLoadId !== loadId) return;

      const parsed = {
        ...result.weather,
        city: result.weather.city || locMeta.city || "目前位置",
      };
      hasDisplayedWeather = true;
      writeHomeSessionWeather(parsed);
      if (parsed.available) {
        rememberLastSearchLocation({ lat, lng, city: parsed.city });
      }
      logHomeWeather("result", {
        city: parsed.city,
        condition: parsed.condition,
        tempC: parsed.tempC,
        available: parsed.available,
        source: parsed.source,
      });
      logWeatherFetch("bootstrap_response", {
        lat,
        lng,
        city: parsed.city,
        condition: parsed.condition,
        tempC: parsed.tempC,
        available: parsed.available,
        source: parsed.source,
      });
      patchState({
        weather: parsed,
        status: "ready",
        error: result.error && !parsed.available ? result.error : null,
      });
    } catch (e) {
      if (currentLoadId !== loadId) return;
      const msg = e instanceof Error ? e.message : String(e);
      logHomeWeather("error", { lat, lng, message: msg });
      logWeatherFetch("bootstrap_error", { lat, lng, error: msg });
      const fallback = unavailableWeatherSummary(locMeta.city);
      hasDisplayedWeather = true;
      writeHomeSessionWeather(fallback);
      patchState({
        weather: fallback,
        status: "ready",
        error: msg,
      });
    }
  };

  await registerWeatherFetchInFlight(fetchKey, runFetch());
}

async function loadWeather(options?: { force?: boolean; showLoading?: boolean }): Promise<void> {
  const eff = await ensureEffectiveLocationBootstrap();
  if (!eff.isReadyForPlaces) return;

  applyEffectiveLocation(eff);
  await fetchWeatherForCoords(
    eff.lat,
    eff.lng,
    {
      city: eff.city,
      usedFallback: eff.isFallback,
      source: eff.source === "gps" ? "capacitor" : "fallback",
      permission: eff.permission,
    },
    options,
  );
}

/** App shell / Home 共用；只初始化一次 */
export function ensureHomeWeatherBootstrap(nextLocale: Locale, source: string): void {
  locale = nextLocale;
  logHomeWeather("ensure", { source, bootstrapped });

  if (bootstrapped) return;
  bootstrapped = true;

  console.info("[WEATHER_SERVICE_VERSION] v-runtime-fallback-001");
  logHomeWeather("mounted", { source });
  logWeatherFetch("bootstrap_start", { source });

  const hasCachedWeather = Boolean(readHomeSessionWeather()?.available);
  void loadWeather({ showLoading: !hasCachedWeather });
}

/**
 * 首頁天氣：訂閱 effective location store（不建立 GPS watch）。
 */
export function subscribeHomeWeatherLocationWatch(): () => void {
  let lastKey = getEffectiveLocationSnapshot()?.locationKey ?? "";
  return subscribeEffectiveLocation(() => {
    const eff = getEffectiveLocationSnapshot();
    if (!eff?.isReadyForPlaces) return;
    if (eff.locationKey === lastKey) return;
    lastKey = eff.locationKey;
    if (!applyEffectiveLocation(eff)) return;
    void fetchWeatherForCoords(
      eff.lat,
      eff.lng,
      {
        city: eff.city,
        usedFallback: eff.isFallback,
        source: eff.source === "gps" ? "capacitor" : "fallback",
        permission: eff.permission,
      },
      { showLoading: false },
    );
  });
}

export function reloadHomeWeatherBootstrap(nextLocale: Locale): void {
  locale = nextLocale;
  void loadWeather({ force: true, showLoading: true });
}
