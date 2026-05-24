import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n/types";
import { requestDeviceLocation } from "@/lib/device-location";
import { getWeather, type WeatherSummary } from "@/lib/weather.functions";

export type HomeWeatherStatus = "loading" | "ready" | "error";

const FETCH_TIMEOUT_MS = 20_000;

export function useHomeWeather(locale: Locale) {
  const fetchWeather = useServerFn(getWeather);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [status, setStatus] = useState<HomeWeatherStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState(() => ({
    lat: 25.0478,
    lng: 121.5319,
    city: "台北",
  }));
  const [usedFallbackLocation, setUsedFallbackLocation] = useState(false);
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setStatus("loading");
    setError(null);

    const loc = await requestDeviceLocation();
    if (loadId !== loadIdRef.current) return;

    setUserLocation({ lat: loc.lat, lng: loc.lng, city: loc.city });
    setUsedFallbackLocation(loc.usedFallback);

    try {
      const result = await Promise.race([
        fetchWeather({ data: { lat: loc.lat, lng: loc.lng, locale } }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("weather fetch timeout")), FETCH_TIMEOUT_MS);
        }),
      ]);

      if (loadId !== loadIdRef.current) return;

      console.info("[Weather] api response", {
        error: result.error,
        hasWeather: Boolean(result.weather),
        city: result.weather?.city,
        condition: result.weather?.condition,
        tempC: result.weather?.tempC,
      });

      if (result.weather) {
        const parsed = {
          ...result.weather,
          city: result.weather.city || loc.city || "目前位置",
        };
        console.info("[Weather] parse ok", {
          city: parsed.city,
          condition: parsed.condition,
          tempC: parsed.tempC,
          iconType: parsed.iconType,
          isDaytime: parsed.isDaytime,
        });
        setWeather(parsed);
        if (parsed.city && parsed.city !== loc.city) {
          setUserLocation((prev) => ({ ...prev, city: parsed.city }));
        }
        setStatus("ready");
        return;
      }

      setWeather(null);
      setError(result.error ?? "no_weather_data");
      setStatus("error");
      console.warn("[Weather] fallback state: no weather payload", result.error);
    } catch (e) {
      if (loadId !== loadIdRef.current) return;
      const msg = e instanceof Error ? e.message : "weather fetch failed";
      console.error("[Weather] api exception", msg);
      setWeather(null);
      setError(msg);
      setStatus("error");
    }
  }, [fetchWeather, locale]);

  useEffect(() => {
    void load();
    return () => {
      loadIdRef.current += 1;
    };
  }, [load]);

  return {
    weather,
    status,
    error,
    userLocation,
    usedFallbackLocation,
    reload: load,
  };
}
