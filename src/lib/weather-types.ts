/** 天氣摘要型別（client-safe） */

export type WeatherSummary = {
  city: string;
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconType: string;
  isDaytime: boolean;
  precipProbability: number | null;
  recommendation: "outdoor" | "indoor" | "cool_indoor" | "evening";
  recommendationText: string;
};

export type DailyForecast = {
  date: string;
  tempHighC: number | null;
  tempLowC: number | null;
  precipProbability: number | null;
  condition: string;
  iconType: string;
};
