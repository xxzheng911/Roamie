import type { DailyForecast } from "@/lib/weather-types";
import type { WeatherSummary } from "@/lib/weather-types";

export function buildForecastWeatherSignature(forecast: DailyForecast[]): string {
  if (!forecast.length) return "none";
  return forecast
    .map(
      (f) =>
        `${f.date}:${Math.round(f.tempHighC ?? 0)}-${Math.round(f.tempLowC ?? 0)}-${Math.round(f.precipProbability ?? 0)}`,
    )
    .join("|");
}

export function buildCurrentWeatherSignature(current: WeatherSummary | null): string {
  if (!current?.available) return "na";
  return [
    Math.round(current.tempC ?? 0),
    Math.round(current.feelsLikeC ?? 0),
    Math.round(current.precipProbability ?? 0),
    current.isDaytime ? "day" : "night",
    current.condition.slice(0, 12),
  ].join("-");
}

export function composeWeatherInputSignature(
  forecast: DailyForecast[],
  current: WeatherSummary | null,
): string {
  return `${buildForecastWeatherSignature(forecast)}::${buildCurrentWeatherSignature(current)}`;
}

export function pickDisplayWeather(
  current: WeatherSummary | null,
  forecast: DailyForecast[],
): {
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconType: string;
  isDaytime: boolean;
  precipPercent: number | null;
} {
  const first = forecast[0];
  if (current?.available) {
    return {
      tempC: current.tempC,
      feelsLikeC: current.feelsLikeC,
      condition: current.condition,
      iconType: current.iconType,
      isDaytime: current.isDaytime,
      precipPercent: current.precipProbability,
    };
  }
  return {
    tempC: first?.tempHighC ?? null,
    feelsLikeC: null,
    condition: first?.condition ?? "多雲",
    iconType: first?.iconType ?? "03",
    isDaytime: true,
    precipPercent: first?.precipProbability ?? null,
  };
}
