import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { TripStopSuggestion } from "@/lib/trip-stop-search.functions";
import {
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { isLodgingPlace } from "@/lib/lodging-place-filter";
import { passesCityExploreTouristValue } from "@/lib/explore-city-tourist-filter";
import { buildCityCategoryFetchQueries } from "@/lib/explore-city-category-queries";
import { passesCityRelaxedRating } from "@/lib/explore-places-eligibility";
import { isCityRecommendSelection, cityCategoryTextQueries } from "@/lib/explore-recommend-mode";
import type { WeatherSummary } from "@/lib/weather-types";
import { distanceMeters } from "@/lib/map-explore";
import { pickPrimarySuggestion } from "@/lib/explore-primary-place";
import type { SearchPlacesInput } from "@/lib/explore-category-search";
import { placesStatsPayload } from "@/lib/places-api-stats";

const CITY_ENTITY_TYPES = new Set([
  "locality",
  "political",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "country",
  "colloquial_area",
  "sublocality",
  "sublocality_level_1",
]);

const TOURIST_KEEP_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "shopping_mall",
  "department_store",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "night_club",
  "park",
  "point_of_interest",
  "historical_landmark",
  "monument",
]);

const CITY_COUNTRY_HINTS: Record<string, string[]> = {
  東京: ["日本", "Japan", "東京都", "Tokyo", "東京"],
  大阪: ["日本", "Japan", "大阪府", "Osaka", "大阪"],
  京都: ["日本", "Japan", "京都府", "Kyoto", "京都"],
  首爾: ["韓國", "韩国", "Korea", "Seoul", "서울", "首爾"],
  曼谷: ["泰國", "泰国", "Thailand", "Bangkok", "曼谷"],
  清邁: ["泰國", "泰国", "Thailand", "Chiang Mai", "清邁"],
  台北: ["台灣", "台湾", "Taiwan", "Taipei", "台北", "臺北"],
  高雄: ["台灣", "台湾", "Taiwan", "Kaohsiung", "高雄"],
  墨爾本: ["澳洲", "澳大利亚", "Australia", "Melbourne", "VIC", "Victoria"],
  雪梨: ["澳洲", "澳大利亚", "Australia", "Sydney", "NSW"],
  巴黎: ["法國", "法国", "France", "Paris", "巴黎"],
  紐約: ["美國", "美国", "USA", "US", "New York", "NYC", "Manhattan", "紐約"],
  倫敦: ["英國", "英国", "UK", "London", "倫敦"],
};

const CITY_LANDMARK_QUERIES: Record<string, string[]> = {
  東京: [
    "Senso-ji Temple Tokyo",
    "Tokyo Skytree",
    "Shibuya Crossing Tokyo",
    "Shinjuku Tokyo",
    "Harajuku Tokyo",
    "Ginza Tokyo",
    "Tokyo Tower",
    "Ueno Park Tokyo",
    "Akihabara Tokyo",
    "Tsukiji Tokyo",
    "Meiji Shrine Tokyo",
    "淺草寺 東京",
    "東京晴空塔",
    "澀谷 東京",
    "新宿 東京",
    "原宿 東京",
    "銀座 東京",
    "東京鐵塔",
    "上野 東京",
    "秋葉原 東京",
    "築地 東京",
    "明治神宮 東京",
  ],
  大阪: ["Osaka Castle", "Dotonbori Osaka", "道頓堀", "大阪城"],
  京都: ["Fushimi Inari Kyoto", "Kiyomizu-dera", "伏見稻荷", "清水寺"],
  曼谷: ["Chatuchak Market Bangkok", "Wat Arun", "考山路", "洽圖洽周末市集"],
  首爾: ["Gyeongbokgung Seoul", "Myeongdong", "景福宮", "明洞", "N Seoul Tower"],
  曼谷: ["Grand Palace Bangkok", "Wat Arun", "Chatuchak Market Bangkok", "考山路"],
  巴黎: ["Eiffel Tower Paris", "Louvre Museum Paris", "Notre Dame Paris", "艾菲爾鐵塔"],
  墨爾本: ["Federation Square Melbourne", "Flinders Street Melbourne", "Royal Botanic Gardens Melbourne"],
  紐約: ["Statue of Liberty New York", "Central Park New York", "Times Square New York", "自由女神像"],
};

