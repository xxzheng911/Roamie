import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene } from "@/lib/weather-scene";

/** 首頁天氣卡情境 emoji */
export function weatherSummaryEmoji(weather: WeatherSummary): string {
  const scene = classifyWeatherScene(weather);
  switch (scene) {
    case "rainy":
      return "🌧️";
    case "night":
      return "🌙";
    case "hot":
      return "🌡️";
    case "cold":
      return "🧥";
    case "cloudy":
      return "⛅";
    case "sunny":
      return "☀️";
    default:
      return "🍃";
  }
}

export function formatWeatherTemp(weather: WeatherSummary): string {
  if (weather.tempC === null || weather.tempC === undefined) return "";
  return `${Math.round(weather.tempC)}°`;
}
