import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import type { ComposedDayPlan, DayPlanEntry, DayPlanSlot, PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isCafePlace,
  isExcludedRetailPlace,
  isLargeMallPlace,
  isMarketPlace,
  isNightMarketPlace,
  isProperRestaurantPlace,
  parseDayPlanTimeMinutes,
} from "@/lib/ai/ai-day-plan-slot-rules";
import { isRecEnginePlannerEnabled } from "@/lib/recommendation/engine/feature-flag-planner";

export const CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY = 2;
export const CLASSIC_LANDMARK_MIN_ITEMS_PER_DAY = 5;
export const CLASSIC_LANDMARK_MIN_PER_DAY = CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY;
export const CLASSIC_LANDMARK_MAX_LEG_DISTANCE_M = 30_000;

export const CLASSIC_LANDMARK_ALLOW_RESTAURANT = true;
export const CLASSIC_LANDMARK_ALLOW_CAFE = true;
export const CLASSIC_LANDMARK_ALLOW_NIGHT_MARKET = false;

const CLASSIC_LANDMARK_EXCLUDED_NAME_RE =
  /市場|黃昏市場|中央市場|肉品市場|公有市場|菜市場|觀光夜市|夜市|咖啡|coffee|餐廳|小吃|便當|輕食|食雞|燒賣|超市|賣場|量販|菓子|甜點店|烘焙/i;

const LOCAL_PARK_NAME_RE =
  /兒童公園|社區公園|運動公園|濕地公園|新生公園|河濱公園|森林步道|自行車道|鐵馬道|海濱公園|東海濕地/i;

const FAMOUS_LANDMARK_PARK_RE =
  /國家公園|國家森林|森林公園|森林遊樂區|遺址公園|美術館|遊憩區|自然公園|國家級/i;

const CREATIVE_MARKET_EVENT_RE =
  /文創市集|假日市集|手作市集|藝術市集|農夫市集|創意市集|跳蚤市場|市集活動/i;

const CLASSIC_LANDMARK_KEYWORD_RE =
  /景點|地標|博物館|美術館|遺址|古蹟|海岸|燈塔|港口|港|灣|瀑布|溫泉|部落|文創園區|鐵花村|伯朗|三仙|小野柳|加路蘭|多良|鹿野|卑南|池上|成功|牧場|漁港|遊客中心|金剛大道|知本|高台|車站|觀光/i;

const CLASSIC_CHAIN_RE =
  /麥當勞|肯德基|摩斯|subway|漢堡王|burger\s*king|必勝客|達美樂|kfc|mcdonald|星巴克|starbucks|路易莎|louisa|cama|85度c|50嵐|清心|迷客夏|可不可|CoCo|七十一|7-eleven|familymart|全家|萊爾富|全聯|家樂福|costco|ikea|三商巧福|丸亀|築間|石二鍋/i;

const CLASSIC_FOOD_COURT_RE = /美食街|百貨.*餐|food\s*court|美食廣場/i;

const CLASSIC_HARD_EXCLUDED_TYPES = new Set([
  "restaurant",
  "cafe",
  "coffee_shop",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "market",
  "supermarket",
  "grocery_store",
  "convenience_store",
  "department_store",
  "shopping_mall",
  "night_club",
  "bar",
  "bakery",
  "playground",
  "dog_park",
]);

const CLASSIC_PRIORITY_TYPES = new Set([
  "landmark",
  "historical_landmark",
  "cultural_landmark",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "monument",
  "natural_feature",
  "observation_deck",
  "zoo",
  "aquarium",
  "amusement_park",
  "theme_park",
]);

const LUNCH_RE = /午餐/;
const DINNER_RE = /晚餐|宵夜/;
const CAFE_SLOT_RE = /咖啡|甜點/;

const CLASSIC_REGION_DAY_KEYWORDS: Record<string, RegExp[]> = {
  台東: [
    /台東市|鐵花村|美術館|卑南|市區|知本|初鹿|富岡|森林公園/,
    /池上|鹿野|伯朗|高台/,
    /三仙台|多良|加路蘭|小野柳|太麻里|成功|都歷|金剛|海線|港口|遊客中心/,
  ],
};