const CITY_FETCH_RAW_TARGET = 24;
const CITY_FETCH_RAW_MIN = 8;

const CITY_NEARBY_GROUPS: Array<{ categoryId: string; groups: string[][] }> = [
  {
    categoryId: "sight",
    groups: [
      ["tourist_attraction", "museum", "art_gallery"],
      ["park", "national_park"],
    ],
  },
  {
    categoryId: "coffee",
    groups: [["cafe", "coffee_shop"], ["bakery", "dessert_shop"]],
  },
  {
    categoryId: "food",
    groups: [
      ["restaurant", "food", "meal_takeaway"],
      ["bakery"],
      ["bar"],
    ],
  },
  {
    categoryId: "district",
    groups: [
      ["shopping_mall", "department_store"],
      ["market", "flea_market"],
    ],
  },
  {
    categoryId: "night",
    groups: [
      ["bar", "pub", "night_club"],
      ["restaurant", "meal_takeaway"],
    ],
  },
];

export type CitySearchPlacesFn = (args: {
  data: SearchPlacesInput;
}) => Promise<{ places?: PlaceResult[]; error?: string | null }>;

export function cityExploreRadiusMeters(cityLabel: string): number {
  const label = normalizeDestinationLabel(cityLabel);
  const mega = new Set([
    "東京",
    "大阪",
    "京都",
    "首爾",
    "曼谷",
    "台北",
    "高雄",
    "倫敦",
    "紐約",
    "巴黎",
    "墨爾本",
    "雪梨",
  ]);
  return mega.has(label) ? 30_000 : 20_000;
}

export function exploreCityPopularTextQueries(cityLabel: string): string[] {
  const city = normalizeDestinationLabel(cityLabel.trim());
  if (!city) return [];
  const landmarks = CITY_LANDMARK_QUERIES[city] ?? [];
  return [
    ...landmarks,
    `${city} popular attractions`,
    `${city} tourist attractions`,
    `${city} famous landmarks`,
    `${city} shopping district`,
    `${city} famous restaurant`,
    `${city} famous cafe`,
    `${city} night attractions`,
    `${city} shopping mall`,
    `${city} department store`,
    `${city} market`,
    `${city} things to do`,
    `${city} 必去景點`,
    `${city} 著名景點`,
    `${city} 觀光景點`,
    `${city} 熱門景點`,
    `${city} 美食`,
    `${city} 咖啡`,
    `${city} 商圈`,
    `${city} 酒吧`,
    `${city} 景點`,
    `${city} 室內景點`,
  ];
}

/** 城市模式主要來源：多組 text 搜尋（非 nearby） */
export function isCitySightExploreCategory(categoryId: string): boolean {
  return categoryId === "all" || categoryId === "sight";
}

async function runCityCategoryTextQueries(
  label: string,
  cityCenter: { lat: number; lng: number },
  locale: Locale,
  searchPlacesFn: CitySearchPlacesFn,
  merged: Map<string, PlaceResult>,
  queries: readonly string[],
  categoryId: string,
  radius: number,
  target = CITY_FETCH_RAW_TARGET,
  cacheFields: { cacheCity?: string; cacheDestination?: string } = {},
): Promise<void> {
  for (const queryText of queries) {
    if (merged.size >= target) break;
    try {
      const result = await searchPlacesFn({
        data: {
          lat: cityCenter.lat,
          lng: cityCenter.lng,
          radius,
          query: queryText,
          mode: "text",
          locale,
          categoryId,
          ...cacheFields,
          ...placesStatsPayload({
            placesCaller: "fetchExploreCityCategoryPlaces",
            placesScreen: "explore",
            categoryId,
          }),
        },
      });
      const places = Array.isArray(result.places) ? result.places : [];
      if (places.length === 0) continue;
      console.info(
        "[EXPLORE_CITY_CATEGORY_TEXT]",
        `category=${categoryId}`,
        `query=${queryText}`,
        `count=${places.length}`,
      );
      for (const place of places) {
        acceptCityPlace(place, label, cityCenter, merged, categoryId);
      }
    } catch (e) {
      console.warn("[EXPLORE_CITY_CATEGORY_TEXT]", categoryId, queryText, e);
    }
  }
}

