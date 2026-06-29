import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { isTaiwanCoordinates } from "@/lib/geo-region";
import { shouldLogExploreEvent } from "@/lib/explore-request-guard";
import type { WeatherSummary } from "@/lib/weather-types";
import { buildWeatherAwareCityCategoryQueries } from "@/lib/ai/weather-place-search";

/** 探索地圖：城市 / 區域搜尋後的推薦模式（非「附近小店」） */

export type ExploreRecommendMode = "city" | "nearby";

export type CityRecommendSelection = {
  label?: string;
  types?: string[] | null;
  primaryType?: string | null;
};

const CITY_PLACE_TYPES = new Set([
  "geocode",
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "city",
  "political",
  "sublocality",
  "sublocality_level_1",
  "colloquial_area",
]);

const CITY_LABEL_RE =
  /^(東京都|东京都|大阪府|大阪市|大阪|京都府|京都|首爾|首爾特別市|Seoul|Tokyo|Osaka|Kyoto|Taipei|台北市|高雄市|高雄|Bangkok|曼谷|香港|Hong Kong)/i;

export function inferExploreCityLabel(
  lat: number,
  lng: number,
  hint?: string | null,
): string {
  const fromHint = hint?.trim() ?? "";
  if (fromHint) {
    const cityMatch = fromHint.match(
      /^(高雄市|高雄|台北市|台北|新北市|新北|台中市|台中|台南市|台南|桃園市|桃園|基隆市|基隆|新竹市|新竹|東京都|东京都|大阪府|大阪市|大阪|京都府|京都|首爾|Seoul|Tokyo|Osaka|Kyoto|Bangkok|曼谷|香港)/,
    );
    if (cityMatch?.[1]) {
      return cityMatch[1]
        .replace(/市$|府$|都$/, "")
        .replace(/^东京都$|^東京都$/, "東京");
    }
  }

  if (isTaiwanCoordinates(lat, lng)) {
    if (lat >= 22.35 && lat <= 23.05 && lng >= 120.15 && lng <= 120.55) return "高雄";
    if (lat >= 24.85 && lat <= 25.25 && lng >= 121.35 && lng <= 121.75) return "台北";
    if (lat >= 24.0 && lat <= 24.35 && lng >= 120.5 && lng <= 120.85) return "台中";
    if (lat >= 22.85 && lat <= 23.25 && lng >= 120.05 && lng <= 120.45) return "台南";
    return "台灣";
  }

  if (lat >= 35.4 && lat <= 35.85 && lng >= 139.4 && lng <= 139.95) return "東京";
  if (lat >= 34.6 && lat <= 34.75 && lng >= 135.4 && lng <= 135.55) return "大阪";
  if (lat >= 34.95 && lat <= 35.15 && lng >= 135.65 && lng <= 135.85) return "京都";
  if (lat >= 37.45 && lat <= 37.65 && lng >= 126.85 && lng <= 127.05) return "首爾";
  if (lat >= 13.6 && lat <= 13.9 && lng >= 100.4 && lng <= 100.7) return "曼谷";
  if (lat >= 48.8 && lat <= 48.92 && lng >= 2.25 && lng <= 2.42) return "巴黎";
  if (lat >= -38.0 && lat <= -37.65 && lng >= 144.75 && lng <= 145.1) return "墨爾本";
  if (lat >= 40.65 && lat <= 40.88 && lng >= -74.05 && lng <= -73.85) return "紐約";

  return fromHint || "這裡";
}

/** 使用者選了城市 / 行政區 / 國家 → 進入 cityRecommendMode */
export function isCityRecommendSelection(input: CityRecommendSelection): boolean {
  const types = [
    ...(input.types ?? []),
    ...(input.primaryType ? [input.primaryType] : []),
  ].map((t) => t.trim().toLowerCase());

  if (types.some((t) => CITY_PLACE_TYPES.has(t))) return true;

  const label = input.label?.trim() ?? "";
  if (!label) return false;
  if (CITY_LABEL_RE.test(label)) return true;
  if (/[都府県]$/.test(label) && label.length <= 12) return true;

  return false;
}

export function resolveExploreRecommendMode(
  input: CityRecommendSelection | null | undefined,
): ExploreRecommendMode {
  return input && isCityRecommendSelection(input) ? "city" : "nearby";
}

/** 城市模式：較大半徑（公尺） */
export function cityRecommendSearchRadiusMeters(): number {
  return 12_000;
}

