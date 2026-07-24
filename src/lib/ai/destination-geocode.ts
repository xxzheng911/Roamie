import type { Locale } from "@/lib/i18n/types";
import type { TripLocation } from "@/lib/location/types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import {
  logChatGeocodeFallback,
  logChatGeocodeRequest,
  logChatGeocodeResponse,
  logChatTextSearchResponse,
} from "@/lib/ai/chat-place-flow-log";
import {
  logItineraryGeocodeQuery,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import {
  getResolvedDestinationScope,
  lockDestinationCoordinatesFromGeocode,
  setResolvedDestinationScope,
} from "@/lib/ai/resolved-destination-scope";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { rememberCityCentroid } from "@/lib/ai/destination-centroid-cache";
import {
  buildAliasGeocodeQueries,
  resolveDestinationAlias,
} from "@/lib/ai/destination-alias-resolver";
import {
  logDestinationDiag,
  logDestinationProviderRequest,
  logDestinationProviderResponse,
  logDestinationProviderParseResult,
  logDestinationProviderNormalized,
  logDestinationServerRequest,
  logDestinationServerResponse,
  newDestinationProviderRequestId,
} from "@/lib/ai/destination-provider-log";
import {
  isValidAnchorCoordinate,
  normalizeDestinationProviderResponse,
  providerResultToTripLocation,
  type DestinationProviderResult,
  type GeocodeFnEnvelope,
} from "@/lib/ai/destination-provider-result";
import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import {
  geocodeDestinationViaClient,
  isEmptyGeocodeEnvelope,
} from "@/lib/ai/destination-geocode-client";

export type GeocodeDestinationFn = (args: {
  data: {
    query: string;
    destinationName?: string;
    locale?: Locale;
    language?: Locale;
    /** ISO country region bias (jp/kr/tw/…) — overrides locale region when set. */
    region?: string;
    countryCode?: string;
    /** When true, do not fall back to UI locale region (destination anchor). */
    disableLocaleRegionBias?: boolean;
    /** When false, skip Places Autocomplete on this single query. */
    placesFallback?: boolean;
  };
}) => Promise<GeocodeFnEnvelope>;

type GeocodeCacheEntry = {
  location: TripLocation | null;
  error: string | null;
  at: number;
};

/** Success reuse window. */
const GEOCODE_OK_TTL_MS = 30 * 60 * 1000;
/**
 * Negative cache must be very short — never sticky-block Destination Anchor
 * across chat turns / bundle restarts with an empty coordinate.
 */
const GEOCODE_FAIL_TTL_MS = 3_000;

const destinationCoordinateCache = new Map<string, GeocodeCacheEntry>();
const inFlightGeocodeMap = new Map<string, Promise<TripLocation | null>>();

function geocodeCacheKey(destination: string, countryCode?: string): string {
  const label = normalizeDestinationLabel(destination);
  const cc = (countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

function readGeocodeCache(key: string, now = Date.now()): GeocodeCacheEntry | null {
  const entry = destinationCoordinateCache.get(key);
  if (!entry) return null;
  const ttl = entry.location ? GEOCODE_OK_TTL_MS : GEOCODE_FAIL_TTL_MS;
  if (now - entry.at > ttl) {
    destinationCoordinateCache.delete(key);
    return null;
  }
  return entry;
}

export function clearDestinationGeocodeCache(destination?: string): void {
  if (!destination) {
    destinationCoordinateCache.clear();
    inFlightGeocodeMap.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...destinationCoordinateCache.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      destinationCoordinateCache.delete(key);
    }
  }
  for (const key of [...inFlightGeocodeMap.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      inFlightGeocodeMap.delete(key);
    }
  }
}

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

const COUNTRY_EN: Record<string, string> = {
  澳洲: "Australia",
  日本: "Japan",
  韓國: "South Korea",
  韩国: "South Korea",
  泰國: "Thailand",
  新加坡: "Singapore",
  法國: "France",
  英國: "United Kingdom",
  美國: "United States",
  台灣: "Taiwan",
  台湾: "Taiwan",
  中國: "China",
  中国: "China",
  香港: "Hong Kong",
  澳門: "Macau",
  印尼: "Indonesia",
  印度尼西亞: "Indonesia",
  菲律賓: "Philippines",
  菲律宾: "Philippines",
  越南: "Vietnam",
  馬來西亞: "Malaysia",
  马来西亚: "Malaysia",
  馬爾地夫: "Maldives",
  马尔代夫: "Maldives",
  希臘: "Greece",
  西班牙: "Spain",
  義大利: "Italy",
  加拿大: "Canada",
  紐西蘭: "New Zealand",
  土耳其: "Turkey",
  蒙古: "Mongolia",
  埃及: "Egypt",
  捷克: "Czechia",
  墨西哥: "Mexico",
  德國: "Germany",
  葡萄牙: "Portugal",
  荷蘭: "Netherlands",
  比利時: "Belgium",
  奧地利: "Austria",
  瑞士: "Switzerland",
  波蘭: "Poland",
  匈牙利: "Hungary",
  愛爾蘭: "Ireland",
  冰島: "Iceland",
  南非: "South Africa",
  巴西: "Brazil",
  阿根廷: "Argentina",
  智利: "Chile",
  摩洛哥: "Morocco",
};

export const EN_CITY_NAMES: Record<string, string> = {
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
  熊本: "Kumamoto",
  廣島: "Hiroshima",
  広島: "Hiroshima",
  長崎: "Nagasaki",
  鹿兒島: "Kagoshima",
  鹿児島: "Kagoshima",
  仙台: "Sendai",
  金澤: "Kanazawa",
  金沢: "Kanazawa",
  神戶: "Kobe",
  神戸: "Kobe",
  奈良: "Nara",
  函館: "Hakodate",
  小樽: "Otaru",
  札幌: "Sapporo",
  曼谷: "Bangkok",
  新加坡: "Singapore",
  雪梨: "Sydney",
  墨爾本: "Melbourne",
  巴黎: "Paris",
  倫敦: "London",
  愛丁堡: "Edinburgh",
  曼徹斯特: "Manchester",
  湖區: "Lake District",
  紐約: "New York",
  洛杉磯: "Los Angeles",
  舊金山: "San Francisco",
  清邁: "Chiang Mai",
  香港: "Hong Kong",
  澳門: "Macau",
  釜山: "Busan",
  福岡: "Fukuoka",
  名古屋: "Nagoya",
  橫濱: "Yokohama",
  横浜: "Yokohama",
  冰島: "Iceland",
  濟州: "Jeju",
  濟州島: "Jeju",
  沖繩: "Okinawa",
  北海道: "Hokkaido",
  九州: "Kyushu",
  峇里島: "Bali",
  長灘島: "Boracay",
  宿霧: "Cebu",
  普吉島: "Phuket",
  普吉: "Phuket",
  蘇梅島: "Koh Samui",
  蘇梅: "Koh Samui",
  芭達雅: "Pattaya",
  夏威夷: "Hawaii",
  馬爾地夫: "Maldives",
  巴拉望: "Palawan",
  龍目島: "Lombok",
  佛羅倫斯: "Florence",
  阿里山: "Alishan",
  塔斯馬尼亞: "Tasmania",
  戈壁: "Gobi",
  戈壁沙漠: "Gobi Desert",
  烏蘭巴托: "Ulaanbaatar",
  特勒吉: "Terelj",
  開羅: "Cairo",
  盧克索: "Luxor",
  紅海: "Red Sea",
  峴港: "Da Nang",
  深圳: "Shenzhen",
  布拉格: "Prague",
  巴塞隆納: "Barcelona",
  羅馬: "Rome",
  溫哥華: "Vancouver",
  墨西哥城: "Mexico City",
};

const INTL_GEOCODE: Record<string, readonly string[]> = {
  東京: ["Tokyo, Japan", "東京都, 日本", "Tokyo Metropolis, Japan"],
  大阪: ["Osaka, Japan", "大阪府, 日本", "Osaka, Osaka Prefecture, Japan"],
  首爾: ["Seoul, South Korea", "首爾, 韓國", "Seoul, Korea"],
  京都: ["Kyoto, Japan", "京都府, 日本"],
  名古屋: [
    "Nagoya, Aichi, Japan",
    "名古屋, 愛知県, 日本",
    "Nagoya, Japan",
    "名古屋市, 日本",
    "名古屋, 日本",
  ],
  福岡: ["Fukuoka City, Japan", "福岡市, 日本", "Fukuoka, Fukuoka Prefecture, Japan", "福岡, 日本"],
  熊本: [
    "Kumamoto, Kumamoto Prefecture, Japan",
    "Kumamoto City, Japan",
    "熊本市, 熊本県, 日本",
    "熊本, 日本",
    "Kumamoto, Japan",
  ],
  廣島: [
    "広島市, 広島県, 日本",
    "廣島, 日本",
    "Hiroshima City, Hiroshima Prefecture, Japan",
    "Hiroshima, Japan",
  ],
  広島: [
    "広島市, 広島県, 日本",
    "Hiroshima City, Hiroshima Prefecture, Japan",
    "Hiroshima, Japan",
  ],
  長崎: ["長崎市, 長崎県, 日本", "Nagasaki City, Japan", "Nagasaki, Japan"],
  鹿兒島: ["鹿児島市, 鹿児島県, 日本", "Kagoshima City, Japan", "Kagoshima, Japan"],
  鹿児島: ["鹿児島市, 鹿児島県, 日本", "Kagoshima City, Japan", "Kagoshima, Japan"],
  仙台: ["仙台市, 宮城県, 日本", "Sendai, Japan"],
  金澤: ["金沢市, 石川県, 日本", "Kanazawa, Japan"],
  神戶: ["神戸市, 兵庫県, 日本", "Kobe, Japan"],
  奈良: ["奈良市, 奈良県, 日本", "Nara, Japan"],
  函館: ["函館市, 北海道, 日本", "Hakodate, Japan"],
  小樽: ["小樽市, 北海道, 日本", "Otaru, Japan"],
  橫濱: [
    "Yokohama, Japan",
    "横浜, 日本",
    "橫濱, 日本",
    "Yokohama, Kanagawa, Japan",
    "横浜市, 神奈川県, 日本",
  ],
  鎌倉: ["Kamakura, Japan", "鎌倉, 日本", "Kamakura, Kanagawa, Japan"],
  箱根: ["Hakone, Japan", "箱根, 日本", "Hakone, Kanagawa, Japan"],
  曼谷: ["Bangkok, Thailand", "曼谷, 泰國"],
  新加坡: ["Singapore", "新加坡"],
  墨爾本: ["Melbourne, Victoria, Australia", "Melbourne, Australia", "墨爾本, 澳洲"],
  雪梨: ["Sydney, New South Wales, Australia", "Sydney, Australia", "雪梨, 澳洲"],
  巴黎: ["Paris, France", "巴黎, 法國"],
  倫敦: ["London, United Kingdom", "倫敦, 英國"],
  愛丁堡: ["Edinburgh, United Kingdom", "Edinburgh, Scotland", "愛丁堡, 英國"],
  曼徹斯特: ["Manchester, United Kingdom", "曼徹斯特, 英國"],
  湖區: ["Lake District, United Kingdom", "Lake District National Park, England", "湖區, 英國"],
  紐約: ["New York, NY, USA", "New York City, United States"],
  洛杉磯: ["Los Angeles, CA, USA", "Los Angeles, California"],
  舊金山: ["San Francisco, CA, USA", "San Francisco, California"],
  清邁: ["Chiang Mai, Thailand", "清邁, 泰國"],
  香港: ["Hong Kong", "香港"],
  澳門: ["Macau", "Macao", "澳門"],
  釜山: ["Busan, South Korea", "釜山, 韓國"],
  冰島: ["Iceland", "冰島", "Reykjavik, Iceland", "雷克雅維克, 冰島"],
  濟州: [
    "濟州島, 韓國",
    "Jeju Island, South Korea",
    "Jeju-do, South Korea",
    "Jeju-si, South Korea",
    "Jeju, South Korea",
    "제주도",
    "제주",
    "濟州, 韓國",
  ],
  沖繩: ["Okinawa, Japan", "沖繩縣, 日本", "Okinawa Island, Japan"],
  北海道: ["Hokkaido, Japan", "北海道, 日本", "Sapporo, Hokkaido, Japan"],
  九州: ["Kyushu, Japan", "九州, 日本", "Fukuoka, Japan"],
  峇里島: ["Bali, Indonesia", "峇里島, 印尼", "Denpasar, Bali"],
  長灘島: ["Boracay, Philippines", "長灘島, 菲律賓"],
  宿霧: ["Cebu, Philippines", "Cebu City, Philippines", "宿霧, 菲律賓", "Mactan, Cebu"],
  普吉島: [
    "Phuket, Thailand",
    "Phuket Island, Thailand",
    "Phuket Province, Thailand",
    "普吉島, 泰國",
    "普吉島 泰國",
  ],
  蘇梅島: [
    "Koh Samui, Thailand",
    "Ko Samui, Thailand",
    "Samui Island, Thailand",
    "Koh Samui, Surat Thani, Thailand",
    "เกาะสมุย ประเทศไทย",
    "蘇梅島, 泰國",
    "蘇梅島 泰國",
  ],
  芭達雅: [
    "Pattaya, Thailand",
    "Pattaya, Chon Buri, Thailand",
    "Pattaya City, Chon Buri, Thailand",
    "Pattaya City, Thailand",
    "芭達雅，泰國",
    "芭達雅，春武里府，泰國",
    "芭達雅, 泰國",
    "芭堤雅, 泰國",
  ],
  夏威夷: ["Hawaii, United States", "Hawaii, USA", "Honolulu, Hawaii", "夏威夷, 美國"],
  馬爾地夫: ["Maldives", "Malé, Maldives", "馬爾地夫"],
  戈壁: [
    "Gobi Desert, Mongolia",
    "Gobi, Mongolia",
    "戈壁沙漠, 蒙古",
    "戈壁, 蒙古",
  ],
  開羅: [
    "Cairo, Egypt",
    "Cairo, EG",
    "開羅, 埃及",
    "القاهرة, مصر",
  ],
  盧克索: ["Luxor, Egypt", "盧克索, 埃及"],
  紅海: ["Red Sea, Egypt", "紅海, 埃及", "Hurghada, Egypt"],
  峴港: ["Da Nang, Vietnam", "Danang, Vietnam", "峴港, 越南"],
  深圳: ["Shenzhen, China", "深圳, 中國", "Shenzhen, Guangdong, China"],
  布拉格: ["Prague, Czechia", "Prague, Czech Republic", "布拉格, 捷克"],
  巴塞隆納: ["Barcelona, Spain", "巴塞隆納, 西班牙"],
  羅馬: ["Rome, Italy", "羅馬, 義大利"],
  溫哥華: ["Vancouver, Canada", "Vancouver, British Columbia, Canada", "溫哥華, 加拿大"],
  墨西哥城: ["Mexico City, Mexico", "Ciudad de México, Mexico", "墨西哥城, 墨西哥"],
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
  橫濱: { lat: 35.4437, lng: 139.638 },
  鎌倉: { lat: 35.319, lng: 139.5467 },
  箱根: { lat: 35.2324, lng: 139.1069 },
  大阪: { lat: 34.6937, lng: 135.5023 },
  首爾: { lat: 37.5665, lng: 126.978 },
  京都: { lat: 35.0116, lng: 135.7681 },
  曼谷: { lat: 13.7563, lng: 100.5018 },
  新加坡: { lat: 1.3521, lng: 103.8198 },
  墨爾本: { lat: -37.8136, lng: 144.9631 },
  雪梨: { lat: -33.8688, lng: 151.2093 },
  巴黎: { lat: 48.8566, lng: 2.3522 },
  倫敦: { lat: 51.5074, lng: -0.1278 },
  愛丁堡: { lat: 55.9533, lng: -3.1883 },
  曼徹斯特: { lat: 53.4808, lng: -2.2426 },
  湖區: { lat: 54.4609, lng: -3.0886 },
  紐約: { lat: 40.7128, lng: -74.006 },
  洛杉磯: { lat: 34.0522, lng: -118.2437 },
  舊金山: { lat: 37.7749, lng: -122.4194 },
  清邁: { lat: 18.7883, lng: 98.9853 },
  香港: { lat: 22.3193, lng: 114.1694 },
  澳門: { lat: 22.1987, lng: 113.5439 },
  摩納哥: { lat: 43.7384, lng: 7.4246 },
  梵蒂岡: { lat: 41.9029, lng: 12.4534 },
  釜山: { lat: 35.1796, lng: 129.0756 },
  濟州: { lat: 33.4996, lng: 126.5312 },
  沖繩: { lat: 26.2124, lng: 127.6809 },
  北海道: { lat: 43.0618, lng: 141.3545 },
  札幌: { lat: 43.0618, lng: 141.3545 },
  九州: { lat: 33.5904, lng: 130.4017 },
  福岡: { lat: 33.5904, lng: 130.4017 },
  那霸: { lat: 26.2124, lng: 127.6809 },
  峇里島: { lat: -8.4095, lng: 115.1889 },
  長灘島: { lat: 11.9674, lng: 121.9248 },
  宿霧: { lat: 10.3157, lng: 123.8854 },
  冰島: { lat: 64.1466, lng: -21.9426 },
  雷克雅維克: { lat: 64.1466, lng: -21.9426 },
};

const DEFAULT_SEARCH_CENTER = { lat: 23.9739, lng: 120.9823 };

function isTaiwanDestination(label: string): boolean {
  const entity = resolveDestinationEntity(label);
  if (entity.country === "台灣" || entity.country === "台湾") return true;
  if (entity.type === "country" && (label === "台灣" || label === "台湾")) return true;
  // Taiwan cities live in approx centers without INTL_GEOCODE rows.
  return Boolean(DESTINATION_APPROX_CENTER[label] && !INTL_GEOCODE[label]);
}

/**
 * Country-normalized geocode queries — max 3.
 * Prefer: "{En}, {CountryEn}" → "{En} City, {Admin}, {CountryEn}" → "{Zh}市, {AdminZh}, {CountryZh}"
 * Do not spray duplicates like bare "奈良" / "奈良市" / "Nara City" without country.
 */
export function buildDestinationGeocodeQueries(
  destination: string,
  _locale?: Locale,
  countryHint?: string | null,
): string[] {
  const label = sanitizeDestinationForGeocode(destination);
  const queries: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (!t || queries.includes(t)) return;
    queries.push(t);
  };
  const MAX_QUERIES = 3;

  const entity = resolveDestinationEntity(label);
  const country = countryHint?.trim() || entity.country;
  const alias = resolveDestinationAlias(label, { countryHint: country });
  const en =
    EN_CITY_NAMES[label] ??
    (alias.searchName && /^[A-Za-z0-9\s.'’-]+$/.test(alias.searchName)
      ? alias.searchName
      : undefined);
  const countryEn = country
    ? COUNTRY_EN[country] ?? COUNTRY_EN[normalizeDestinationLabel(country)] ?? country
    : "";
  const adminEn = alias.administrativeArea?.trim() || "";
  const adminZh = alias.administrativeAreaLocal?.trim() || "";
  const cityZh = (alias.normalizedName || label).replace(/[市県縣府]$/, "");

  const scenic = SCENIC_GEOCODE[label];
  if (scenic) {
    for (const q of scenic) push(q);
    return queries.slice(0, MAX_QUERIES);
  }

  const preset = TW_AMBIGUOUS_GEOCODE[label];
  if (preset) {
    for (const q of preset) push(q);
    return queries.slice(0, MAX_QUERIES);
  }

  // Curated intl / alias variants first (already country-qualified).
  const intl = INTL_GEOCODE[label] ?? INTL_GEOCODE[alias.normalizedName];
  if (intl) {
    for (const q of intl) push(q);
  }
  for (const q of buildAliasGeocodeQueries({
    destination: label,
    countryHint: country,
    countryEn: countryEn || undefined,
  })) {
    push(q);
  }

  const isIslandLike =
    entity.type === "island" ||
    entity.type === "archipelago" ||
    alias.entityType === "island" ||
    alias.entityType === "archipelago" ||
    (/(島|岛)$/.test(label) &&
      entity.type !== "resort_area" &&
      alias.entityType !== "resort_area");
  const isRegionLike =
    entity.type === "region" ||
    entity.type === "province" ||
    entity.type === "state" ||
    alias.entityType === "region" ||
    alias.entityType === "province" ||
    alias.entityType === "state";

  if (queries.length < MAX_QUERIES && country && countryEn) {
    if (isIslandLike && en) {
      push(`${en}, ${countryEn}`);
      push(`${en} Island, ${countryEn}`);
      push(`${label}, ${country}`);
    } else if (isRegionLike && en) {
      push(`${en}, ${countryEn}`);
      push(`${en} Province, ${countryEn}`);
      push(`${label}, ${country}`);
    } else {
      // City-like default: English country-qualified → admin-qualified → local script.
      if (en) push(`${en}, ${countryEn}`);
      if (en && adminEn) push(`${en} City, ${adminEn}, ${countryEn}`);
      else if (en) push(`${en} City, ${countryEn}`);
      if (adminZh) push(`${cityZh}市, ${adminZh}, ${country}`);
      else push(`${cityZh}市, ${country}`);
    }
  } else if (queries.length < MAX_QUERIES && isTaiwanDestination(label)) {
    push(`${label}市, 台灣`);
    if (en) push(`${en} City, Taiwan`);
    push(`${label}, 台灣`);
  } else if (queries.length < MAX_QUERIES && en && countryEn) {
    push(`${en}, ${countryEn}`);
  }

  if (queries.length === 0) {
    if (en && countryEn) push(`${en}, ${countryEn}`);
    if (country) push(`${label}, ${country}`);
    push(alias.searchName || label);
  }

  return queries.slice(0, MAX_QUERIES);
}

/** Map country hint / ISO code → Google Geocoding `region` bias. */
export function resolveGeocodeRegionBias(
  countryHint?: string | null,
  countryCode?: string | null,
): string | undefined {
  const code = (countryCode ?? "").trim().toUpperCase();
  // Only Latin ISO-2 — never treat 日本/蒙古 (length 2) as region codes.
  if (/^[A-Z]{2}$/.test(code)) return code.toLowerCase();
  const label = countryHint ? normalizeDestinationLabel(countryHint) : "";
  const mapped: Record<string, string> = {
    日本: "jp",
    韓國: "kr",
    韩国: "kr",
    泰國: "th",
    台灣: "tw",
    台湾: "tw",
    中國: "cn",
    中国: "cn",
    香港: "hk",
    澳門: "mo",
    美国: "us",
    美國: "us",
    澳洲: "au",
    法國: "fr",
    義大利: "it",
    意大利: "it",
    西班牙: "es",
    越南: "vn",
    印尼: "id",
    菲律賓: "ph",
    马来西亚: "my",
    馬來西亞: "my",
    新加坡: "sg",
    加拿大: "ca",
    英國: "gb",
    希臘: "gr",
    馬爾地夫: "mv",
    蒙古: "mn",
    Mongolia: "mn",
    埃及: "eg",
    Egypt: "eg",
    捷克: "cz",
    墨西哥: "mx",
    紐西蘭: "nz",
    德國: "de",
  };
  return mapped[label] ?? mapped[countryHint?.trim() ?? ""];
}

/**
 * Approx center for bias only. Never returns Taiwan default for non-Taiwan destinations.
 * Unknown overseas cities return null so callers must geocode or fail — not invent Taiwan coords.
 */
export function resolveDestinationApproxCenter(
  destination: string,
  countryHint?: string | null,
): { lat: number; lng: number } | null {
  const label = normalizeDestinationLabel(destination);
  const known = DESTINATION_APPROX_CENTER[label];
  if (known) return known;

  const entity = resolveDestinationEntity(label);
  const country =
    (countryHint ? normalizeDestinationLabel(countryHint) : undefined) ??
    entity.country;

  if (country && country !== "台灣" && country !== "台湾") {
    return null;
  }
  if (!isTaiwanDestination(label) && country !== "台灣" && country !== "台湾") {
    // Unknown city without Taiwan affiliation — do NOT fall back to Taiwan center.
    return null;
  }
  if (!country && !isTaiwanDestination(label)) {
    return null;
  }

  return DEFAULT_SEARCH_CENTER;
}

export function buildDestinationTextSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label] ?? label;
  const base = [
    { query: `${label} popular attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 景點`, mode: "text", includedTypes: ["tourist_attraction", "museum", "art_gallery"] },
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 室內景點`, mode: "text", includedTypes: ["museum", "shopping_mall", "art_gallery"] },
    { query: `${label} 美術館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
    { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "tourist_attraction"] },
    { query: `${label} 夜市`, mode: "text", includedTypes: ["market", "tourist_attraction"] },
    { query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 咖啡`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 著名景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
  ] as SearchAttempt[];

  if (label === "冰島" || en === "Iceland") {
    base.push(
      { query: "冰島 景點", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "冰島 極光", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "冰島 冰川", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "冰島 溫泉", mode: "text", includedTypes: ["tourist_attraction", "spa"] },
      { query: "Iceland attractions", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "Iceland aurora", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "Iceland glacier", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "Iceland itinerary", mode: "text", includedTypes: ["tourist_attraction"] },
    );
  }

  return base;
}

/** Autocomplete queries — max 2, always country-qualified. */
export function buildDestinationAutocompleteQueries(
  destination: string,
  countryHint?: string | null,
): string[] {
  const label = sanitizeDestinationForGeocode(destination);
  const alias = resolveDestinationAlias(label, { countryHint });
  const en =
    EN_CITY_NAMES[label] ??
    (alias.searchName && /^[A-Za-z0-9\s.'’-]+$/.test(alias.searchName)
      ? alias.searchName
      : undefined);
  const country = countryHint?.trim() || alias.countryHint || "";
  const countryEn = country
    ? COUNTRY_EN[country] ?? COUNTRY_EN[normalizeDestinationLabel(country)] ?? country
    : "";
  const queries: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (t && !queries.includes(t)) queries.push(t);
  };
  if (en && countryEn) push(`${en}, ${countryEn}`);
  if (label && country) push(`${label}, ${country}`);
  if (queries.length < 2) {
    for (const q of buildDestinationGeocodeQueries(label, undefined, countryHint)) {
      push(q);
      if (queries.length >= 2) break;
    }
  }
  return queries.slice(0, 2);
}

/**
 * Hard-stop errors — do not burn remaining geocode / autocomplete queries.
 */
function isGeocodeHardStopError(error: string | null | undefined): boolean {
  if (!error) return false;
  return (
    error === "geocode_rate_limited" ||
    error === "geocode_over_query_limit" ||
    error === "geocode_request_denied" ||
    error === "geocode_auth_error" ||
    /abort|cancel/i.test(error)
  );
}

export async function geocodeDestinationWithFallback(params: {
  destination: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
  /** When true (default), reuse locked / approx center and skip live geocode spam. */
  preferCachedCoordinates?: boolean;
  /** Parent country from conversation context. */
  countryHint?: string | null;
  countryCode?: string | null;
}): Promise<TripLocation | null> {
  const { destination, locale, geocodeFn } = params;
  const label = normalizeDestinationLabel(destination);
  const alias = resolveDestinationAlias(label, { countryHint: params.countryHint });
  const countryHint = params.countryHint ?? alias.countryHint;
  const countryCode = params.countryCode ?? alias.countryCode;
  const regionBias = resolveGeocodeRegionBias(countryHint, countryCode);
  const cacheKey = geocodeCacheKey(alias.normalizedName || label, countryCode);
  const preferCached = params.preferCachedCoordinates !== false;

  if (preferCached) {
    const locked = getResolvedDestinationScope(label);
    if (locked) {
      logAiPipeline(
        "[DESTINATION_RESOLUTION_REUSED]",
        "source=scope_lock",
        `destination=${label}`,
        `lat=${locked.latitude}`,
        `lng=${locked.longitude}`,
      );
      const country =
        locked.countryCode ??
        resolveDestinationEntity(label).country ??
        countryHint ??
        (isTaiwanDestination(label) ? "台灣" : undefined);
      const countryName =
        country === "TW" || country === "tw"
          ? "台灣"
          : country && /^[A-Z]{2}$/i.test(country)
            ? resolveDestinationEntity(label).country
            : country;
      return {
        placeId: `scope:${label}`,
        country: countryName ?? "unknown",
        city: label,
        lat: locked.latitude,
        lng: locked.longitude,
        formattedName: label,
        displayLabel: label,
        address: label,
        timezone: undefined,
        utcOffsetMinutes: null,
      };
    }
    const approx = resolveDestinationApproxCenter(label, countryHint);
    if (approx) {
      const country =
        resolveDestinationEntity(label).country ??
        countryHint ??
        (isTaiwanDestination(label) ? "台灣" : undefined);
      // Never lock overseas destinations onto a Taiwan-shaped approx without country match.
      if (
        country &&
        country !== "台灣" &&
        country !== "台湾" &&
        isNearTaiwanDefault(approx.lat, approx.lng)
      ) {
        // fall through to live geocode
      } else {
        const locked = setResolvedDestinationScope({
          displayName: label,
          normalizedName: label,
          countryCode:
            countryCode ??
            (country === "台灣" || country === "台湾" ? "TW" : undefined),
          country,
          latitude: approx.lat,
          longitude: approx.lng,
          source: "approx_center",
          resolvedAt: Date.now(),
        });
        if (locked) {
          logAiPipeline(
            "[DESTINATION_RESOLUTION_REUSED]",
            "source=approx_center",
            `destination=${label}`,
            `lat=${approx.lat}`,
            `lng=${approx.lng}`,
          );
          return {
            placeId: `approx:${label}`,
            country: country ?? "unknown",
            city: label,
            lat: approx.lat,
            lng: approx.lng,
            formattedName: label,
            displayLabel: label,
            address: label,
            timezone: undefined,
            utcOffsetMinutes: null,
          };
        }
      }
    }
  }

  const cached = readGeocodeCache(cacheKey);
  if (cached?.location && isValidAnchorCoordinate(cached.location.lat, cached.location.lng)) {
    logAiPipeline("[GEOCODE_REQUEST_DEDUPED]", `key=${cacheKey}`, "source=cache_hit");
    void import("@/lib/ai/places-cost-cache/log").then((m) =>
      m.logDestinationCacheHit({ key: cacheKey, source: "geocode_ok" }),
    );
    return cached.location;
  }
  // Live Destination Anchor must not sticky-reuse negative cache.
  if (preferCached && cached && !cached.location) {
    logAiPipeline(
      "[GEOCODE_REQUEST_DEDUPED]",
      `key=${cacheKey}`,
      `source=cache_fail`,
      `error=${cached.error ?? "unknown"}`,
    );
    void import("@/lib/ai/places-cost-cache/log").then((m) =>
      m.logDestinationCacheHit({ key: cacheKey, source: "geocode_fail" }),
    );
    return null;
  }
  // Drop stale negative entries when forcing live provider.
  if (!preferCached && cached && !cached.location) {
    destinationCoordinateCache.delete(cacheKey);
  }

  void import("@/lib/ai/places-cost-cache/log").then((m) =>
    m.logDestinationCacheMiss({ key: cacheKey }),
  );

  const inflight = inFlightGeocodeMap.get(cacheKey);
  if (inflight) {
    logAiPipeline("[GEOCODE_REQUEST_DEDUPED]", `key=${cacheKey}`, "source=in_flight");
    return inflight;
  }

  const task = (async (): Promise<TripLocation | null> => {
    const queries = buildDestinationGeocodeQueries(destination, locale, countryHint).slice(0, 3);
    logAiPipeline(
      "[DESTINATION_GEOCODE_QUERY_PLAN]",
      `raw=${destination}`,
      `normalized=${alias.normalizedName}`,
      `countryCode=${countryCode ?? "unknown"}`,
      `queryCount=${queries.length}`,
      `queries=${queries.join(" | ")}`,
      `regionBias=${regionBias ?? "none"}`,
    );
    let lastError: string | null = null;
    const attempted: string[] = [];
    let geocodeCallCount = 0;
    let autocompleteCallCount = 0;
    let placeDetailsCallCount = 0;
    let hardStopped = false;
    const preferClient = isCapacitorNativeShell();
    const MAX_GEOCODE = 3;
    const MAX_AUTOCOMPLETE = 2;
    const MAX_PLACE_DETAILS = 1;

    const acceptLocation = (loc: TripLocation, source: string): TripLocation => {
      lockDestinationCoordinatesFromGeocode({
        destination: label,
        lat: loc.lat,
        lng: loc.lng,
        country: loc.country ?? countryHint ?? undefined,
      });
      rememberCityCentroid({
        destination: label,
        latitude: loc.lat,
        longitude: loc.lng,
        country: loc.country ?? countryHint ?? undefined,
        countryCode: countryCode ?? undefined,
      });
      destinationCoordinateCache.set(cacheKey, {
        location: loc,
        error: null,
        at: Date.now(),
      });
      logAiPipeline(
        "[DESTINATION_GEOCODE_CANDIDATE]",
        `name=${loc.city ?? loc.formattedName ?? label}`,
        `countryCode=${loc.country ?? countryCode ?? "unknown"}`,
        `locality=${loc.city ?? ""}`,
        `administrativeArea=${loc.region ?? ""}`,
        `lat=${loc.lat}`,
        `lng=${loc.lng}`,
        "accepted=true",
        `reason=${source}`,
      );
      return loc;
    };

    const finalizeInvoke = (
      raw: unknown,
      args: {
        query: string;
        attempt: number;
        providerLabel: "geocode_fn" | "places_autocomplete" | "geocode_client";
        requestId: string;
        started: number;
        transport: "server" | "client";
      },
    ): {
      location: TripLocation | null;
      error: string | null;
      providerResult: DestinationProviderResult;
    } => {
      const providerResult = normalizeDestinationProviderResponse(raw, {
        provider:
          args.providerLabel === "places_autocomplete"
            ? "places_autocomplete"
            : args.providerLabel === "geocode_client"
              ? "geocode"
              : "geocode_fn",
        query: args.query,
      });
      const location =
        providerResultToTripLocation(providerResult, label) ??
        (asTripLocation(raw)?.lat != null ? asTripLocation(raw) : null);

      const accepted =
        Boolean(location) &&
        isValidAnchorCoordinate(location!.lat, location!.lng) &&
        !(
          countryHint &&
          countryHint !== "台灣" &&
          countryHint !== "台湾" &&
          isNearTaiwanDefault(location!.lat, location!.lng)
        );

      logDestinationProviderNormalized({
        provider: args.providerLabel,
        coordinateField: providerResult.sourceShape,
        latitude: accepted ? location!.lat : providerResult.latitude,
        longitude: accepted ? location!.lng : providerResult.longitude,
        placeId: providerResult.placeId ?? location?.placeId,
        source: args.transport,
        query: args.query,
        accepted,
      });

      logDestinationProviderResponse({
        requestId: args.requestId,
        provider: args.providerLabel,
        destination: label,
        query: args.query,
        httpStatus: providerResult.httpStatus ?? (accepted ? 200 : 0),
        apiStatus: providerResult.status,
        rawResultCount: providerResult.rawResultCount,
        parsedResultCount: accepted ? 1 : providerResult.parsedResultCount,
        hasLocation: accepted,
        latitude: accepted ? location!.lat : undefined,
        longitude: accepted ? location!.lng : undefined,
        failureReason: accepted
          ? undefined
          : providerResult.failureReason ??
            (location &&
            countryHint &&
            countryHint !== "台灣" &&
            countryHint !== "台湾" &&
            isNearTaiwanDefault(location.lat, location.lng)
              ? "overseas_taiwan_fallback_rejected"
              : "geocode_empty_response"),
        errorCode: accepted ? undefined : providerResult.failureReason,
        responseShape: providerResult.sourceShape,
        elapsedMs: Date.now() - args.started,
      });
      logDestinationProviderParseResult({
        destination: label,
        accepted,
        sourceShape: providerResult.sourceShape ?? "unknown",
        latitude: accepted ? location!.lat : undefined,
        longitude: accepted ? location!.lng : undefined,
        reason: accepted
          ? "geographic_match"
          : providerResult.failureReason ?? "parser_rejected",
        provider: args.providerLabel,
        query: args.query,
      });

      if (
        location &&
        countryHint &&
        countryHint !== "台灣" &&
        countryHint !== "台湾" &&
        isNearTaiwanDefault(location.lat, location.lng)
      ) {
        return {
          location: null,
          error: "geocode_overseas_taiwan_rejected",
          providerResult: {
            ...providerResult,
            ok: false,
            failureReason: "geocode_overseas_taiwan_rejected",
          },
        };
      }

      return {
        location: accepted ? location : null,
        error: accepted
          ? null
          : providerResult.failureReason ??
            (asRecord(raw)?.error as string | undefined) ??
            "geocode_zero_results",
        providerResult,
      };
    };

    const invokeProvider = async (args: {
      query: string;
      attempt: number;
      placesFallback: boolean;
      providerLabel: "geocode_fn" | "places_autocomplete";
    }): Promise<{
      location: TripLocation | null;
      error: string | null;
      providerResult: DestinationProviderResult;
    }> => {
      const requestId = newDestinationProviderRequestId();
      const started = Date.now();
      logDestinationProviderRequest({
        requestId,
        destination: label,
        normalizedDestination: alias.normalizedName,
        countryCode: countryCode ?? undefined,
        entityType: alias.entityType,
        provider: preferClient ? "geocode_client" : args.providerLabel,
        query: args.query,
        attempt: args.attempt,
        requestPath: "geocodeDestinationWithFallback",
        cacheHit: false,
      });

      const runClient = async (): Promise<GeocodeFnEnvelope> => {
        const detailsBudget = Math.max(0, MAX_PLACE_DETAILS - placeDetailsCallCount);
        const envelope = await geocodeDestinationViaClient({
          query: args.query,
          destinationName: label,
          locale,
          language: locale,
          region: regionBias,
          countryCode: countryCode ?? undefined,
          placesFallback: args.placesFallback,
          autocompleteOnly: args.placesFallback === true,
          placeDetailsBudget: args.placesFallback ? detailsBudget : 0,
        });
        if (envelope.usedPlaceDetails) placeDetailsCallCount += 1;
        return envelope;
      };

      // Capacitor native: prefer browser Google APIs (serverFn often returns {}).
      if (preferClient) {
        const clientRaw = await runClient();
        return finalizeInvoke(clientRaw, {
          query: args.query,
          attempt: args.attempt,
          providerLabel: args.placesFallback ? "places_autocomplete" : "geocode_client",
          requestId,
          started,
          transport: "client",
        });
      }

      let raw: unknown;
      try {
        logDestinationServerRequest({
          provider: args.providerLabel,
          endpoint: "geocodeTripLocationFromText",
          query: args.query,
          language: locale,
          region: regionBias,
          requestId,
          transport: "server",
        });
        raw = await geocodeFn({
          data: {
            query: args.query,
            destinationName: label,
            locale,
            language: locale,
            region: regionBias,
            countryCode: countryCode ?? undefined,
            disableLocaleRegionBias: true,
            placesFallback: args.placesFallback,
          },
        });
        if (args.placesFallback) placeDetailsCallCount += 1;
        logDestinationServerResponse({
          provider: args.providerLabel,
          httpStatus: (asRecord(raw)?.providerResult as DestinationProviderResult | undefined)
            ?.httpStatus,
          googleStatus:
            (asRecord(raw)?.providerResult as DestinationProviderResult | undefined)?.status ??
            (typeof asRecord(raw)?.error === "string" ? String(asRecord(raw)!.error) : undefined),
          resultCount:
            (asRecord(raw)?.providerResult as DestinationProviderResult | undefined)
              ?.rawResultCount ?? (asRecord(raw)?.location ? 1 : 0),
          errorMessage:
            typeof asRecord(raw)?.error === "string" ? String(asRecord(raw)!.error) : undefined,
          requestId,
          elapsedMs: Date.now() - started,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logDestinationServerResponse({
          provider: args.providerLabel,
          httpStatus: 0,
          googleStatus: "EXCEPTION",
          resultCount: 0,
          errorMessage: message,
          requestId,
          elapsedMs: Date.now() - started,
        });
        // Fall through to client when server RPC throws.
        const clientRaw = await runClient();
        return finalizeInvoke(clientRaw, {
          query: args.query,
          attempt: args.attempt,
          providerLabel: args.placesFallback ? "places_autocomplete" : "geocode_client",
          requestId,
          started,
          transport: "client",
        });
      }

      // Empty Capacitor / broken RPC envelope → client Google APIs.
      if (isEmptyGeocodeEnvelope(raw)) {
        logDestinationDiag("[DESTINATION_PROVIDER_EMPTY_ENVELOPE]", {
          destination: label,
          query: args.query,
          fallback: "client",
        });
        const clientRaw = await runClient();
        return finalizeInvoke(clientRaw, {
          query: args.query,
          attempt: args.attempt,
          providerLabel: args.placesFallback ? "places_autocomplete" : "geocode_client",
          requestId,
          started,
          transport: "client",
        });
      }

      const parsed = finalizeInvoke(raw, {
        query: args.query,
        attempt: args.attempt,
        providerLabel: args.providerLabel,
        requestId,
        started,
        transport: "server",
      });

      return parsed;
    };

    // Phase 1: Geocode-only (max 3). Stop on first valid coords.
    for (let qi = 0; qi < Math.min(queries.length, MAX_GEOCODE); qi += 1) {
      const query = queries[qi]!;
      attempted.push(query);
      if (qi > 0) {
        logAiPipeline("[GEOCODE_QUERY_RETRY]", `query=${query}`, `attempt=${qi + 1}`);
      }
      logAiPipeline(
        "[DESTINATION_GEOCODE_ATTEMPT]",
        `attempt=${qi + 1}`,
        `query=${query}`,
        `provider=geocode`,
      );
      logChatGeocodeRequest(query);
      if (query === queries[0]) {
        logItineraryGeocodeQuery(query);
      }

      geocodeCallCount += 1;
      const result = await invokeProvider({
        query,
        attempt: qi + 1,
        placesFallback: false,
        providerLabel: "geocode_fn",
      });

      if (result.location && isValidAnchorCoordinate(result.location.lat, result.location.lng)) {
        logChatGeocodeResponse(
          "ok",
          `${result.location.lat.toFixed(4)},${result.location.lng.toFixed(4)}`,
        );
        return acceptLocation(result.location, "geographic_match");
      }

      lastError = result.error ?? "geocode_zero_results";
      logAiPipeline(
        "[DESTINATION_GEOCODE_ATTEMPT]",
        `attempt=${qi + 1}`,
        `query=${query}`,
        `status=${lastError}`,
        "resultCount=0",
        "acceptedResult=false",
      );
      logChatGeocodeFallback(query, lastError);
      logDestinationDiag("[GEOCODE_FAILURE_DETAIL]", {
        code: lastError,
        query,
        attempt: qi + 1,
      });
      if (isGeocodeHardStopError(lastError)) {
        hardStopped = true;
        break;
      }
    }

    // Phase 2: Places Autocomplete → Details (max 2 auto, max 1 details total).
    if (!hardStopped && placeDetailsCallCount < MAX_PLACE_DETAILS) {
      const autoQueries = buildDestinationAutocompleteQueries(label, countryHint).slice(
        0,
        MAX_AUTOCOMPLETE,
      );
      for (let ai = 0; ai < autoQueries.length; ai += 1) {
        if (placeDetailsCallCount >= MAX_PLACE_DETAILS && ai > 0) break;
        const query = autoQueries[ai]!;
        attempted.push(`auto:${query}`);
        autocompleteCallCount += 1;
        logAiPipeline(
          "[DESTINATION_GEOCODE_ATTEMPT]",
          `attempt=auto_${ai + 1}`,
          `query=${query}`,
          `provider=places_autocomplete`,
        );
        const result = await invokeProvider({
          query,
          attempt: queries.length + ai + 1,
          placesFallback: true,
          providerLabel: "places_autocomplete",
        });
        if (result.location && isValidAnchorCoordinate(result.location.lat, result.location.lng)) {
          logChatGeocodeResponse(
            "ok",
            `${result.location.lat.toFixed(4)},${result.location.lng.toFixed(4)}`,
          );
          return acceptLocation(result.location, "places_autocomplete");
        }
        lastError = result.error ?? "places_autocomplete_empty";
        if (isGeocodeHardStopError(lastError)) {
          hardStopped = true;
          break;
        }
      }
    }

    logDestinationDiag("[DESTINATION_PROVIDER_STATS]", {
      destination: label,
      geocodeCount: geocodeCallCount,
      autocompleteCount: autocompleteCallCount,
      placeDetailsCount: placeDetailsCallCount,
      hardStopped,
      lastError: lastError ?? "none",
    });

    // Known admin centers remain usable even when Geocoding API fails.
    // Never invent Taiwan coords for overseas destinations.
    const approx = resolveDestinationApproxCenter(label, countryHint);
    if (approx) {
      const approxCountry =
        resolveDestinationEntity(label).country ??
        countryHint ??
        (isTaiwanDestination(label) ? "台灣" : undefined);
      if (
        approxCountry &&
        approxCountry !== "台灣" &&
        approxCountry !== "台湾" &&
        isNearTaiwanDefault(approx.lat, approx.lng)
      ) {
        logAiPipeline(
          "[DESTINATION_ANCHOR_FAILED]",
          `destination=${label}`,
          `countryCode=${countryCode ?? "unknown"}`,
          `attemptedQueries=${attempted.slice(0, 6).join(" | ")}`,
          "reason=overseas_taiwan_approx_blocked",
        );
      } else {
        logChatGeocodeResponse("approx_fallback", `${approx.lat},${approx.lng}`);
        const loc: TripLocation = {
          placeId: `approx:${label}`,
          country: approxCountry ?? "unknown",
          city: label,
          lat: approx.lat,
          lng: approx.lng,
          formattedName: label,
          displayLabel: label,
          address: label,
          timezone: undefined,
          utcOffsetMinutes: null,
        };
        return acceptLocation(loc, "approx_fallback");
      }
    }

    logChatGeocodeResponse("empty", lastError ?? "all_queries_failed");
    logAiPipeline(
      "[DESTINATION_ANCHOR_FAILED]",
      `destination=${label}`,
      `countryCode=${countryCode ?? "unknown"}`,
      `countryName=${countryHint ?? "unknown"}`,
      `attemptedQueries=${attempted.slice(0, 8).join(" | ")}`,
      `geocodeCount=${geocodeCallCount}`,
      `autocompleteCount=${autocompleteCallCount}`,
      `reason=${lastError ?? "geocode_zero_results"}`,
    );
    // Do NOT cache empty / zero-results as a durable miss — only a brief debounce.
    if (lastError && !/zero_results|empty|parser/i.test(lastError)) {
      destinationCoordinateCache.set(cacheKey, {
        location: null,
        error: lastError,
        at: Date.now(),
      });
    }
    return null;
  })().finally(() => {
    inFlightGeocodeMap.delete(cacheKey);
  });

  inFlightGeocodeMap.set(cacheKey, task);
  return task;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTripLocation(raw: unknown): TripLocation | null {
  const root = asRecord(raw);
  if (!root) return null;
  const loc = asRecord(root.location) ?? root;
  const lat =
    typeof loc.lat === "number"
      ? loc.lat
      : typeof loc.latitude === "number"
        ? loc.latitude
        : null;
  const lng =
    typeof loc.lng === "number"
      ? loc.lng
      : typeof loc.longitude === "number"
        ? loc.longitude
        : null;
  if (!isValidAnchorCoordinate(lat, lng)) return null;
  const safeLat = lat as number;
  const safeLng = lng as number;
  return {
    placeId: typeof loc.placeId === "string" ? loc.placeId : `provider:${safeLat},${safeLng}`,
    country: typeof loc.country === "string" ? loc.country : "unknown",
    city: typeof loc.city === "string" ? loc.city : "unknown",
    region: typeof loc.region === "string" ? loc.region : undefined,
    lat: safeLat,
    lng: safeLng,
    formattedName:
      typeof loc.formattedName === "string"
        ? loc.formattedName
        : typeof loc.displayLabel === "string"
          ? loc.displayLabel
          : "unknown",
    displayLabel:
      typeof loc.displayLabel === "string"
        ? loc.displayLabel
        : typeof loc.formattedName === "string"
          ? loc.formattedName
          : "unknown",
    address: typeof loc.address === "string" ? loc.address : undefined,
    timezone: typeof loc.timezone === "string" ? loc.timezone : undefined,
    utcOffsetMinutes:
      typeof loc.utcOffsetMinutes === "number" ? loc.utcOffsetMinutes : null,
  };
}

function isNearTaiwanDefault(lat: number, lng: number): boolean {
  // Taiwan island bbox — block overseas destinations from landing here.
  return lat >= 21.5 && lat <= 25.5 && lng >= 119.5 && lng <= 122.5;
}

export function logDestinationTextSearchResult(count: number): void {
  logChatTextSearchResponse(count);
}
