import type { Locale } from "@/lib/i18n/types";
import { KAOHSIUNG_COORDS } from "@/lib/api/constants";
import {
  requestDeviceLocation,
  shouldDeferUntilGpsFix,
  shouldUseRememberedLocationFallback,
  subscribeDeviceLocation,
  waitForDeviceGpsFix,
  type LocationPermissionState,
} from "@/lib/device-location";
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
  writeHomeSessionUserLocation,
  writeHomeSessionWeather,
} from "@/lib/home-session-cache";
import { rememberLastSearchLocation, readLastSearchLocation } from "@/lib/last-search-location";
import { getCurrentWeather } from "@/services/weatherService";
import type { WeatherSummary } from "@/lib/weather-types";
import type { HomeSessionUserLocation } from "@/lib/home-session-cache";

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
let stopLocationWatch: (() => void) | null = null;

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

function applyLocation(loc: Awaited<ReturnType<typeof requestDeviceLocation>>): void {
  console.info("[HOME_WEATHER] location applied", {
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city || null,
    source: loc.source,
    usedFallback: loc.usedFallback,
    permission: loc.permission,
  });
  const next: HomeSessionUserLocation = {
    lat: loc.lat,
    lng: loc.lng,
    city: loc.city || "",
    source: loc.source,
  };
  writeHomeSessionUserLocation(next);
  patchState({
    userLocation: next,
    usedFallbackLocation: loc.usedFallback,
    locationPermission: loc.permission,
  });
}

function resolveWeatherLocationFallback(
  loc: Awaited<ReturnType<typeof requestDeviceLocation>>,
) {
  if (!loc.usedFallback) return loc;
  const mapCenter = readLastSearchLocation();
  if (mapCenter) {
    return {
      ...loc,
      lat: mapCenter.lat,
      lng: mapCenter.lng,
      city: mapCenter.city ?? loc.city,
      usedFallback: true,
      source: "fallback" as const,
    };
  }
  if (loc.city?.trim()) return loc;
  return {
    ...loc,
    lat: KAOHSIUNG_COORDS.lat,
    lng: KAOHSIUNG_COORDS.lng,
    city: "高雄市",
    usedFallback: true,
    source: "fallback" as const,
  };
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
    console.info("[HOME_WEATHER] WEATHER_FETCH_SKIP_TTL", { key: fetchKey });
    return;
  }

  const inFlight = getWeatherFetchInFlight(fetchKey);
  if (!force && inFlight) {
    console.info("[HOME_WEATHER] WEATHER_FETCH_SKIP_IN_FLIGHT", { key: fetchKey });
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
    console.info("[HOME_WEATHER] requesting weather");
    console.info("[HOME_WEATHER] location=", `${lat},${lng}|city=${locMeta.city || "目前位置"}`);
    console.info("[WEATHER_FETCH] latLng=", `${lat},${lng}`);

    try {
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
      console.info("[HOME_WEATHER] result=", JSON.stringify(parsed));
      console.info(
        "[WEATHER_FETCH] response=",
        `${parsed.city}|${parsed.condition}|${parsed.tempC ?? "na"}|available=${parsed.available}`,
      );
      patchState({
        weather: parsed,
        status: "ready",
        error: result.error && !parsed.available ? result.error : null,
      });
    } catch (e) {
      if (currentLoadId !== loadId) return;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[HOME_WEATHER] error=", msg);
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
  let rawLoc = await requestDeviceLocation();

  applyLocation(rawLoc);
  console.info("[HOME_NEARBY] location-ready", {
    lat: rawLoc.lat,
    lng: rawLoc.lng,
    usedFallback: rawLoc.usedFallback,
    permission: rawLoc.permission,
    source: rawLoc.source,
  });

  if (shouldDeferUntilGpsFix(rawLoc)) {
    console.info("[HOME_WEATHER] waiting for GPS fix before weather fetch");
    const gpsFix = await waitForDeviceGpsFix(20_000);
    if (gpsFix) {
      rawLoc = gpsFix;
      applyLocation(rawLoc);
      console.info("[HOME_WEATHER] using GPS fix", { lat: gpsFix.lat, lng: gpsFix.lng });
    } else {
      console.info("[HOME_WEATHER] GPS wait timeout — proceeding with available coordinates", {
        lat: rawLoc.lat,
        lng: rawLoc.lng,
        usedFallback: rawLoc.usedFallback,
      });
    }
  }

  const loc = shouldUseRememberedLocationFallback(rawLoc)
    ? resolveWeatherLocationFallback(rawLoc)
    : rawLoc;

  applyLocation(loc);
  await fetchWeatherForCoords(
    loc.lat,
    loc.lng,
    {
      city: loc.city,
      usedFallback: loc.usedFallback,
      source: loc.source,
      permission: loc.permission,
    },
    options,
  );
}

/** App shell / Home 共用；只初始化一次 */
export function ensureHomeWeatherBootstrap(nextLocale: Locale, source: string): void {
  locale = nextLocale;
  console.info("[HOME_WEATHER] ensure", { source, bootstrapped });

  if (bootstrapped) return;
  bootstrapped = true;

  console.info("[WEATHER_SERVICE_VERSION] v-runtime-fallback-001");
  console.info("[HOME_WEATHER] mounted", { source });
  console.info("[WEATHER_FETCH] start", { source });

  const hasCachedWeather = Boolean(readHomeSessionWeather()?.available);
  void loadWeather({ showLoading: !hasCachedWeather });

  if (!stopLocationWatch) {
    stopLocationWatch = subscribeDeviceLocation((loc) => {
      if (loc.usedFallback) return;
      applyLocation(loc);
      void fetchWeatherForCoords(
        loc.lat,
        loc.lng,
        {
          city: loc.city,
          usedFallback: loc.usedFallback,
          source: loc.source,
          permission: loc.permission,
        },
        { showLoading: false },
      );
    });
  }
}

export function reloadHomeWeatherBootstrap(nextLocale: Locale): void {
  locale = nextLocale;
  void loadWeather({ force: true, showLoading: true });
}