const CLASSIC_REGION_DAY_QUERIES: Record<string, string[][]> = {
  台東: [
    ["台東市區 地標", "鐵花村", "台東美術館", "卑南遺址", "台東森林公園"],
    ["池上 伯朗大道", "鹿野高台", "鹿野 景點", "池上 景點"],
    ["三仙台", "多良車站", "加路蘭", "小野柳", "都歷遊客中心", "太麻里"],
  ],
};

const CLASSIC_LANDMARK_WHITELIST: Record<string, string[]> = {
  台東: [
    "三仙台",
    "鹿野高台",
    "池上伯朗大道",
    "多良車站",
    "加路蘭遊憩區",
    "小野柳",
    "鐵花村",
    "台東森林公園",
    "知本森林遊樂區",
    "初鹿牧場",
    "金剛大道",
    "富岡漁港",
    "都歷遊客中心",
    "卑南遺址公園",
    "台東美術館",
  ],
};

function placeTypes(place: PlaceResult): Set<string> {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  return out;
}

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function logClassicLandmarkExcluded(name: string, reason: string): void {
  logAiPipeline("[AI_CLASSIC_LANDMARK_EXCLUDED]", `name=${name}`, `reason=${reason}`);
}

export function logClassicSearchQueryStart(query: string): void {
  logAiPipeline("[AI_CLASSIC_SEARCH_QUERY_START]", `query=${query}`);
}

export function logClassicSearchQueryResult(query: string, count: number): void {
  logAiPipeline("[AI_CLASSIC_SEARCH_QUERY_RESULT]", `query=${query}`, `count=${count}`);
}

export function logClassicNormalizeKept(name: string): void {
  logAiPipeline("[AI_CLASSIC_NORMALIZE_KEPT]", `name=${name}`);
}

export function logClassicNormalizeDropped(name: string, reason: string): void {
  logAiPipeline("[AI_CLASSIC_NORMALIZE_DROPPED]", `name=${name}`, `reason=${reason}`);
}

export function logClassicFallbackWhitelistStart(
  destination: string,
  current: number,
  required: number,
): void {
  logAiPipeline(
    "[AI_CLASSIC_FALLBACK_WHITELIST_START]",
    `destination=${destination}`,
    `current=${current}`,
    `required=${required}`,
  );
}

export function logClassicFallbackResolveSuccess(name: string, placeId: string): void {
  logAiPipeline("[AI_CLASSIC_FALLBACK_RESOLVE_SUCCESS]", `name=${name}`, `placeId=${placeId}`);
}

export function logClassicFinalValidCount(count: number, required: number): void {
  logAiPipeline("[AI_CLASSIC_FINAL_VALID_COUNT]", `count=${count}`, `required=${required}`);
}

export function logClassicDayRebuild(day: number, reason: string): void {
  logAiPipeline("[AI_CLASSIC_DAY_REBUILD]", `day=${day}`, `reason=${reason}`);
}

export function logClassicRenderReady(placeCount: number, days: number): void {
  logAiPipeline("[AI_CLASSIC_RENDER_READY]", `places=${placeCount}`, `days=${days}`);
}

export function logClassicLandmarkValidateFail(reason: string, detail: string, day?: number): void {
  logAiPipeline(
    "[AI_CLASSIC_LANDMARK_VALIDATE_FAIL]",
    `reason=${reason}`,
    day != null ? `day=${day}` : "",
    detail ? `name=${detail}` : "",
  );
}

export function logClassicLandmarkValidateStart(): void {
  logAiPipeline("[AI_CLASSIC_LANDMARK_VALIDATE_START]");
}

function matchesClassicWhitelistName(name: string): boolean {
  const norm = normalizePlaceName(name);
  if (!norm) return false;
  for (const names of Object.values(CLASSIC_LANDMARK_WHITELIST)) {
    for (const candidate of names) {
      const key = normalizePlaceName(candidate);
      if (key && (norm === key || norm.includes(key) || key.includes(norm))) return true;
    }
  }
  return false;
}

export function getClassicLandmarkWhitelist(destination: string): string[] {
  const label = normalizeDestinationLabel(destination);
  return CLASSIC_LANDMARK_WHITELIST[label] ?? [];
}

export function isFamousLandmarkPark(place: PlaceResult): boolean {
  const name = place.name ?? "";
  if (matchesClassicWhitelistName(name)) return true;
  return FAMOUS_LANDMARK_PARK_RE.test(name);
}

