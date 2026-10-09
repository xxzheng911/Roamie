import { destinationDate } from "@/lib/outfit/trip-weather-policy";
import { buildWeatherRecommendation } from "@/lib/weather-scene";
import type { DailyForecast, WeatherSummary } from "@/lib/weather-types";

function formatUnixTime(unix: number, tzOffsetSec: number): string {
  const d = new Date((unix + tzOffsetSec) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function conditionFromWeatherArray(
  weather: Array<{ id?: number; main?: string; description?: string }> | undefined,
): string {
  const w = weather?.[0];
  return w?.description?.trim() || w?.main?.trim() || "多雲";
}

export type OneCallResponse = {
  timezone_offset?: number;
  timezone?: string;
  current?: {
    dt: number;
    sunrise?: number;
    sunset?: number;
    temp: number;
    feels_like: number;
    humidity: number;
    clouds: number;
    uvi: number;
    wind_speed: number;
    pop?: number;
    rain?: { "1h"?: number };
    weather?: Array<{ id?: number; main?: string; description?: string }>;
  };
  daily?: Array<{
    dt: number;
    sunrise: number;
    sunset: number;
    temp: { min: number; max: number };
    humidity: number;
    clouds: number;
    uvi: number;
    pop: number;
    wind_speed: number;
    weather?: Array<{ id?: number; main?: string; description?: string }>;
  }>;
};

export function parseOneCallCurrent(data: OneCallResponse, city: string): WeatherSummary {
  const c = data.current!;
  const tz = data.timezone_offset ?? 0;
  const today = data.daily?.[0];
  const sunrise = today?.sunrise ?? c.sunrise;
  const sunset = today?.sunset ?? c.sunset;
  const isDaytime =
    sunrise != null && sunset != null ? c.dt >= sunrise && c.dt < sunset : true;

  const condition = conditionFromWeatherArray(c.weather);
  const precipFromPop = today?.pop != null ? Math.round(today.pop * 100) : null;
  const precipFromRain = c.rain?.["1h"] != null && c.rain["1h"]! > 0 ? 70 : null;
  const precipProbability = precipFromPop ?? precipFromRain;

  const { rec, text, scene } = buildWeatherRecommendation({
    tempC: c.temp,
    feelsLikeC: c.feels_like,
    precipProbability,
    condition,
    isDaytime,
    cloudCoverPercent: c.clouds,
  });

  return {
    city: city || "目前位置",
    tempC: Math.round(c.temp * 10) / 10,
    feelsLikeC: Math.round(c.feels_like * 10) / 10,
    condition,
    iconType: String(c.weather?.[0]?.id ?? 0),
    isDaytime,
    precipProbability,
    humidityPercent: c.humidity,
    windSpeedKmh: Math.round(c.wind_speed * 3.6 * 10) / 10,
    cloudCoverPercent: c.clouds,
    uvi: c.uvi,
    sunrise: sunrise != null ? formatUnixTime(sunrise, tz) : null,
    sunset: sunset != null ? formatUnixTime(sunset, tz) : null,
    recommendation: rec,
    recommendationText: text,
    scene,
    source: "openweather",
    fetchedAt: new Date().toISOString(),
    available: true,
  };
}

export function parseOneCallDailyForecast(
  data: OneCallResponse,
  maxDays: number,
  timezone?: string,
): DailyForecast[] {
  const tz = data.timezone_offset ?? 0;
  return (data.daily ?? []).slice(0, maxDays).map((d) => {
    const date = destinationDate(d.dt * 1000, timezone ?? data.timezone, tz) ?? "";
    return {
      date,
      tempHighC: d.temp?.max != null && Number.isFinite(d.temp.max) ? Math.round(d.temp.max * 10) / 10 : null,
      tempLowC: d.temp?.min != null && Number.isFinite(d.temp.min) ? Math.round(d.temp.min * 10) / 10 : null,
      precipProbability: d.pop != null && Number.isFinite(d.pop) && d.pop >= 0 && d.pop <= 1 ? Math.round(d.pop * 100) : null,
      condition: d.weather?.length ? conditionFromWeatherArray(d.weather) : "",
      iconType: String(d.weather?.[0]?.id ?? 0),
      cloudCoverPercent: d.clouds,
      uvi: d.uvi,
      sunset: formatUnixTime(d.sunset, tz),
      sunrise: formatUnixTime(d.sunrise, tz),
      humidityPercent: d.humidity,
      windSpeedKmh: Math.round(d.wind_speed * 3.6 * 10) / 10,
    };
  });
}

/** OpenWeather 2.5 current + 3h forecast → daily */
export function aggregateForecast25ToDaily(
  list: Array<{
    dt: number;
    main: { temp: number; temp_min: number; temp_max: number; humidity: number };
    clouds: { all: number };
    pop?: number;
    wind: { speed: number };
    weather: Array<{ id?: number; main?: string; description?: string }>;
  }>,
  tzOffsetSec: number,
  maxDays: number,
  timezone?: string,
  requireCompleteDays = false,
): DailyForecast[] {
  const byDate = new Map<
    string,
    {
      timestamps: number[];
      highs: number[];
      lows: number[];
      pops: number[];
      clouds: number[];
      conditions: string[];
      icons: number[];
      humidity: number[];
      wind: number[];
      sunset?: number;
      sunrise?: number;
    }
  >();

  for (const item of list) {
    const date = destinationDate(item.dt * 1000, timezone, tzOffsetSec);
    if (!date) continue;
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = { timestamps: [], highs: [], lows: [], pops: [], clouds: [], conditions: [], icons: [], humidity: [], wind: [] };
      byDate.set(date, bucket);
    }
    bucket.timestamps.push(item.dt);
    bucket.highs.push(item.main?.temp_max ?? NaN);
    bucket.lows.push(item.main?.temp_min ?? NaN);
    bucket.pops.push(item.pop != null && Number.isFinite(item.pop) && item.pop >= 0 && item.pop <= 1 ? item.pop * 100 : NaN);
    bucket.clouds.push(item.clouds.all);
    bucket.conditions.push(item.weather?.length ? conditionFromWeatherArray(item.weather) : "");
    bucket.icons.push(item.weather?.[0]?.id ?? 0);
    bucket.humidity.push(item.main.humidity);
    bucket.wind.push(item.wind.speed);
  }

  return [...byDate.entries()]
    .filter(([, b]) => !requireCompleteDays || new Set(b.timestamps).size >= 8)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, maxDays)
    .map(([date, b]) => ({
      date,
      tempHighC: Math.round(Math.max(...b.highs) * 10) / 10,
      tempLowC: Math.round(Math.min(...b.lows) * 10) / 10,
      // Three-hour probabilities cannot be converted into a daily rain probability.
      precipProbability: !requireCompleteDays && b.pops.every(Number.isFinite) ? Math.round(Math.max(...b.pops)) : null,
      condition: b.conditions[Math.floor(b.conditions.length / 2)] ?? "多雲",
      iconType: String(b.icons[0] ?? 0),
      cloudCoverPercent: Math.round(b.clouds.reduce((s, v) => s + v, 0) / b.clouds.length),
      humidityPercent: Math.round(b.humidity.reduce((s, v) => s + v, 0) / b.humidity.length),
      windSpeedKmh: Math.round((b.wind.reduce((s, v) => s + v, 0) / b.wind.length) * 3.6 * 10) / 10,
    }));
}

