import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n/types";
import {
  readBootstrapDeviceLocation,
  requestDeviceLocation,
  watchDeviceLocation,
  type LocationPermissionState,
} from "@/lib/device-location";
import { invalidateLocationPermissionCache } from "@/lib/location-permission-manager";
import { getWeather, getWeatherForecast } from "@/lib/weather.functions";
import { rememberLastSearchLocation } from "@/lib/last-search-location";
import { readLastSearchLocation } from "@/lib/last-search-location";
import { KAOHSIUNG_COORDS } from "@/lib/api/constants";
import { bindWeatherServerFns, getCurrentWeather } from "@/services/weatherService";
import type { WeatherSummary } from "@/lib/weather-types";

export type HomeWeatherStatus = "loading" | "ready" | "error";

const FETCH_TIMEOUT_MS = 20_000;
const LOCATION_REFETCH_MIN_M = 0.05;

export type HomeUserLocation = {
  lat: number;
  lng: number;
  city: string;
  source: "capacitor" | "browser" | "fallback";
};

export function useHomeWeather(locale: Locale) {
  const fetchWeatherFn = useServerFn(getWeather);
  const fetchForecastFn = useServerFn(getWeatherForecast);

  useEffect(() => {
    bindWeatherServerFns({
      fetchWeather: fetchWeatherFn,
      fetchForecast: fetchForecastFn,
    });
  }, [fetchWeatherFn, fetchForecastFn]);

  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [status, setStatus] = useState<HomeWeatherStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<HomeUserLocation | null>(() => {
    if (typeof window === "undefined") return null;
    const boot = readBootstrapDeviceLocation();
    return {
      lat: boot.lat,
      lng: boot.lng,
      city: boot.city,
      source: boot.source,
    };
  });
  const [usedFallbackLocation, setUsedFallbackLocation] = useState(false);
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState>("unknown");
  const loadIdRef = useRef(0);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastUsedFallbackRef = useRef(false);

  const fetchWeatherForCoords = useCallback(
    async (
      lat: number,
      lng: number,
      locMeta: {
        city: string;
        usedFallback: boolean;
        source: "capacitor" | "browser" | "fallback";
        permission: LocationPermissionState;
      },
    ): Promise<{ available: boolean; error: string | null }> => {
      console.info("[HOME_WEATHER] requesting weather");
      console.info("[HOME_WEATHER] location=", `${lat},${lng}|city=${locMeta.city || "目前位置"}`);
      console.info("[WEATHER_FETCH] latLng=", `${lat},${lng}`);
      const loadId = ++loadIdRef.current;
      setStatus("loading");
      setError(null);

      try {
        const result = await Promise.race([
          getCurrentWeather({ lat, lng }, locale),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("weather timeout")), FETCH_TIMEOUT_MS);
          }),
        ]);

        if (loadId !== loadIdRef.current) return { available: false, error: "stale_request" };

        const weatherSafe = result.weather;
        const parsed = {
          ...weatherSafe,
          city: weatherSafe.city || locMeta.city || "目前位置",
        };
        setWeather(parsed);
        rememberLastSearchLocation({ lat, lng, city: parsed.city });
        setStatus("ready");
        console.info("[HOME_WEATHER] result=", JSON.stringify(parsed));
        console.info(
          "[WEATHER_FETCH] response=",
          `${parsed.city}|${parsed.condition}|${parsed.tempC ?? "na"}|available=${parsed.available}`,
        );
        if (result.error && !parsed.available) {
          setError(result.error);
          return { available: false, error: result.error };
        } else {
          setError(null);
          return { available: Boolean(parsed.available), error: null };
        }
      } catch (e) {
        if (loadId !== loadIdRef.current) return { available: false, error: "stale_request" };
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[Weather] fetch failed", msg);
        console.error("[WEATHER_FETCH] error=", msg);
        console.error("[HOME_WEATHER] error=", msg);
        setWeather(null);
        setError(msg);
        setStatus("error");
        return { available: false, error: msg };
      }
    },
    [locale],
  );

  const applyLocation = useCallback((loc: Awaited<ReturnType<typeof requestDeviceLocation>>) => {
    lastCoordsRef.current = { lat: loc.lat, lng: loc.lng };
    lastUsedFallbackRef.current = loc.usedFallback;
    setUserLocation({
      lat: loc.lat,
      lng: loc.lng,
      city: loc.city || "",
      source: loc.source,
    });
    setUsedFallbackLocation(loc.usedFallback);
    setLocationPermission(loc.permission);
  }, []);

  const resolveWeatherLocationFallback = useCallback(
    (loc: Awaited<ReturnType<typeof requestDeviceLocation>>) => {
      if (!loc.usedFallback) return loc;
      const mapCenter = readLastSearchLocation();
      if (mapCenter) {
        console.info(
          "[WEATHER_LOCATION_FALLBACK] using=",
          `map-center|${mapCenter.lat},${mapCenter.lng}`,
        );
        return {
          ...loc,
          lat: mapCenter.lat,
          lng: mapCenter.lng,
          city: mapCenter.city ?? loc.city,
          usedFallback: true,
          source: "fallback" as const,
        };
      }
      if (loc.city?.trim()) {
        console.info("[WEATHER_LOCATION_FALLBACK] using=", `user-city|${loc.city.trim()}`);
        return loc;
      }
      console.info(
        "[WEATHER_LOCATION_FALLBACK] using=",
        `default-kaohsiung|${KAOHSIUNG_COORDS.lat},${KAOHSIUNG_COORDS.lng}`,
      );
      return {
        ...loc,
        lat: KAOHSIUNG_COORDS.lat,
        lng: KAOHSIUNG_COORDS.lng,
        city: "高雄市",
        usedFallback: true,
        source: "fallback" as const,
      };
    },
    [],
  );

  const load = useCallback(async () => {
    const rawLoc = await requestDeviceLocation();
    const loc = resolveWeatherLocationFallback(rawLoc);
    applyLocation(loc);
    const first = await fetchWeatherForCoords(loc.lat, loc.lng, {
      city: loc.city,
      usedFallback: loc.usedFallback,
      source: loc.source,
      permission: loc.permission,
    });
    if (!first.available || loc.usedFallback) {
      const last = readLastSearchLocation();
      if (last && (Math.abs(last.lat - loc.lat) > 0.0001 || Math.abs(last.lng - loc.lng) > 0.0001)) {
        console.info("[WEATHER_FETCH] fallback source=last-search-location");
        await fetchWeatherForCoords(last.lat, last.lng, {
          city: last.city ?? "目的地",
          usedFallback: true,
          source: "fallback",
          permission: loc.permission,
        });
      }
    }
  }, [applyLocation, fetchWeatherForCoords, resolveWeatherLocationFallback]);

  useEffect(() => {
    console.info("[WEATHER_SERVICE_VERSION] v-client-native-002");
    console.info("[HOME_WEATHER] mounted");
    void load();

    const retryTimer = window.setTimeout(() => {
      if (!lastUsedFallbackRef.current) return;
      console.info("[LOCATION] retry after fallback");
      void load();
    }, 6000);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      invalidateLocationPermissionCache({ allowRequestAgain: true });
      if (lastUsedFallbackRef.current || locationPermission === "denied") {
        console.info("[LOCATION] resume refresh");
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const stopWatch = watchDeviceLocation((loc) => {
      if (loc.usedFallback) return;

      const prev = lastCoordsRef.current;
      const moved =
        !prev ||
        Math.abs(prev.lat - loc.lat) > LOCATION_REFETCH_MIN_M ||
        Math.abs(prev.lng - loc.lng) > LOCATION_REFETCH_MIN_M;

      if (!moved) return;

      applyLocation(loc);
      void fetchWeatherForCoords(loc.lat, loc.lng, {
        city: loc.city,
        usedFallback: loc.usedFallback,
        source: loc.source,
        permission: loc.permission,
      });
    });

    return () => {
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      loadIdRef.current += 1;
      stopWatch();
    };
  }, [load, applyLocation, fetchWeatherForCoords, locationPermission]);

  useEffect(() => {
    if (!weather) return;
    console.info("[HOME_WEATHER] result=", JSON.stringify(weather));
  }, [weather]);

  useEffect(() => {
    if (!error) return;
    console.error("[HOME_WEATHER] error=", error);
  }, [error]);

  return {
    weather,
    status,
    error,
    userLocation,
    usedFallbackLocation,
    locationPermission,
    reload: load,
  };
}