export function isLocalNeighborhoodPark(place: PlaceResult): boolean {
  const name = place.name ?? "";
  if (LOCAL_PARK_NAME_RE.test(name)) return true;
  const types = placeTypes(place);
  if (types.has("playground") || types.has("dog_park")) return true;
  if (types.has("park") && /公園/.test(name) && !isFamousLandmarkPark(place)) {
    return true;
  }
  return false;
}

export function isCreativeMarketEvent(place: PlaceResult): boolean {
  return CREATIVE_MARKET_EVENT_RE.test(placeBlob(place));
}

export function isTraditionalMarketPlace(place: PlaceResult): boolean {
  if (isCreativeMarketEvent(place)) return false;
  const blob = placeBlob(place);
  if (isNightMarketPlace(place)) return true;
  if (placeTypes(place).has("market")) return true;
  return /傳統市場|中央市場|黃昏市場|肉品市場|公有市場|菜市場|零售市場|肉市場|觀光夜市|夜市/.test(blob);
}

function hasHardExcludedClassicType(types: Set<string>): boolean {
  return [...types].some((t) => CLASSIC_HARD_EXCLUDED_TYPES.has(t));
}

export function isExcludedFromClassicLandmarkScenic(place: PlaceResult): boolean {
  if (isExcludedRetailPlace(place)) return true;
  if (isLargeMallPlace(place)) return true;
  if (isTraditionalMarketPlace(place)) return true;
  if (isNightMarketPlace(place)) return true;
  if (isCafePlace(place)) return true;
  if (isLocalNeighborhoodPark(place)) return true;

  const blob = placeBlob(place);
  const types = placeTypes(place);

  if (CLASSIC_LANDMARK_EXCLUDED_NAME_RE.test(blob)) {
    if (isCreativeMarketEvent(place) && /園區|文創|hub/i.test(blob)) return false;
    return true;
  }

  if (hasHardExcludedClassicType(types)) return true;
  if (types.has("store") && !types.has("tourist_attraction")) return true;

  return false;
}

export function isClassicLandmarkScenicCandidate(place: PlaceResult): boolean {
  if (isExcludedFromClassicLandmarkScenic(place)) return false;

  const types = placeTypes(place);
  const blob = placeBlob(place);
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;

  if (matchesClassicWhitelistName(place.name ?? "")) return true;

  if (types.has("park")) {
    return isFamousLandmarkPark(place);
  }

  if ([...types].some((t) => CLASSIC_PRIORITY_TYPES.has(t))) {
    if (types.has("establishment") || types.has("point_of_interest")) {
      if (CLASSIC_LANDMARK_KEYWORD_RE.test(blob)) return true;
      if (rating >= 4.0 && reviews >= 30) return true;
      return false;
    }
    return true;
  }

  if (CLASSIC_LANDMARK_KEYWORD_RE.test(blob) && rating >= 3.8 && reviews >= 20) return true;

  return false;
}

/**
 * Classic landmark 優先分數。
 * @deprecated Flag ON（P2.3）不再用於排序；僅 Flag OFF legacy。
 */
export function scoreClassicLandmarkPriority(place: PlaceResult): number {
  if (isExcludedFromClassicLandmarkScenic(place)) return -100;
  if (isLocalNeighborhoodPark(place)) return 0;

  const types = placeTypes(place);
  const blob = placeBlob(place);
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;

  let base = 0;
  if (types.has("landmark") || types.has("historical_landmark") || types.has("cultural_landmark")) {
    base = 100;
  } else if (matchesClassicWhitelistName(place.name ?? "")) {
    base = 95;
  } else if (types.has("tourist_attraction")) {
    base = 90;
  } else if (/觀光|scenic|必去/i.test(blob)) {
    base = 85;
  } else if (/古蹟|遺址|historical/i.test(blob) || types.has("monument")) {
    base = 80;
  } else if (types.has("museum") || types.has("art_gallery")) {
    base = 75;
  } else if (/文化|cultural/i.test(blob)) {
    base = 70;
  } else if (isCreativeMarketEvent(place)) {
    base = 60;
  } else if (isFamousLandmarkPark(place)) {
    base = 20;
  } else if (types.has("park")) {
    base = 0;
  } else if (types.has("establishment") || types.has("point_of_interest")) {
    base = CLASSIC_LANDMARK_KEYWORD_RE.test(blob) ? 50 : 10;
  }

  if (base <= 0) return base;
  base += Math.min(12, Math.log10(reviews + 1) * 4);
  base += Math.min(8, Math.max(0, (rating - 3.5) * 4));
  return base;
}

