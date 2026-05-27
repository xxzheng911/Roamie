import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene } from "@/lib/weather-scene";

/** 依天氣調整地點排序分數（越小越優先；0 = 不調整） */
export function weatherRankingBoost(
  weather: WeatherSummary | null | undefined,
  placeText: string,
): number {
  if (!weather?.available) return 0;

  const scene = weather.scene ?? classifyWeatherScene({
    tempC: weather.tempC,
    feelsLikeC: weather.feelsLikeC,
    precipProbability: weather.precipProbability,
    condition: weather.condition,
    isDaytime: weather.isDaytime,
    cloudCoverPercent: weather.cloudCoverPercent,
  });

  const text = placeText.toLowerCase();
  const indoor =
    /咖啡|書店|百貨|商場|美術|博物|展覽|室內|mall|museum|gallery|cafe|coffee|department|library|溫泉|spa|onset/i.test(
      text,
    );
  const outdoor =
    /公園|河|步道|海|沙灘|登山|健行|戶外|park|beach|hiking|trail|河岸|夜景|view/i.test(text);
  const night =
    /酒吧|夜店|夜景|夜市|bar|club|night|pub|居酒屋|宵夜/i.test(text);
  const cool =
    /冰|甜品|gelato|ice cream|雪花/i.test(text);

  switch (scene) {
    case "rainy":
      if (indoor) return -3;
      if (outdoor) return 8;
      return 0;
    case "hot":
      if (indoor || cool) return -2;
      if (outdoor) return 6;
      return 0;
    case "cold":
      if (indoor || /溫泉|hot spring/i.test(text)) return -2;
      if (outdoor) return 4;
      return 0;
    case "night":
      if (night) return -3;
      if (/博物|美術|書店/i.test(text) && !weather.isDaytime) return 5;
      return 0;
    case "sunny":
      if (outdoor && weather.isDaytime) return -1;
      return 0;
    case "cloudy":
      if (outdoor) return -1;
      return 0;
    default:
      return 0;
  }
}