async function runCityCategoryNearbyGroups(
  label: string,
  cityCenter: { lat: number; lng: number },
  locale: Locale,
  searchPlacesFn: CitySearchPlacesFn,
  merged: Map<string, PlaceResult>,
  categoryId: string,
  radius: number,
  target = 24,
  cacheFields: { cacheCity?: string; cacheDestination?: string } = {},
): Promise<void> {
  const buckets = CITY_NEARBY_GROUPS.filter((bucket) => bucket.categoryId === categoryId);
  for (const bucket of buckets) {
    if (merged.size >= target) break;
    for (const includedTypes of bucket.groups) {
      if (merged.size >= target) break;
      try {
        const result = await searchPlacesFn({
          data: {
            lat: cityCenter.lat,
            lng: cityCenter.lng,
            radius,
            query: "",
            mode: "nearby",
            includedTypes,
            locale,
            categoryId,
            ...cacheFields,
            ...placesStatsPayload({
              placesCaller: "fetchExploreCityCategoryPlaces",
              placesScreen: "explore",
              categoryId,
            }),
          },
        });
        const places = Array.isArray(result.places) ? result.places : [];
        if (places.length === 0) continue;
        console.info(
          "[EXPLORE_CITY_CATEGORY_NEARBY]",
          `category=${categoryId}`,
          `types=${includedTypes.join(",")}`,
          `count=${places.length}`,
        );
        for (const place of places) {
          acceptCityPlace(place, label, cityCenter, merged, categoryId);
        }
      } catch (e) {
        console.warn("[EXPLORE_CITY_CATEGORY_NEARBY]", categoryId, e);
      }
    }
  }
}

/** 城市模式：依分類獨立 text + nearby 查詢 */
export async function fetchExploreCityCategoryPlaces(params: {
  categoryId: string;
  cityLabel: string;
  cityCenter: { lat: number; lng: number };
  locale: Locale;
  searchPlacesFn: CitySearchPlacesFn;
}): Promise<PlaceResult[]> {
  const { categoryId, cityLabel, cityCenter, locale, searchPlacesFn } = params;
  const label = normalizeDestinationLabel(cityLabel);
  if (!label || categoryId === "all") return [];

  console.info("[EXPLORE_CITY_CATEGORY_FETCH]", `city=${label}`, `category=${categoryId}`);

  const merged = new Map<string, PlaceResult>();
  const radius = cityExploreRadiusMeters(label);
  const queries = buildCityCategoryFetchQueries(categoryId, label, {
    popularQueries:
      categoryId === "sight" ? exploreCityPopularTextQueries(label) : undefined,
  });

  const cacheFields = {
    cacheCity: label,
    cacheDestination: label,
  };

  await runCityCategoryNearbyGroups(
    label,
    cityCenter,
    locale,
    searchPlacesFn,
    merged,
    categoryId,
    radius,
    CITY_FETCH_RAW_TARGET,
    cacheFields,
  );
  await runCityCategoryTextQueries(
    label,
    cityCenter,
    locale,
    searchPlacesFn,
    merged,
    queries,
    categoryId,
    radius,
    CITY_FETCH_RAW_TARGET,
    cacheFields,
  );
  if (merged.size < CITY_FETCH_RAW_MIN) {
    await runCityCategoryTextQueries(
      label,
      cityCenter,
      locale,
      searchPlacesFn,
      merged,
      queries,
      categoryId,
      radius,
      40,
      cacheFields,
    );
  }

  const final = [...merged.values()];
  console.info("[EXPLORE_CITY_CATEGORY_RESULT]", `city=${label}`, `category=${categoryId}`, `count=${final.length}`);
  return final;
}