/**
 * Flag ON（P2.3）：保留輸入順序（Engine pool），不依 priority 重排。
 * Flag OFF：legacy scoreClassicLandmarkPriority 排序。
 */
export function sortClassicLandmarkPlaces(places: PlaceResult[]): PlaceResult[] {
  if (isRecEnginePlannerEnabled()) {
    return [...places];
  }
  return [...places].sort(
    (a, b) => scoreClassicLandmarkPriority(b) - scoreClassicLandmarkPriority(a),
  );
}

export function countClassicLandmarkScenicPlaces(places: PlaceResult[]): number {
  return places.filter((p) => isClassicLandmarkScenicCandidate(p)).length;
}

export function placeMatchesClassicDayRegion(
  place: PlaceResult,
  destination: string,
  dayIndex: number,
): boolean {
  const label = normalizeDestinationLabel(destination);
  const regions = CLASSIC_REGION_DAY_KEYWORDS[label];
  if (!regions?.length) return true;
  const re = regions[dayIndex % regions.length];
  if (!re) return true;
  return re.test(placeBlob(place));
}

export function filterPlacesForClassicLandmark(places: PlaceResult[]): PlaceResult[] {
  const scenic: PlaceResult[] = [];
  for (const place of places) {
    if (!place.name?.trim()) continue;
    if (isClassicLandmarkScenicCandidate(place)) {
      scenic.push(place);
    } else if (isExcludedFromClassicLandmarkScenic(place) || isLocalNeighborhoodPark(place)) {
      logClassicLandmarkExcluded(place.name, "scenic_excluded");
    }
  }
  return sortClassicLandmarkPlaces(scenic);
}

export function filterPlacesForClassicLandmarkWithLogging(
  places: PlaceResult[],
  days: number,
): PlaceResult[] {
  const scenic: PlaceResult[] = [];
  const minRequired = Math.max(1, days) * CLASSIC_LANDMARK_MIN_PER_DAY;

  for (const place of places) {
    if (!place.name?.trim()) continue;
    if (isClassicLandmarkScenicCandidate(place)) {
      logClassicNormalizeKept(place.name);
      scenic.push(place);
      continue;
    }
    const reason = isLocalNeighborhoodPark(place)
      ? "local_park"
      : isExcludedFromClassicLandmarkScenic(place)
        ? "excluded"
        : "not_landmark";
    logClassicNormalizeDropped(place.name, reason);
  }

  const result = sortClassicLandmarkPlaces(scenic);
  if (result.length < minRequired) {
    logAiPipeline(
      "[AI_CLASSIC_NORMALIZE_DROPPED]",
      `reason=pool_short`,
      `scenic=${result.length}`,
      `required=${minRequired}`,
    );
  }
  return result;
}

export const CLASSIC_LANDMARK_DAY_SLOTS: DayPlanSlot[] = [
  { time: "09:00", kind: "attraction", label: "景點" },
  { time: "12:00", kind: "restaurant", label: "午餐" },
  { time: "14:00", kind: "attraction", label: "景點" },
  { time: "16:00", kind: "cafe", label: "咖啡 / 甜點" },
  { time: "18:00", kind: "restaurant", label: "晚餐" },
];

export function isClassicExcludedMealPlace(place: PlaceResult): boolean {
  if (isExcludedRetailPlace(place)) return true;
  if (isLargeMallPlace(place)) return true;
  if (CLASSIC_CHAIN_RE.test(placeBlob(place))) return true;
  if (CLASSIC_FOOD_COURT_RE.test(placeBlob(place))) return true;
  if (isMarketPlace(place)) return true;
  const types = placeTypes(place);
  if (types.has("supermarket") || types.has("grocery_store") || types.has("convenience_store")) {
    return true;
  }
  if (types.has("shopping_mall") || types.has("department_store")) return true;
  return false;
}

function hasMealRatingData(place: PlaceResult): boolean {
  return place.rating != null && (place.userRatingCount ?? 0) > 0;
}

