import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n/types";
import {
  requestDeviceLocation,
  watchDeviceLocation,
  type LocationPermissionState,
} from "@/lib/device-location";
import { getWeather, type WeatherSummary } from "@/lib/weather.functions";
import { rememberLastSearchLocation } from "@/lib/last-search-location";
import { fetchWeatherClientDirect } from "@/lib/weather-client";

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
  const fetchWeather = useServerFn(getWeather);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [status, setStatus] = useState<HomeWeatherStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<HomeUserLocation | null>(null);
  const [usedFallbackLocation, setUsedFallbackLocation] = useState(false);
  const [locationPermission, setLocationPermission] =
    useState<LocationPermissionState>("unknown");
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
    ) => {
      const loadId = ++loadIdRef.current;
      setStatus("loading");
      setError(null);

      const origin = import.meta.env.VITE_APP_ORIGIN as string | undefined;
      console.info("[Weather] fetch start", {
        lat,
        lng,
        locale,
        source: locMeta.source,
        viteAppOrigin: origin ?? "(not set)",
      });

      let lastError: string | null = null;

      try {
        const result = await Promise.race([
          fetchWeather({ data: { lat, lng, locale } }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("weather serverFn timeout")), FETCH_TIMEOUT_MS);
          }),
        ]);

        if (loadId !== loadIdRef.current) return;

        console.info("[Weather] serverFn response", {
          error: result.error,
          hasWeather: Boolean(result.weather),
          city: result.weather?.city,
        });

        if (result.weather) {
          const parsed = {
            ...result.weather,
            city: result.weather.city || locMeta.city || "目前位置",
          };
          setWeather(parsed);
          rememberLastSearchLocation({ lat, lng, city: parsed.city });
          setStatus("ready");
          return;
        }
        lastError = result.error ?? "no_weather_data";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = `serverFn: ${msg}`;
        console.error("[Weather] serverFn failed", { error: msg, viteAppOrigin: origin ?? null });
      }

      if (loadId !== loadIdRef.current) return;

      console.warn("[Weather] trying client direct fallback", { lastError });
      const client = await fetchWeatherClientDirect(lat, lng);
      if (loadId !== loadIdRef.current) return;

      if (client.weather) {
        const parsed = {
          ...client.weather,
          city: client.weather.city || locMeta.city || "目前位置",
        };
        setWeather(parsed);
        rememberLastSearchLocation({ lat, lng, city: parsed.city });
        setStatus("ready");
        console.info("[Weather] client fallback succeeded");
        return;
      }

      const combined = [lastError, client.error].filter(Boolean).join(" → ");
      console.error("[Weather] all sources failed", { combined });
      setWeather(null);
      setError(combined || "weather unavailable");
      setStatus("error");
    },
    [fetchWeather, locale],
  );

  const applyLocation = useCallback(
    (loc: Awaited<ReturnType<typeof requestDeviceLocation>>) => {
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
      console.info("[Weather] location ready for nearby", {
        lat: loc.lat,
        lng: loc.lng,
        usedFallback: loc.usedFallback,
        permission: loc.permission,
      });
    },
    [],
  );

  const load = useCallback(async () => {
    const loc = await requestDeviceLocation();
    applyLocation(loc);
    await fetchWeatherForCoords(loc.lat, loc.lng, {
      city: loc.city,
      usedFallback: loc.usedFallback,
      source: loc.source,
      permission: loc.permission,
    });
  }, [applyLocation, fetchWeatherForCoords]);

  useEffect(() => {
    void load();

    const retryTimer = window.setTimeout(() => {
      if (!lastUsedFallbackRef.current) return;
      void load();
    }, 6000);

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
      loadIdRef.current += 1;
      stopWatch();
    };
  }, [load, applyLocation, fetchWeatherForCoords]);

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