export function cityModePrimaryTextQueries(
  categoryId: string,
  cityLabel: string,
  weather?: WeatherSummary | null,
): string[] {
  const categoryQueries = cityCategoryTextQueries(categoryId, cityLabel, weather);
  const popular = exploreCityPopularTextQueries(cityLabel);
  return [...new Set([...categoryQueries, ...popular])];
}

const CITY_AREA_KEEP_NAME_RE =
  /商圈|購物|百貨|mall|market|shopping|district|老街|夜市|表參道|原宿|澀谷|渋谷|新宿|銀座|秋葉原|上野|築地|道頓堀|心齋橋|明洞|暹罗|宁曼|downtown|centro|old town|city center|市中心|舊城|老城|Shibuya|Shinjuku|Ginza|Harajuku|Akihabara|Omotesando|Myeongdong|Dotonbori/i;

export function isExploreCityPoliticalEntity(
  place: Pick<PlaceResult, "name" | "types" | "primaryType">,
): boolean {
  const types = [
    ...(place.types ?? []),
    ...(place.primaryType ? [place.primaryType] : []),
  ].map((t) => t.toLowerCase());

  if (types.some((t) => TOURIST_KEEP_TYPES.has(t))) return false;

  const name = (place.name ?? "").trim();
  if (name && CITY_AREA_KEEP_NAME_RE.test(name)) return false;

  if (!types.some((t) => CITY_ENTITY_TYPES.has(t))) return false;
  if (!name) return true;
  return types.includes("political") || types.includes("locality") || types.includes("country");
}

export function isPlaceInExploreCity(
  place: Pick<PlaceResult, "name" | "address" | "lat" | "lng">,
  cityLabel: string,
  cityCenter: { lat: number; lng: number },
): boolean {
  const label = normalizeDestinationLabel(cityLabel);
  const name = (place.name ?? "").trim();
  const address = (place.address ?? "").trim();
  const hints = CITY_COUNTRY_HINTS[label] ?? [label, cityLabel.trim()].filter(Boolean);

  if (name && hints.some((h) => name.includes(h))) return true;
  if (address && hints.some((h) => address.includes(h))) return true;

  if (place.lat != null && place.lng != null) {
    const dist = distanceMeters(cityCenter, { lat: place.lat, lng: place.lng });
    return dist <= cityExploreRadiusMeters(label);
  }

  return false;
}

function passesCityBootstrapRating(place: PlaceResult, _categoryId = "sight"): boolean {
  return passesCityRelaxedRating(place);
}

function passesCityFetchGate(place: PlaceResult, categoryId: string): boolean {
  if (!passesCityBootstrapRating(place, categoryId)) return false;
  if (isBurialOrFuneralPlace(place)) return false;
  if (isLodgingPlace(place)) return false;
  if (categoryId === "food") {
    const types = new Set<string>();
    const primary = (place.primaryType ?? "").trim().toLowerCase();
    if (primary) types.add(primary);
    for (const t of place.types ?? []) {
      const n = (t ?? "").trim().toLowerCase();
      if (n) types.add(n);
    }
    return (
      types.has("restaurant") ||
      types.has("food") ||
      types.has("meal_takeaway") ||
      types.has("food_store") ||
      types.has("fast_food_restaurant") ||
      types.has("bakery") ||
      types.has("cafe") ||
      types.has("bar")
    );
  }
  if (categoryId === "sight" || categoryId === "all") {
    return passesCityExploreTouristValue(place);
  }
  if (passesCityExploreTouristValue(place)) return true;
  const types = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) types.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) types.add(n);
  }
  return (
    types.has("restaurant") ||
    types.has("cafe") ||
    types.has("coffee_shop") ||
    types.has("bar") ||
    types.has("shopping_mall") ||
    types.has("department_store") ||
    types.has("market") ||
    types.has("tourist_attraction") ||
    types.has("museum")
  );
}