export function parseCurrentWeather25(
  json: {
    main: { temp: number; feels_like: number; humidity: number };
    clouds: { all: number };
    wind: { speed: number };
    weather: Array<{ id?: number; main?: string; description?: string }>;
    sys?: { sunrise?: number; sunset?: number };
    dt: number;
  },
  city: string,
  tzOffsetSec = 0,
): WeatherSummary {
  const condition = conditionFromWeatherArray(json.weather);
  const sunrise = json.sys?.sunrise;
  const sunset = json.sys?.sunset;
  const isDaytime =
    sunrise != null && sunset != null ? json.dt >= sunrise && json.dt < sunset : true;

  const { rec, text, scene } = buildWeatherRecommendation({
    tempC: json.main.temp,
    feelsLikeC: json.main.feels_like,
    condition,
    isDaytime,
    cloudCoverPercent: json.clouds.all,
  });

  return {
    city: city || "目前位置",
    tempC: Math.round(json.main.temp * 10) / 10,
    feelsLikeC: Math.round(json.main.feels_like * 10) / 10,
    condition,
    iconType: String(json.weather[0]?.id ?? 0),
    isDaytime,
    precipProbability: null,
    humidityPercent: json.main.humidity,
    windSpeedKmh: Math.round(json.wind.speed * 3.6 * 10) / 10,
    cloudCoverPercent: json.clouds.all,
    uvi: null,
    sunrise: sunrise != null ? formatUnixTime(sunrise, tzOffsetSec) : null,
    sunset: sunset != null ? formatUnixTime(sunset, tzOffsetSec) : null,
    recommendation: rec,
    recommendationText: text,
    scene,
    source: "openweather",
    fetchedAt: new Date().toISOString(),
    available: true,
  };
}
