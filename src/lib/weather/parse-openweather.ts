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
): DailyForecast[] {
  const tz = data.timezone_offset ?? 0;
  return (data.daily ?? []).slice(0, maxDays).map((d) => {
    const date = new Date((d.dt + tz) * 1000).toISOString().slice(0, 10);
    return {
      date,
      tempHighC: Math.round(d.temp.max * 10) / 10,
      tempLowC: Math.round(d.temp.min * 10) / 10,
      precipProbability: Math.round(d.pop * 100),
      condition: conditionFromWeatherArray(d.weather),
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
): DailyForecast[] {
  const byDate = new Map<
    string,
    {
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
    const date = new Date((item.dt + tzOffsetSec) * 1000).toISOString().slice(0, 10);
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = { highs: [], lows: [], pops: [], clouds: [], conditions: [], icons: [], humidity: [], wind: [] };
      byDate.set(date, bucket);
    }
    bucket.highs.push(item.main.temp_max);
    bucket.lows.push(item.main.temp_min);
    bucket.pops.push((item.pop ?? 0) * 100);
    bucket.clouds.push(item.clouds.all);
    bucket.conditions.push(conditionFromWeatherArray(item.weather));
    bucket.icons.push(item.weather[0]?.id ?? 0);
    bucket.humidity.push(item.main.humidity);
    bucket.wind.push(item.wind.speed);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, maxDays)
    .map(([date, b]) => ({
      date,
      tempHighC: Math.round(Math.max(...b.highs) * 10) / 10,
      tempLowC: Math.round(Math.min(...b.lows) * 10) / 10,
      precipProbability: Math.round(Math.max(...b.pops)),
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