function acceptCityPlace(
  place: PlaceResult,
  label: string,
  cityCenter: { lat: number; lng: number },
  merged: Map<string, PlaceResult>,
  categoryId = "sight",
): void {
  if (!passesCityFetchGate(place, categoryId)) {
    console.info("[EXPLORE_FILTER_DROP]", `name=${place.name ?? ""}`, "reason=city_fetch_gate");
    return;
  }
  if (isExploreCityPoliticalEntity(place)) {
    console.info("[EXPLORE_REJECT_CITY_ENTITY_CARD]", `name=${place.name ?? ""}`);
    return;
  }
  if (!isPlaceInExploreCity(place, label, cityCenter)) return;
  const id = place.id?.trim();
  if (!id) return;
  merged.set(id, place);
}

const CITY_BOOTSTRAP_TARGET = 40;
const CITY_TEXT_QUERY_BUDGET = 24;
const CITY_NEARBY_FALLBACK_MIN = 3;

async function runCityTextQueries(
  label: string,
  cityCenter: { lat: number; lng: number },
  locale: Locale,
  searchPlacesFn: CitySearchPlacesFn,
  merged: Map<string, PlaceResult>,
  maxQueries: number,
): Promise<void> {
  const radius = cityExploreRadiusMeters(label);
  const queries = exploreCityPopularTextQueries(label).slice(0, maxQueries);

  for (let i = 0; i < queries.length; i += 4) {
    if (merged.size >= CITY_BOOTSTRAP_TARGET) break;
    const batch = queries.slice(i, i + 4);
    await Promise.all(
      batch.map(async (queryText) => {
        if (merged.size >= CITY_BOOTSTRAP_TARGET) return;
        try {
          const result = await searchPlacesFn({
            data: {
              lat: cityCenter.lat,
              lng: cityCenter.lng,
              radius,
              query: queryText,
              mode: "text",
              locale,
              categoryId: "sight",
              ...placesStatsPayload({
                placesCaller: "fetchExploreCityBootstrap",
                placesScreen: "explore",
                categoryId: "sight",
              }),
            },
          });
          const places = Array.isArray(result.places) ? result.places : [];
          if (places.length === 0) return;
          console.info("[EXPLORE_TEXT_SEARCH_FALLBACK]", `query=${queryText}`, `count=${places.length}`);
          for (const place of places) {
            acceptCityPlace(place, label, cityCenter, merged, categoryId);
          }
        } catch (e) {
          console.warn("[EXPLORE_TEXT_SEARCH_FALLBACK]", queryText, e);
        }
      }),
    );
  }
}

async function runCityNearbyGroups(
  label: string,
  cityCenter: { lat: number; lng: number },
  locale: Locale,
  searchPlacesFn: CitySearchPlacesFn,
  merged: Map<string, PlaceResult>,
): Promise<void> {
  const radius = cityExploreRadiusMeters(label);

  for (const bucket of CITY_NEARBY_GROUPS) {
    if (merged.size >= CITY_BOOTSTRAP_TARGET) break;
    for (const includedTypes of bucket.groups) {
      if (merged.size >= CITY_BOOTSTRAP_TARGET) break;
      try {
        const result = await searchPlacesFn({
          data: {
            lat: cityCenter.lat,
            lng: cityCenter.lng,
            radius,
            query: "",
            mode: "nearby",
            includedTypes,
            locale,
            categoryId: bucket.categoryId,
            ...placesStatsPayload({
              placesCaller: "fetchExploreCityBootstrap",
              placesScreen: "explore",
              categoryId: bucket.categoryId,
            }),
          },
        });
        const places = Array.isArray(result.places) ? result.places : [];
        if (places.length === 0) continue;
        console.info(
          "[EXPLORE_CITY_NEARBY_FALLBACK]",
          `category=${bucket.categoryId}`,
          `types=${includedTypes.join(",")}`,
          `count=${places.length}`,
        );
        for (const place of places) {
          acceptCityPlace(place, label, cityCenter, merged, bucket.categoryId);
        }
      } catch (e) {
        console.warn("[EXPLORE_CITY_NEARBY_FALLBACK]", bucket.categoryId, e);
      }
    }
  }
}

