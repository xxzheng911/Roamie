import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene, type WeatherScene } from "@/lib/weather-scene";
import { buildTemporalWeatherContext } from "@/lib/weather-context";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";

function resolveWeatherScene(
  weather: WeatherSummary | null | undefined,
  destination: string,
): WeatherScene {
  if (weather?.available !== false) {
    return classifyWeatherScene({
      tempC: weather?.tempC,
      feelsLikeC: weather?.feelsLikeC,
      precipProbability: weather?.precipProbability,
      condition: weather?.condition,
      isDaytime: weather?.isDaytime,
      cloudCoverPercent: weather?.cloudCoverPercent,
    });
  }

  if (/阿里山|合歡|玉山|雪山|清境|武陵|福壽山|高山|富士山|箱根/.test(destination)) {
    return "rainy";
  }
  if (/墾丁|海|沙灘|琉球|小琉球|綠島|蘭嶼|普吉|海島/.test(destination)) {
    return "sunny";
  }
  if (/北海道|札幌|首爾|釜山|東北/.test(destination) && (weather?.tempC ?? 20) <= 12) {
    return "cold";
  }
  return "fair";
}

export function buildWeatherAwarePlaceIntro(
  destination: string,
  scene: WeatherScene,
  weatherAvailable: boolean,
): string {
  switch (scene) {
    case "rainy":
      return weatherAvailable
        ? `我看你選的時間${destination}可能有雨，所以先幫你挑比較不怕雨的點。`
        : `${destination}這一帶山區午後容易起霧或短雨，我先幫你挑室內或短停留的路線。`;
    case "hot":
      return `這段時間${destination}可能偏熱，我優先挑有冷氣、傍晚也適合的點。`;
    case "cold":
      return `${destination}天氣偏冷，我先幫你挑室內、溫泉或暖食類型的點。`;
    case "night":
      return `若是傍晚或夜間，我會優先挑夜市、餐廳或夜景路線。`;
    case "sunny":
      return `${destination}天氣不錯，可以混合戶外景點與老街散步。`;
    default:
      return `我幫你整理幾個${destination}值得去的點：`;
  }
}

export function buildWeatherAwareSearchAttempts(
  destination: string,
  weather: WeatherSummary | null | undefined,
  context?: CanonicalTravelContext,
): SearchAttempt[] {
  const scene = resolveWeatherScene(weather, destination);
  const temporal = buildTemporalWeatherContext(weather, context?.startDate, undefined);
  const label = destination.trim();
  const attempts: SearchAttempt[] = [];

  const push = (query: string, includedTypes?: string[]) => {
    attempts.push({ query, mode: "text", includedTypes });
  };

  if (scene === "rainy") {
    push(`${label} 博物館`, ["museum"]);
    push(`${label} 美術館`, ["art_gallery", "museum"]);
    push(`${label} 咖啡廳`, ["cafe", "coffee_shop"]);
    push(`${label} 室內 景點`, ["shopping_mall", "tourist_attraction"]);
    push(`${label} 茶園 體驗`, ["tourist_attraction"]);
    return attempts;
  }

  if (scene === "hot") {
    push(`${label} 百貨`, ["shopping_mall"]);
    push(`${label} 咖啡廳`, ["cafe"]);
    push(`${label} 室內 景點`, ["museum", "tourist_attraction"]);
    push(`${label} 傍晚 夜景`, ["tourist_attraction"]);
    return attempts;
  }

  if (scene === "cold") {
    push(`${label} 溫泉`, ["spa", "lodging"]);
    push(`${label} 室內 景點`, ["museum", "tourist_attraction"]);
    push(`${label} 暖食 餐廳`, ["restaurant"]);
    push(`${label} 咖啡廳`, ["cafe"]);
    return attempts;
  }

  if (scene === "night" || temporal.isNight) {
    push(`${label} 夜市`, ["night_market"]);
    push(`${label} 夜景`, ["tourist_attraction"]);
    push(`${label} 餐廳`, ["restaurant"]);
    push(`${label} 酒吧`, ["bar"]);
    return attempts;
  }

  push(`${label} 必去 景點`, ["tourist_attraction"]);
  push(`${label} 著名景點`, ["tourist_attraction", "park"]);
  push(`${label} 觀光景點`, ["tourist_attraction"]);
  push(`${label} 老街`, ["tourist_attraction"]);
  push(`${label} 步道 公園`, ["park", "tourist_attraction"]);
  return attempts;
}

export { resolveWeatherScene };

export type WeatherAwareSearchWave = {
  id: string;
  query: string;
  mode: "text" | "nearby" | "multi";
  includedTypes?: string[];
  nearbyGroups?: string[][];
};

/** 依天氣調整首頁 nearby 搜尋波次順序（下雨優先室內） */
export function prioritizeWeatherAwareHomeWaves<T extends WeatherAwareSearchWave>(
  waves: T[],
  weather: WeatherSummary | null | undefined,
): T[] {
  const scene = resolveWeatherScene(weather, "");
  const indoorFirst = new Set(["day_cafe", "day_market", "day_food", "night_cafe", "night_food"]);
  const outdoorFirst = new Set(["day_sight"]);

  if (scene === "rainy" || scene === "hot" || scene === "cold") {
    const indoor = waves.filter((w) => indoorFirst.has(w.id));
    const rest = waves.filter((w) => !indoorFirst.has(w.id));
    return [...indoor, ...rest];
  }

  if (scene === "sunny") {
    const outdoor = waves.filter((w) => outdoorFirst.has(w.id));
    const rest = waves.filter((w) => !outdoorFirst.has(w.id));
    return outdoor.length ? [...outdoor, ...rest] : waves;
  }

  if (scene === "night") {
    const night = waves.filter((w) => w.id.startsWith("night_"));
    const rest = waves.filter((w) => !w.id.startsWith("night_"));
    return night.length ? [...night, ...rest] : waves;
  }

  return waves;
}

/** 探索／城市推薦：依天氣調整 text search queries */
export function buildWeatherAwareCityCategoryQueries(
  categoryId: string,
  cityLabel: string,
  weather?: WeatherSummary | null,
): string[] {
  const city = cityLabel.trim();
  if (!city) return [];
  const scene = resolveWeatherScene(weather ?? null, city);

  if (categoryId === "sight") {
    if (scene === "rainy") {
      return [
        `${city} 博物館`,
        `${city} 美術館`,
        `${city} 室内景點`,
        `${city} 咖啡廳`,
        `${city} 百貨 商場`,
        `${city} 溫泉`,
      ];
    }
    if (scene === "hot") {
      return [
        `${city} 室内景點`,
        `${city} 博物館`,
        `${city} 咖啡廳`,
        `${city} 百貨`,
        `${city} 傍晚 夜景`,
      ];
    }
    if (scene === "cold") {
      return [
        `${city} 溫泉`,
        `${city} 室内景點`,
        `${city} 咖啡廳`,
        `${city} 暖食 餐廳`,
      ];
    }
    if (scene === "night") {
      return [`${city} 夜市`, `${city} 夜景`, `${city} 餐廳`, `${city} 酒吧`];
    }
    return [
      `${city} 景點`,
      `${city} 公園`,
      `${city} 步道`,
      `${city} 觀景台`,
      `${city} 老街`,
      `${city} 地標`,
    ];
  }

  if (categoryId === "district" && scene === "rainy") {
    return [`${city} 百貨`, `${city} 商場`, `${city} 室内市集`, `${city} 商圈`];
  }

  return [];
}
