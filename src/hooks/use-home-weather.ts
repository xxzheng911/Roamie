import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n/types";
import {
  ensureHomeWeatherBootstrap,
  ensureHomeWeatherLocationWatch,
  getHomeWeatherBootstrapState,
  reloadHomeWeatherBootstrap,
  subscribeHomeWeatherBootstrap,
} from "@/lib/home-weather-bootstrap";
import { getWeather, getWeatherForecast } from "@/lib/weather.functions";
import { bindWeatherServerFns } from "@/services/weatherService";
import type { HomeSessionUserLocation } from "@/lib/home-session-cache";
import { logPerfEffectRun } from "@/lib/app-perf";

export type HomeWeatherStatus = "loading" | "ready" | "error";

export type HomeUserLocation = HomeSessionUserLocation;

let weatherFnsBound = false;
let locationWatchRegistered = false;

export function useHomeWeather(locale: Locale) {
  const fetchWeatherFn = useServerFn(getWeather);
  const fetchForecastFn = useServerFn(getWeatherForecast);
  const fetchWeatherRef = useRef(fetchWeatherFn);
  const fetchForecastRef = useRef(fetchForecastFn);
  fetchWeatherRef.current = fetchWeatherFn;
  fetchForecastRef.current = fetchForecastFn;

  useLayoutEffect(() => {
    if (!weatherFnsBound) {
      weatherFnsBound = true;
      bindWeatherServerFns({
        fetchWeather: (...args) => fetchWeatherRef.current(...args),
        fetchForecast: (...args) => fetchForecastRef.current(...args),
      });
    }
    ensureHomeWeatherBootstrap(locale, "useHomeWeather");
    if (!locationWatchRegistered) {
      locationWatchRegistered = true;
      logPerfEffectRun("homeWeatherLocationWatch", { route: "/", reason: "register_once" });
      ensureHomeWeatherLocationWatch();
    }
  }, [locale]);

  const snapshot = useSyncExternalStore(
    subscribeHomeWeatherBootstrap,
    getHomeWeatherBootstrapState,
    getHomeWeatherBootstrapState,
  );

  const reload = useCallback(() => {
    reloadHomeWeatherBootstrap(locale);
  }, [locale]);

  return {
    weather: snapshot.weather,
    status: snapshot.status,
    error: snapshot.error,
    userLocation: snapshot.userLocation,
    usedFallbackLocation: snapshot.usedFallbackLocation,
    locationPermission: snapshot.locationPermission,
    reload,
  };
}