export function cityRecommendMaxDistanceMeters(cityLabel?: string): number {
  const label = cityLabel?.trim() ? normalizeDestinationLabel(cityLabel) : "";
  const mega = new Set(["東京", "大阪", "京都", "首爾", "曼谷", "台北", "高雄", "倫敦", "紐約", "巴黎", "墨爾本", "雪梨"]);
  return mega.has(label) ? 30_000 : 15_000;
}

/** 城市 + 分類：依序 text 搜尋，補 nearby 不足 */
export function cityCategoryTextQueries(
  categoryId: string,
  cityLabel: string,
  weather?: WeatherSummary | null,
): string[] {
  const weatherQueries = buildWeatherAwareCityCategoryQueries(categoryId, cityLabel, weather);
  if (weatherQueries.length) return weatherQueries;

  const city = cityLabel.trim();
  if (!city) return [];

  switch (categoryId) {
    case "sight":
      return [
        `${city} tourist attractions`,
        `${city} famous landmarks`,
        `${city} things to do`,
        `${city} 景點`,
        `${city} 博物館`,
        `${city} 地標`,
        `${city} 觀光景點`,
        `${city} tourist attraction`,
        `${city} museum`,
        `${city} landmark`,
      ];
    case "district":
      return [
        `${city} shopping district`,
        `${city} famous shopping area`,
        `${city} downtown shopping`,
        `${city} shopping mall`,
        `${city} department store`,
        `${city} shopping street`,
        `${city} market`,
        `${city} 商圈`,
        `${city} 百貨`,
        `${city} 市場`,
        `${city} 購物街`,
      ];
    case "food":
      return [
        `${city} レストラン`,
        `${city} グルメ`,
        `${city} 居酒屋`,
        `${city} ラーメン`,
        `${city} 寿司`,
        `${city} 焼肉`,
        `${city} best restaurants`,
        `${city} famous restaurant`,
        `${city} local food`,
        `${city} restaurant`,
        `${city} food`,
        `${city} 美食`,
        `${city} 餐廳`,
        `${city} 小吃`,
        `${city} 拉麵`,
        `${city} izakaya`,
        `${city} ramen`,
      ];
    case "coffee":
      return [
        `${city} specialty coffee`,
        `${city} coffee`,
        `${city} cafe`,
        `${city} coffee shop`,
        `${city} 咖啡廳`,
        `${city} 咖啡`,
        `${city} 甜點`,
        `${city} カフェ`,
      ];
    case "night":
      return [
        `${city} nightlife`,
        `${city} night view`,
        `${city} night market`,
        `${city} bar`,
        `${city} izakaya`,
        `${city} 酒吧`,
        `${city} 居酒屋`,
        `${city} 夜景`,
        `${city} 宵夜`,
      ];
    default:
      return [`${city} 觀光景點`, `${city} restaurant`, `${city} cafe`];
  }
}

export function exploreCategoryTextQueries(
  categoryId: string,
  userLocation: { lat: number; lng: number },
  cityHint?: string | null,
  weather?: WeatherSummary | null,
): string[] {
  const city = inferExploreCityLabel(userLocation.lat, userLocation.lng, cityHint);
  return cityCategoryTextQueries(categoryId, city, weather);
}

export function logExploreRecommendMode(
  mode: ExploreRecommendMode,
  selectedPlaceType: string | null,
): void {
  console.info(
    `[EXPLORE_RECOMMEND_MODE] mode=${mode} selectedPlaceType=${selectedPlaceType ?? "unknown"}`,
  );
}

export function logExplorePlacesRaw(
  count: number,
  quiet = false,
  categoryId = "unknown",
  locale = "zh-TW",
  locationKey = "",
): void {
  if (quiet) return;
  const key = `raw:${locationKey}:${categoryId}:${locale}`;
  if (!shouldLogExploreEvent(key)) return;
  console.info(`[EXPLORE_PLACES_RAW] count=${count}`);
}

export function logExploreFilterDrop(name: string, reason: string): void {
  console.info(`[EXPLORE_FILTER_DROP] name=${name} reason=${reason}`);
}

export function logExploreFilterResult(
  rawCount: number,
  finalCount: number,
  quiet = false,
  categoryId = "unknown",
  locale = "zh-TW",
  locationKey = "",
): void {
  if (quiet) return;
  const key = `filter:${locationKey}:${categoryId}:${locale}:${rawCount}:${finalCount}`;
  if (!shouldLogExploreEvent(key)) return;
  console.info(`[EXPLORE_FILTER_RESULT] rawCount=${rawCount} finalCount=${finalCount}`);
}
