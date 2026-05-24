import type { WeatherSummary } from "@/lib/weather-types";

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
  precipProbability?: number | null;
  condition?: string;
  isDaytime?: boolean;
};

export function classifyWeatherScene(input: WeatherSceneInput): WeatherScene {
  const cond = (input.condition ?? "").toLowerCase();
  const precip = input.precipProbability ?? 0;
  const tempC = input.tempC ?? null;

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
    cond.includes("陰") ||
    cond.includes("多雲") ||
    cond.includes("cloud") ||
    cond.includes("overcast") ||
    cond.includes("fog") ||
    cond.includes("霧");
  if (cloudy) return "cloudy";

  const sunny =
    cond.includes("晴") ||
    cond.includes("clear") ||
    cond.includes("sunny");
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
        text: "今天可能下雨，適合一間能待整個下午的咖啡廳或書店。",
      };
    case "night":
      return {
        scene,
        rec: "evening",
        text: "夜晚適合夜景、小酒吧，或沿著巷弄慢慢散步。",
      };
    case "hot":
      return {
        scene,
        rec: "cool_indoor",
        text: "今天很熱，建議下午躲冷氣，傍晚再出門走走。",
      };
    case "cold":
      return {
        scene,
        rec: "indoor",
        text: "外面有點冷，書店、咖啡館或室內展覽都很適合。",
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
        text: "天氣晴朗，很適合公園、河堤或戶外散步景點。",
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
