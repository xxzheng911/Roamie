import type { WeatherSummary } from "@/lib/weather-types";
import { ROAMIE_WEATHER_UNAVAILABLE_MESSAGE } from "@/lib/weather/constants";

export type WeatherScene =
  | "rainy"
  | "sunny"
  | "cloudy"
  | "hot"
  | "cold"
  | "night"
  | "fair";

export type WeatherSceneInput = {
  tempC?: number | null;
  feelsLikeC?: number | null;
  precipProbability?: number | null;
  condition?: string;
  isDaytime?: boolean;
  cloudCoverPercent?: number | null;
};

export function classifyWeatherScene(input: WeatherSceneInput): WeatherScene {
  const cond = (input.condition ?? "").toLowerCase();
  const precip = input.precipProbability ?? 0;
  const tempC = input.feelsLikeC ?? input.tempC ?? null;
  const clouds = input.cloudCoverPercent ?? 0;

  const rainy =
    precip >= 40 ||
    cond.includes("雨") ||
    cond.includes("雷") ||
    cond.includes("rain") ||
    cond.includes("shower") ||
    cond.includes("drizzle") ||
    cond.includes("thunder");
  if (rainy) return "rainy";

  const isNight = input.isDaytime === false;
  if (isNight) return "night";

  if (tempC !== null && tempC >= 32) return "hot";
  if (tempC !== null && tempC <= 12) return "cold";

  const cloudy =
    clouds >= 70 ||
    cond.includes("陰") ||
    cond.includes("多雲") ||
    cond.includes("cloud") ||
    cond.includes("overcast") ||
    cond.includes("fog") ||
    cond.includes("霧");
  if (cloudy) return "cloudy";

  const sunny =
    clouds <= 30 &&
    (cond.includes("晴") ||
      cond.includes("clear") ||
      cond.includes("sunny") ||
      cond.includes("少雲"));
  if (sunny) return "sunny";

  return "fair";
}

export function buildWeatherRecommendation(input: WeatherSceneInput): {
  rec: WeatherSummary["recommendation"];
  text: string;
  scene: WeatherScene;
} {
  const scene = classifyWeatherScene(input);

  switch (scene) {
    case "rainy":
      return {
        scene,
        rec: "indoor",
        text: "今天可能下雨，適合一間能待整個下午的咖啡廳、書店或美術館。",
      };
    case "night":
      return {
        scene,
        rec: "evening",
        text: "夜晚適合夜景、河岸散步，或找一間舒服的小酒吧坐坐。",
      };
    case "hot":
      return {
        scene,
        rec: "cool_indoor",
        text: "今天很熱，建議下午躲冷氣、百貨或室內景點，傍晚再出門；記得補水與防曬。",
      };
    case "cold":
      return {
        scene,
        rec: "indoor",
        text: "外面有點冷，書店、咖啡館、室內展覽或溫泉都很適合。",
      };
    case "cloudy":
      return {
        scene,
        rec: "outdoor",
        text: "陰天涼爽，適合巷弄散步，或找一間舒服的室內小店。",
      };
    case "sunny":
      return {
        scene,
        rec: "outdoor",
        text: "天氣晴朗，很適合公園、河堤或戶外散步；紫外線偏強時記得防曬。",
      };
    case "fair":
    default:
      return {
        scene: "fair",
        rec: "outdoor",
        text: "天氣不錯，適合在巷弄裡慢慢走走。",
      };
  }
}

/** API 失敗時的摘要（不含假溫度） */
export function buildUnavailableWeatherSummary(city = "目前位置"): WeatherSummary {
  return {
    city,
    tempC: null,
    feelsLikeC: null,
    condition: "—",
    iconType: "unavailable",
    isDaytime: true,
    precipProbability: null,
    humidityPercent: null,
    windSpeedKmh: null,
    cloudCoverPercent: null,
    uvi: null,
    sunrise: null,
    sunset: null,
    recommendation: "outdoor",
    recommendationText: ROAMIE_WEATHER_UNAVAILABLE_MESSAGE,
    scene: "fair",
    source: "unavailable",
    fetchedAt: new Date().toISOString(),
    available: false,
  };
}
