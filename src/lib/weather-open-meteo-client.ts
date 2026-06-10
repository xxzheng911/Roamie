import type { Locale } from "@/lib/i18n/types";
import type { WeatherSummary } from "@/lib/weather-types";

function openMeteoCodeToCondition(code: number | null): string {
  if (code == null) return "多雲";
  if (code === 0) return "晴朗";
  if ([1, 2].includes(code)) return "少雲";
  if (code === 3) return "多雲";
  if ([45, 48].includes(code)) return "有霧";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "有雨";
  if ([71, 73, 75, 85, 86].includes(code)) return "有雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "多雲";
}

/** Capacitor bundle 無 server 時，瀏覽器直連 Open-Meteo */
export async function fetchOpenMeteoCurrentWeather(
  lat: number,
  lng: number,
  city = "目前位置",
): Promise<{ weather: WeatherSummary; error: string | null; httpStatus: number }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,weather_code,is_day,wind_speed_10m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) {
    return {
      weather: {
        city,
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
      },
      error: `open-meteo ${res.status}`,
      httpStatus: res.status,
    };
  }

  const json = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      is_day?: number;
      wind_speed_10m?: number;
    };
  };
  const meteo = {
    tempC: json.current?.temperature_2m ?? null,
    windKmh: json.current?.wind_speed_10m ?? null,
    weatherCode: json.current?.weather_code ?? null,
    isDay: (json.current?.is_day ?? 1) === 1,
  };

  const summary: WeatherSummary = {
    city,
    tempC: meteo.tempC,
    feelsLikeC: meteo.tempC,
    condition: openMeteoCodeToCondition(meteo.weatherCode),
    iconType: meteo.weatherCode != null ? String(meteo.weatherCode) : "0",
    isDaytime: meteo.isDay,
    precipProbability: null,
    humidityPercent: null,
    windSpeedKmh: meteo.windKmh,
    cloudCoverPercent: null,
    uvi: null,
    sunrise: null,
    sunset: null,
    recommendation: meteo.isDay ? "outdoor" : "evening",
    recommendationText: "已使用備援天氣來源。",
    source: "open-meteo-fallback",
    fetchedAt: new Date().toISOString(),
    available: meteo.tempC != null,
  };

  return { weather: summary, error: null, httpStatus: res.status };
}

export function logWeatherResponse(
  source: string,
  detail: {
    lat: number;
    lng: number;
    locale?: Locale;
    status?: string | number;
    city?: string;
    tempC?: number | null;
    available?: boolean;
    error?: string | null;
  },
): void {
  console.info("[WEATHER_RESPONSE]", {
    source,
    latLng: `${detail.lat},${detail.lng}`,
    locale: detail.locale ?? null,
    status: detail.status ?? null,
    city: detail.city ?? null,
    temp: detail.tempC ?? null,
    available: detail.available ?? null,
    error: detail.error ?? null,
  });
}