export function isClassicLunchPlace(place: PlaceResult): boolean {
  if (isClassicExcludedMealPlace(place)) return false;
  if (!isProperRestaurantPlace(place)) return false;
  if (!hasMealRatingData(place)) return true;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating >= 4.3 && reviews >= 500;
}

export function isClassicCafePlace(place: PlaceResult): boolean {
  if (isClassicExcludedMealPlace(place)) return false;
  if (!isCafePlace(place)) return false;
  if (!hasMealRatingData(place)) return true;
  return (place.rating ?? 0) >= 4.4;
}

export function isClassicDinnerPlace(place: PlaceResult): boolean {
  if (isClassicExcludedMealPlace(place)) return false;
  if (!isProperRestaurantPlace(place)) return false;
  if (!hasMealRatingData(place)) return true;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating >= 4.4 && reviews >= 1000;
}

export function isClassicMealPoolPlace(place: PlaceResult): boolean {
  return (
    isClassicLunchPlace(place) ||
    isClassicDinnerPlace(place) ||
    isClassicCafePlace(place)
  );
}

export function buildClassicLandmarkMealSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  return [
    { query: `${label} 在地美食 餐廳`, mode: "text", includedTypes: ["restaurant", "food"] },
    { query: `${label} 必吃 餐廳`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 特色 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop", "bakery"] },
    { query: `${label} 晚餐 推薦`, mode: "text", includedTypes: ["restaurant", "food"] },
    { query: `${label} 午餐 推薦`, mode: "text", includedTypes: ["restaurant", "food"] },
  ];
}

export function mergeClassicLandmarkPlanningPool(
  places: PlaceResult[],
  days: number,
): PlaceResult[] {
  const scenic = filterPlacesForClassicLandmarkWithLogging(places, days);
  const seen = new Set(scenic.map((p) => p.id ?? p.name));
  const meals = places.filter((p) => {
    const id = p.id ?? p.name;
    if (!id || seen.has(id)) return false;
    if (!isClassicMealPoolPlace(p)) return false;
    seen.add(id);
    return true;
  });
  return [...scenic, ...meals];
}

