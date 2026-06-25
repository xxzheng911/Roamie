import type { Locale } from "@/lib/i18n/types";
import type { TripLocation } from "@/lib/location/types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import {
  logChatGeocodeFallback,
  logChatGeocodeRequest,
  logChatGeocodeResponse,
  logChatTextSearchResponse,
} from "@/lib/ai/chat-place-flow-log";

export type GeocodeDestinationFn = (args: {
  data: { query: string; locale?: Locale };
}) => Promise<{ location: TripLocation | null; error: string | null }>;

/** 景區／國家森林遊樂區 — geocode 需用完整正式名稱 */
const SCENIC_GEOCODE: Record<string, readonly string[]> = {
  阿里山: [
    "阿里山國家森林遊樂區, 嘉義縣, 台灣",
    "阿里山, 嘉義縣, 台灣",
    "Alishan National Forest Recreation Area, Taiwan",
    "Alishan, Chiayi County, Taiwan",
  ],
  日月潭: [
    "日月潭, 南投縣, 台灣",
    "Sun Moon Lake, Nantou County, Taiwan",
  ],
  太魯閣: [
    "太魯閣國家公園, 花蓮縣, 台灣",
    "Taroko National Park, Hualien, Taiwan",
  ],
};

/** 模糊地名 → geocode 查詢（優先順序） */
const TW_AMBIGUOUS_GEOCODE: Record<string, readonly string[]> = {
  嘉義: ["嘉義市, 台灣", "嘉義縣, 台灣", "Chiayi City, Taiwan", "Chiayi County, Taiwan"],
  新竹: ["新竹市, 台灣", "新竹縣, 台灣", "Hsinchu City, Taiwan", "Hsinchu County, Taiwan"],
  台中: ["台中市, 台灣", "Taichung City, Taiwan", "Taichung, Taiwan"],
  臺中: ["台中市, 台灣", "Taichung City, Taiwan", "Taichung, Taiwan"],
  彰化: ["彰化縣, 台灣", "Changhua County, Taiwan"],
};

const EN_CITY_NAMES: Record<string, string> = {
  嘉義: "Chiayi",
  新竹: "Hsinchu",
  台中: "Taichung",
  臺中: "Taichung",
  彰化: "Changhua",
  花蓮: "Hualien",
  台南: "Tainan",
  臺南: "Tainan",
  高雄: "Kaohsiung",
  台北: "Taipei",
  臺北: "Taipei",
  宜蘭: "Yilan",
  屏東: "Pingtung",
  台東: "Taitung",
  臺東: "Taitung",
  澎湖: "Penghu",
  金門: "Kinmen",
  東京: "Tokyo",
  大阪: "Osaka",
  首爾: "Seoul",
  京都: "Kyoto",
  曼谷: "Bangkok",
  新加坡: "Singapore",
};

const INTL_GEOCODE: Record<string, readonly string[]> = {
  東京: ["Tokyo, Japan", "東京都, 日本", "Tokyo Metropolis, Japan"],
  大阪: ["Osaka, Japan", "大阪府, 日本", "Osaka, Osaka Prefecture, Japan"],
  首爾: ["Seoul, South Korea", "首爾, 韓國", "Seoul, Korea"],
  京都: ["Kyoto, Japan", "京都府, 日本"],
  曼谷: ["Bangkok, Thailand", "曼谷, 泰國"],
  新加坡: ["Singapore", "新加坡"],
};

/** 無 geocode 時 text search 用的近似中心 */
const DESTINATION_APPROX_CENTER: Record<string, { lat: number; lng: number }> = {
  嘉義: { lat: 23.4801, lng: 120.4491 },
  新竹: { lat: 24.8138, lng: 120.9675 },
  台中: { lat: 24.1477, lng: 120.6736 },
  臺中: { lat: 24.1477, lng: 120.6736 },
  彰化: { lat: 24.08, lng: 120.54 },
  花蓮: { lat: 23.9871, lng: 121.6015 },
  台南: { lat: 22.9997, lng: 120.227 },
  臺南: { lat: 22.9997, lng: 120.227 },
  高雄: { lat: 22.6273, lng: 120.3014 },
  台北: { lat: 25.033, lng: 121.5654 },
  臺北: { lat: 25.033, lng: 121.5654 },
  阿里山: { lat: 23.508, lng: 120.801 },
  台東: { lat: 22.758, lng: 121.1444 },
  臺東: { lat: 22.758, lng: 121.1444 },
  宜蘭: { lat: 24.757, lng: 121.753 },
  屏東: { lat: 22.669, lng: 120.489 },
  苗栗: { lat: 24.564, lng: 120.823 },
  東京: { lat: 35.6762, lng: 139.6503 },
  大阪: { lat: 34.6937, lng: 135.5023 },
  首爾: { lat: 37.5665, lng: 126.978 },
  京都: { lat: 35.0116, lng: 135.7681 },
  曼谷: { lat: 13.7563, lng: 100.5018 },
  新加坡: { lat: 1.3521, lng: 103.8198 },
};

const DEFAULT_SEARCH_CENTER = { lat: 23.9739, lng: 120.9823 };

export function buildDestinationGeocodeQueries(destination: string, _locale?: Locale): string[] {
  const label = normalizeDestinationLabel(destination);
  const queries: string[] = [];

  const scenic = SCENIC_GEOCODE[label];
  if (scenic) queries.push(...scenic);

  const intl = INTL_GEOCODE[label];
  if (intl) queries.push(...intl);

  const preset = TW_AMBIGUOUS_GEOCODE[label];
  if (preset) queries.push(...preset);

  queries.push(`${label}市, 台灣`, `${label}縣, 台灣`, `${label}, 台灣`, `${label}, Taiwan`);

  const en = EN_CITY_NAMES[label];
  if (en) {
    queries.push(`${en} City, Taiwan`, `${en}, Taiwan`, `${en} County, Taiwan`);
  }

  queries.push(label);

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

export function resolveDestinationApproxCenter(destination: string): { lat: number; lng: number } {
  const label = normalizeDestinationLabel(destination);
  return DESTINATION_APPROX_CENTER[label] ?? DEFAULT_SEARCH_CENTER;
}

export function buildDestinationTextSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label] ?? label;
  return [
    { query: `${label} popular attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 景點`, mode: "text", includedTypes: ["tourist_attraction", "museum", "art_gallery"] },
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 室內景點`, mode: "text", includedTypes: ["museum", "shopping_mall", "art_gallery"] },
    { query: `${label} 美術館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
    { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "tourist_attraction"] },
    { query: `${label} 夜市`, mode: "text", includedTypes: ["market", "tourist_attraction"] },
    { query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 著名景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
  ];
}

export async function geocodeDestinationWithFallback(params: {
  destination: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
}): Promise<TripLocation | null> {
  const { destination, locale, geocodeFn } = params;
  const queries = buildDestinationGeocodeQueries(destination, locale);

  for (const query of queries) {
    logChatGeocodeRequest(query);
    try {
      const result = await geocodeFn({ data: { query, locale } });
      const loc = result.location;
      if (loc?.lat != null && loc?.lng != null) {
        logChatGeocodeResponse("ok", `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`);
        return loc;
      }
      logChatGeocodeFallback(query, result.error ?? "empty");
    } catch (error) {
      logChatGeocodeFallback(
        query,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  logChatGeocodeResponse("empty", "all_queries_failed");
  return null;
}

export function logDestinationTextSearchResult(count: number): void {
  logChatTextSearchResponse(count);
}
