import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";
import type { WeatherSummary } from "@/lib/weather-types";
import { ROAMIE_WEATHER_UNAVAILABLE_MESSAGE } from "@/lib/weather/constants";

export type WeatherScene = "rainy" | "sunny" | "cloudy" | "hot" | "cold" | "night" | "fair";

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

export function buildWeatherRecommendation(
  input: WeatherSceneInput,
  locale: Locale = "zh-TW",
): {
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
        text: translate(locale, "uiCoverage.weatherRainy"),
      };
    case "night":
      return {
        scene,
        rec: "evening",
        text: translate(locale, "uiCoverage.weatherNight"),
      };
    case "hot":
      return {
        scene,
        rec: "cool_indoor",
        text: translate(locale, "uiCoverage.weatherHot"),
      };
    case "cold":
      return {
        scene,
        rec: "indoor",
        text: translate(locale, "uiCoverage.weatherCold"),
      };
    case "cloudy":
      return {
        scene,
        rec: "outdoor",
        text: translate(locale, "uiCoverage.weatherCloudy"),
      };
    case "sunny":
      return {
        scene,
        rec: "outdoor",
        text: translate(locale, "uiCoverage.weatherSunny"),
      };
    case "fair":
    default:
      return {
        scene: "fair",
        rec: "outdoor",
        text: translate(locale, "uiCoverage.weatherFair"),
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

/** Rebuild display copy from semantic scene data; never reuse cached localized prose. */
export function localizeWeatherSummary(
  weather: WeatherSummary | null,
  locale: Locale,
): WeatherSummary | null {
  if (!weather) return null;
  const scene = weather.scene ?? classifyWeatherScene(weather);
  const key =
    weather.available === false || weather.source === "unavailable"
      ? "weatherUnavailable"
      : `weather${scene[0].toUpperCase()}${scene.slice(1)}`;
  return { ...weather, recommendationText: translate(locale, `uiCoverage.${key}`) };
}
