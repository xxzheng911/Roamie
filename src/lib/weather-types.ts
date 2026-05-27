/** 天氣摘要型別（client-safe） */
import type { WeatherScene } from "@/lib/weather-scene";

export type WeatherDataSource = "openweather" | "open-meteo-fallback" | "unavailable";

export type WeatherSummary = {
  city: string;
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconType: string;
  isDaytime: boolean;
  precipProbability: number | null;
  humidityPercent: number | null;
  windSpeedKmh: number | null;
  /** 雲量 0–100 */
  cloudCoverPercent: number | null;
  /** 紫外線指數 */
  uvi: number | null;
  sunrise: string | null;
  sunset: string | null;
  recommendation: "outdoor" | "indoor" | "cool_indoor" | "evening";
  recommendationText: string;
  scene?: WeatherScene;
  source: WeatherDataSource;
  fetchedAt: string;
  /** false = API 失敗，僅顯示溫柔 fallback 文案 */
  available: boolean;
};

export type DailyForecast = {
  date: string;
  tempHighC: number | null;
  tempLowC: number | null;
  precipProbability: number | null;
  condition: string;
  iconType: string;
  cloudCoverPercent?: number | null;
  uvi?: number | null;
  sunset?: string | null;
  sunrise?: string | null;
  humidityPercent?: number | null;
  windSpeedKmh?: number | null;
};

export type WeatherForecastResult = {
  forecast: DailyForecast[];
  city: string;
  error: string | null;
  available: boolean;
};