export function buildClassicLandmarkSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const scenicTypes = [
    "tourist_attraction",
    "point_of_interest",
    "museum",
    "natural_feature",
    "historical_landmark",
  ];

  const queries = [
    `${label} 必去景點`,
    `${label} 熱門景點`,
    `${label} 觀光景點`,
    `${label} 地標`,
    `${label} 博物館`,
    `${label} 古蹟`,
    `${label} 知名景點`,
    `${label} 池上 伯朗大道`,
    `${label} 鹿野 高台`,
    `${label} 三仙台`,
    `${label} 多良 車站`,
    `${label} 太麻里 景點`,
  ];

  const attempts: SearchAttempt[] = queries.map((query) => ({
    query,
    mode: "text" as const,
    includedTypes: scenicTypes,
  }));

  const en = EN_CITY_NAMES[label];
  if (en && en !== label) {
    attempts.push(
      { query: `${en} landmarks`, mode: "text", includedTypes: ["tourist_attraction", "historical_landmark"] },
      { query: `${en} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction", "point_of_interest"] },
      { query: `${en} must visit`, mode: "text", includedTypes: ["tourist_attraction"] },
    );
  }

  return attempts;
}

export function buildClassicLandmarkRegionalAttempts(
  destination: string,
  dayIndex: number,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const regional = CLASSIC_REGION_DAY_QUERIES[label];
  if (!regional?.length) return [];

  const queries = regional[dayIndex % regional.length] ?? regional[0] ?? [];
  return queries.map((query) => ({
    query,
    mode: "text" as const,
    includedTypes: ["tourist_attraction", "museum", "natural_feature", "historical_landmark"],
  }));
}

export function buildClassicLandmarkSupplementAttempts(
  destination: string,
  pass: number,
): SearchAttempt[] {
  if (pass === 0) return buildClassicLandmarkSearchAttempts(destination);
  const label = normalizeDestinationLabel(destination);
  return [
    { query: `${label} 必去`, mode: "text", includedTypes: ["tourist_attraction", "point_of_interest"] },
    { query: `${label} 觀光 地標`, mode: "text", includedTypes: ["tourist_attraction", "historical_landmark"] },
    { query: `${label} 古蹟`, mode: "text", includedTypes: ["tourist_attraction", "museum"] },
  ];
}

export type ClassicLandmarkValidationResult = {
  ok: boolean;
  reasons: string[];
  failedDays: number[];
};

export function validateClassicLandmarkItinerary(
  plans: ComposedDayPlan[],
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): ClassicLandmarkValidationResult {
  logClassicLandmarkValidateStart();
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    let scenicCount = 0;
    let lunchCount = 0;
    let dinnerCount = 0;

    for (const entry of plan.entries) {
      const kind = classifyKind(entry.place);
      const isLunch = LUNCH_RE.test(entry.label);
      const isDinner = DINNER_RE.test(entry.label);
      const isCafeSlot = CAFE_SLOT_RE.test(entry.label);

      if (isLunch) {
        if (!isClassicLunchPlace(entry.place) && !isProperRestaurantPlace(entry.place)) {
          reasons.push(`invalid_lunch:${entry.name}`);
          logClassicLandmarkValidateFail("invalid_lunch", entry.name, plan.day);
          failedDays.add(plan.day);
        } else {
          lunchCount += 1;
        }
        continue;
      }

      if (isDinner) {
        if (!isClassicDinnerPlace(entry.place) && !isProperRestaurantPlace(entry.place)) {
          reasons.push(`invalid_dinner:${entry.name}`);
          logClassicLandmarkValidateFail("invalid_dinner", entry.name, plan.day);
          failedDays.add(plan.day);
        } else {
          dinnerCount += 1;
        }
        continue;
      }

      if (isCafeSlot) {
        if (!isClassicCafePlace(entry.place) && !isCafePlace(entry.place)) {
          reasons.push(`invalid_cafe:${entry.name}`);
          logClassicLandmarkValidateFail("invalid_cafe", entry.name, plan.day);
          failedDays.add(plan.day);
        }
        continue;
      }

      if (
        isExcludedFromClassicLandmarkScenic(entry.place) ||
        isLocalNeighborhoodPark(entry.place) ||
        kind === "market" ||
        kind === "night_market" ||
        kind === "shopping" ||
        isTraditionalMarketPlace(entry.place) ||
        isNightMarketPlace(entry.place)
      ) {
        reasons.push(`invalid_scenic:${entry.name}`);
        logClassicLandmarkValidateFail("invalid_scenic_type", entry.name, plan.day);
        failedDays.add(plan.day);
      } else if (isClassicLandmarkScenicCandidate(entry.place)) {
        scenicCount += 1;
      }
    }

    if (scenicCount < CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY) {
      reasons.push(`too_few_landmarks:day${plan.day}`);
      logClassicLandmarkValidateFail("too_few_landmarks", "", plan.day);
      failedDays.add(plan.day);
    }
    if (lunchCount < 1) {
      reasons.push(`missing_lunch:day${plan.day}`);
      logClassicLandmarkValidateFail("missing_lunch", "", plan.day);
      failedDays.add(plan.day);
    }
    if (dinnerCount < 1) {
      reasons.push(`missing_dinner:day${plan.day}`);
      logClassicLandmarkValidateFail("missing_dinner", "", plan.day);
      failedDays.add(plan.day);
    }

    if (plan.entries.length < CLASSIC_LANDMARK_MIN_ITEMS_PER_DAY) {
      reasons.push(`too_few_items:day${plan.day}`);
      logClassicLandmarkValidateFail("too_few_items", "", plan.day);
      failedDays.add(plan.day);
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function canFillClassicLandmarkSlot(
  place: PlaceResult,
  slot: DayPlanSlot,
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): boolean {
  if (LUNCH_RE.test(slot.label)) {
    return isClassicLunchPlace(place);
  }
  if (DINNER_RE.test(slot.label)) {
    return isClassicDinnerPlace(place);
  }
  if (slot.kind === "cafe" || CAFE_SLOT_RE.test(slot.label)) {
    return isClassicCafePlace(place);
  }
  if (slot.kind === "restaurant" || slot.kind === "night_market") {
    return false;
  }
  const kind = classifyKind(place);
  if (
    kind === "market" ||
    kind === "cafe" ||
    kind === "night_market" ||
    kind === "shopping" ||
    kind === "restaurant"
  ) {
    return false;
  }
  return isClassicLandmarkScenicCandidate(place);
}
