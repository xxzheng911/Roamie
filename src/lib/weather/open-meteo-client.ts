import { buildWeatherRecommendation } from "@/lib/weather-scene";
import type { WeatherSummary } from "@/lib/weather-types";

export function openMeteoCodeToCondition(code: number | null): string {
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

export async function reverseGeocodeCityClient(lat: number, lng: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
  const res = await fetch(url);
  if (!res.ok) return "";
  const json = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  return json.city || json.locality || json.principalSubdivision || "";
}

export async function fetchOpenMeteoCurrent(lat: number, lng: number): Promise<{
  tempC: number | null;
  windKmh: number | null;
  weatherCode: number | null;
  isDay: boolean;
}> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,weather_code,is_day,wind_speed_10m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const json = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      is_day?: number;
      wind_speed_10m?: number;
    };
  };
  return {
    tempC: json.current?.temperature_2m ?? null,
    windKmh: json.current?.wind_speed_10m ?? null,
    weatherCode: json.current?.weather_code ?? null,
    isDay: (json.current?.is_day ?? 1) === 1,
  };
}

export async function fetchOpenMeteoDailyForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<import("@/lib/weather-types").DailyForecast[]> {
  const d = Math.min(Math.max(days, 1), 16);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=${d}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo daily ${res.status}`);
  const json = (await res.json()) as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const daily = json.daily;
  if (!daily?.time?.length) return [];
  return daily.time.slice(0, d).map((date, i) => ({
    date,
    tempHighC: daily.temperature_2m_max?.[i] ?? null,
    tempLowC: daily.temperature_2m_min?.[i] ?? null,
    precipProbability: daily.precipitation_probability_max?.[i] ?? null,
    condition: openMeteoCodeToCondition(daily.weather_code?.[i] ?? null),
    iconType: String(daily.weather_code?.[i] ?? 0),
  }));
}

export async function buildWeatherSummaryFromOpenMeteo(
  lat: number,
  lng: number,
  cityHint?: string,
): Promise<WeatherSummary> {
  const [meteo, cityFromGeo] = await Promise.all([
    fetchOpenMeteoCurrent(lat, lng),
    cityHint?.trim() ? Promise.resolve(cityHint.trim()) : reverseGeocodeCityClient(lat, lng),
  ]);
  const condition = openMeteoCodeToCondition(meteo.weatherCode);
  const { rec, text, scene } = buildWeatherRecommendation({
    tempC: meteo.tempC,
    feelsLikeC: meteo.tempC,
    condition,
    isDaytime: meteo.isDay,
  });
  return {
    city: cityFromGeo || "目前位置",
    tempC: meteo.tempC,
    feelsLikeC: meteo.tempC,
    condition,
    iconType: meteo.weatherCode != null ? String(meteo.weatherCode) : "0",
    isDaytime: meteo.isDay,
    precipProbability: null,
    humidityPercent: null,
    windSpeedKmh: meteo.windKmh,
    cloudCoverPercent: null,
    uvi: null,
    sunrise: null,
    sunset: null,
    recommendation: rec,
    recommendationText: text,
    scene,
    source: "open-meteo-fallback",
    fetchedAt: new Date().toISOString(),
    available: true,
  };
}
