import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n/types";
import {
  ensureHomeWeatherBootstrap,
  getHomeWeatherBootstrapState,
  reloadHomeWeatherBootstrap,
  subscribeHomeWeatherBootstrap,
} from "@/lib/home-weather-bootstrap";
import { getWeather, getWeatherForecast } from "@/lib/weather.functions";
import { bindWeatherServerFns } from "@/services/weatherService";
import type { HomeSessionUserLocation } from "@/lib/home-session-cache";

export type HomeWeatherStatus = "loading" | "ready" | "error";

export type HomeUserLocation = HomeSessionUserLocation;

export function useHomeWeather(locale: Locale) {
  const fetchWeatherFn = useServerFn(getWeather);
  const fetchForecastFn = useServerFn(getWeatherForecast);

  useLayoutEffect(() => {
    bindWeatherServerFns({
      fetchWeather: fetchWeatherFn,
      fetchForecast: fetchForecastFn,
    });
    ensureHomeWeatherBootstrap(locale, "useHomeWeather");
  }, [fetchWeatherFn, fetchForecastFn, locale]);

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
