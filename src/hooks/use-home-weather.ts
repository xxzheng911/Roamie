import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Locale } from "@/lib/i18n/types";
import { requestDeviceLocation, watchDeviceLocation } from "@/lib/device-location";
import { getWeather, type WeatherSummary } from "@/lib/weather.functions";

export type HomeWeatherStatus = "loading" | "ready" | "error";

const FETCH_TIMEOUT_MS = 20_000;
const LOCATION_REFETCH_MIN_M = 0.05;

export function useHomeWeather(locale: Locale) {
  const fetchWeather = useServerFn(getWeather);
  const [weather, setWeather] = useState<WeatherSummary | null>(null);
  const [status, setStatus] = useState<HomeWeatherStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    city: string;
    source: "capacitor" | "browser" | "fallback";
  } | null>(null);
  const [usedFallbackLocation, setUsedFallbackLocation] = useState(false);
  const loadIdRef = useRef(0);
  const lastCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const fetchForCoords = useCallback(
    async (lat: number, lng: number, locMeta: { city: string; usedFallback: boolean; source: "capacitor" | "browser" | "fallback" }) => {
      const loadId = ++loadIdRef.current;
      setStatus("loading");
      setError(null);
      setUserLocation({ lat, lng, city: locMeta.city, source: locMeta.source });
      setUsedFallbackLocation(locMeta.usedFallback);

      console.info("[Weather] request params", { lat, lng, locale, source: locMeta.source });

      try {
        const result = await Promise.race([
          fetchWeather({ data: { lat, lng, locale } }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("weather fetch timeout")), FETCH_TIMEOUT_MS);
          }),
        ]);

        if (loadId !== loadIdRef.current) return;

        console.info("[Weather] response", {
          error: result.error,
          hasWeather: Boolean(result.weather),
          city: result.weather?.city,
          condition: result.weather?.condition,
          tempC: result.weather?.tempC,
        });

        if (result.weather) {
          const parsed = {
            ...result.weather,
            city: result.weather.city || locMeta.city || "目前位置",
          };
          setWeather(parsed);
          if (parsed.city && parsed.city !== locMeta.city) {
            setUserLocation((prev) =>
              prev ? { ...prev, city: parsed.city } : { lat, lng, city: parsed.city, source: locMeta.source },
            );
          }
          setStatus("ready");
          return;
        }

        setWeather(null);
        setError(result.error ?? "no_weather_data");
        setStatus("error");
      } catch (e) {
        if (loadId !== loadIdRef.current) return;
        const msg = e instanceof Error ? e.message : "weather fetch failed";
        console.error("[Weather] response", { error: msg });
        setWeather(null);
        setError(msg);
        setStatus("error");
      }
    },
    [fetchWeather, locale],
  );

  const load = useCallback(async () => {
    const loc = await requestDeviceLocation();
    lastCoordsRef.current = { lat: loc.lat, lng: loc.lng };
    await fetchForCoords(loc.lat, loc.lng, {
      city: loc.city,
      usedFallback: loc.usedFallback,
      source: loc.source,
    });
  }, [fetchForCoords]);

  useEffect(() => {
    void load();

    const stopWatch = watchDeviceLocation((loc) => {
      const prev = lastCoordsRef.current;
      const moved =
        !prev ||
        Math.abs(prev.lat - loc.lat) > LOCATION_REFETCH_MIN_M ||
        Math.abs(prev.lng - loc.lng) > LOCATION_REFETCH_MIN_M;

      if (!moved) return;

      lastCoordsRef.current = { lat: loc.lat, lng: loc.lng };
      void fetchForCoords(loc.lat, loc.lng, {
        city: loc.city,
        usedFallback: false,
        source: loc.source,
      });
    });

    return () => {
      loadIdRef.current += 1;
      stopWatch();
    };
  }, [load, fetchForCoords]);

  return {
    weather,
    status,
    error,
    userLocation,
    usedFallbackLocation,
    reload: load,
  };
}