/** 搜尋提交：優先選城市本體，而非同名本地店家 */
export function pickExploreCitySuggestion(
  query: string,
  suggestions: TripStopSuggestion[],
): TripStopSuggestion | null {
  const trimmed = query.trim();
  if (!trimmed || suggestions.length === 0) return null;

  console.info("[EXPLORE_CITY_SEARCH]", `query=${trimmed}`, `suggestions=${suggestions.length}`);

  const normalizedQuery = normalizeDestinationLabel(trimmed);
  const cityCandidates = suggestions.filter((s) => {
    const label = s.label.trim();
    const types = s.types ?? [];
    const isCityEntity =
      isCityRecommendSelection({ label, types, primaryType: types[0] ?? null }) ||
      types.some((t) => CITY_ENTITY_TYPES.has(t.toLowerCase()));
    return (
      isCityEntity &&
      (label === trimmed ||
        label === normalizedQuery ||
        label.startsWith(trimmed) ||
        trimmed.startsWith(label) ||
        isKnownTouristCityLabel(normalizedQuery))
    );
  });

  if (cityCandidates.length > 0) {
    const picked = cityCandidates.sort((a, b) => (b.distanceMeters ?? 0) - (a.distanceMeters ?? 0))[0]!;
    console.info("[EXPLORE_CITY_GEOCODE]", `label=${picked.label}`, `placeId=${picked.placeId ?? ""}`);
    return picked;
  }

  const picked = pickPrimarySuggestion(trimmed, suggestions);
  if (picked) {
    console.info("[EXPLORE_CITY_GEOCODE]", `fallbackLabel=${picked.label}`, `placeId=${picked.placeId ?? ""}`);
  }
  return picked;
}

/** 城市模式：nearby + 多語 text + 地標 query，補足熱門地點 */
export async function fetchExploreCityBootstrapPlaces(params: {
  cityLabel: string;
  cityCenter: { lat: number; lng: number };
  locale: Locale;
  searchPlacesFn: CitySearchPlacesFn;
}): Promise<PlaceResult[]> {
  const { cityLabel, cityCenter, locale, searchPlacesFn } = params;
  const label = normalizeDestinationLabel(cityLabel);
  console.info("[EXPLORE_POPULAR_PLACES_FETCH]", `city=${label}`, `lat=${cityCenter.lat}`, `lng=${cityCenter.lng}`);
  console.info("[EXPLORE_DESTINATION_COORDS]", `lat=${cityCenter.lat}`, `lng=${cityCenter.lng}`);

  const merged = new Map<string, PlaceResult>();

  await runCityTextQueries(label, cityCenter, locale, searchPlacesFn, merged, CITY_TEXT_QUERY_BUDGET);
  if (merged.size < CITY_NEARBY_FALLBACK_MIN) {
    await runCityNearbyGroups(label, cityCenter, locale, searchPlacesFn, merged);
  }
  if (merged.size < CITY_NEARBY_FALLBACK_MIN) {
    await runCityTextQueries(label, cityCenter, locale, searchPlacesFn, merged, CITY_TEXT_QUERY_BUDGET);
  }

  const final = [...merged.values()];
  console.info("[EXPLORE_FINAL_RECOMMENDATIONS]", `city=${label}`, `count=${final.length}`);
  return final;
}

/** @deprecated 改用 fetchExploreCityBootstrapPlaces */
export async function fetchExploreCityPopularPlaces(params: {
  cityLabel: string;
  cityCenter: { lat: number; lng: number };
  locale: Locale;
  searchPlacesFn: CitySearchPlacesFn;
}): Promise<PlaceResult[]> {
  return fetchExploreCityBootstrapPlaces(params);
}
