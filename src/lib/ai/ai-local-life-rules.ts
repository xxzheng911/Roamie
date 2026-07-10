import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import type { DayPlanSlot } from "@/lib/ai/ai-day-plan-source";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isCafePlace,
  isExcludedRetailPlace,
  isLargeMallPlace,
  isNightMarketPlace,
  isProperRestaurantPlace,
} from "@/lib/ai/ai-day-plan-slot-rules";
import { classifyTripPlaceCategory } from "@/lib/ai/trip-place-scoring";
import { buildSyntheticClassicLandmarkPlace } from "@/lib/places-classic-landmark-cache";
import { isGeocodeEmptyPlace } from "@/lib/ai/ai-trip-place-allocator";

export const LOCAL_LIFE_MIN_ITEMS_PER_DAY = 7;
export const LOCAL_LIFE_MAX_ITEMS_PER_DAY = 7;

export const LOCAL_LIFE_DAY_SLOTS: DayPlanSlot[] = [
  { time: "08:30", kind: "restaurant", label: "早餐" },
  { time: "10:00", kind: "attraction", label: "景點" },
  { time: "12:00", kind: "restaurant", label: "午餐" },
  { time: "14:00", kind: "attraction", label: "景點" },
  { time: "16:00", kind: "cafe", label: "咖啡" },
  { time: "18:00", kind: "restaurant", label: "晚餐" },
  { time: "20:00", kind: "night_market", label: "酒吧" },
];

const LOCAL_LIFE_EXCLUDED_NAME_RE =
  /健康綠洲|社區公園|運動公園|兒童公園|河濱公園|濕地公園|親水公園|棒球場|田徑場|停車場|全聯|家樂福|costco|量販|超市|便利商店|住宅區|社區/i;

const LOCAL_LIFE_POSITIVE_RE =
  /老街|商圈|文創|夜市|小吃|咖啡|巷|弄|市場|傳統|生活|散步|黃昏|海安|國華|正興|友愛|安平|神農|藍晒|河樂|赤崁|孔廟|武廟|億載|漁光|鹽水|關子嶺|新化|善化/i;

const AREA_PATTERNS: Record<string, Record<string, RegExp>> = {
  台南: {
    TAINAN_WEST_CENTRAL_FOOD_AREA:
      /中西區|國華街|友愛街|正興街|海安路|中西區.*小吃|永樂市場|水仙宮|赤崁.*小吃|民族路|民權路.*商圈/,
    TAINAN_HISTORIC_CENTER: /赤崁樓|祀典武廟|林百貨|孔廟|大天后宮|五妃廟|開基三山國王廟/,
    TAINAN_ANPING: /安平|安平老街|漁光島|億載金城|德陽艦|觀夕|古堡|樹屋|台江/,
    TAINAN_CREATIVE_WALK: /神農街|藍晒圖|河樂廣場|蝸牛巷|文創|新美街|普濟殿|文化創意產業/,
    TAINAN_EAST: /東區|成大|巴克禮|藍圖|奇美|裕農|崇明|大學路/,
    TAINAN_NORTH: /北區|花園夜市|小北|成功路|公園路.*北/,
    TAINAN_XINHUA: /新化|新化老街/,
    TAINAN_OUTER_DAYTRIP: /鹽水|後壁|白河|關子嶺|善化|玉井|六甲|麻豆/,
  },
};

const DAY_AREA_PRIORITY: Record<string, string[][]> = {
  台南: [
    ["TAINAN_WEST_CENTRAL_FOOD_AREA", "TAINAN_CREATIVE_WALK", "TAINAN_HISTORIC_CENTER"],
    ["TAINAN_ANPING", "TAINAN_EAST", "TAINAN_NORTH"],
    ["TAINAN_XINHUA", "TAINAN_OUTER_DAYTRIP", "TAINAN_NORTH", "TAINAN_EAST"],
  ],
};

const AREA_SEARCH_QUERIES: Record<string, Record<string, string[]>> = {
  台南: {
    TAINAN_WEST_CENTRAL_FOOD_AREA: ["台南 國華街", "台南 中西區 小吃", "台南 正興街", "台南 神農街", "台南 海安路"],
    TAINAN_HISTORIC_CENTER: ["台南 赤崁樓", "台南 孔廟", "台南 祀典武廟", "台南 林百貨"],
    TAINAN_ANPING: ["台南 安平老街", "台南 安平古堡", "台南 漁光島", "台南 億載金城"],
    TAINAN_CREATIVE_WALK: ["台南 藍晒圖", "台南 神農街", "台南 河樂廣場", "台南 文創"],
    TAINAN_EAST: ["台南 東區 商圈", "台南 成大 周邊", "台南 奇美博物館", "台南 藍圖"],
    TAINAN_NORTH: ["台南 北區 花園夜市", "台南 北區 商圈", "台南 花園夜市 周邊"],
    TAINAN_XINHUA: ["台南 新化老街", "台南 新化 小吃"],
    TAINAN_OUTER_DAYTRIP: ["台南 鹽水", "台南 後壁", "台南 關子嶺", "台南 善化", "台南 白河"],
  },
};

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function normalizeLocalLifePlaceName(name: string, destination?: string): string {
  const raw = name.trim();
  if (!raw) return "";
  let compact = raw.toLowerCase().replace(/\s+/g, "").replace(/[（(].*[)）]/g, "");
  const dest = destination ? normalizeDestinationLabel(destination) : "";
  if (dest) {
    compact = compact
      .replace(new RegExp(`^${dest}`, "i"), "")
      .replace(/^臺南|^台南/i, "");
  }
  compact = compact.replace(/商圈|街區|老街|觀光/i, "");
  return compact || normalizePlaceName(raw);
}

export function normalizeAreaKey(place: PlaceResult, destination: string): string | null {
  const label = normalizeDestinationLabel(destination);
  const patterns = AREA_PATTERNS[label];
  const blob = [place.name, place.address].filter(Boolean).join(" ");
  if (patterns) {
    for (const [key, re] of Object.entries(patterns)) {
      if (re.test(blob)) return key;
    }
  }
  if (/商圈|老街|夜市|文創|小吃街|food/i.test(blob)) {
    return `${label}_GENERIC_DISTRICT`;
  }
  return null;
}

export function preferredAreaKeysForDay(destination: string, dayIndex: number): string[] {
  const label = normalizeDestinationLabel(destination);
  const table = DAY_AREA_PRIORITY[label];
  if (!table?.length) return [];
  return table[dayIndex % table.length] ?? [];
}

export function isLocalLifeExcludedPlace(place: PlaceResult): boolean {
  if (isExcludedRetailPlace(place)) return true;
  if (isLargeMallPlace(place)) return true;
  const blob = placeBlob(place);
  if (LOCAL_LIFE_EXCLUDED_NAME_RE.test(blob)) return true;
  if (/永樂市場|水仙宮市場|傳統市場|公有市場|批發市場|零售市場|公有零售|新民市場|第三公有|肉品市場|果菜市場|黃昏市場|早市|菜市場/.test(blob) && !/商圈|周邊|附近|街/.test(blob)) {
    return true;
  }

  const category = classifyTripPlaceCategory(place);
  if (category === "park" && !LOCAL_LIFE_POSITIVE_RE.test(blob)) return true;
  if (category === "trail" || category === "generic") {
    return !LOCAL_LIFE_POSITIVE_RE.test(blob);
  }
  return false;
}

export function isLocalLifeDistrictCandidate(place: PlaceResult): boolean {
  if (isLocalLifeExcludedPlace(place)) return false;
  const category = classifyTripPlaceCategory(place);
  const blob = placeBlob(place);

  if (
    category === "shopping_district" ||
    category === "alley" ||
    category === "creative" ||
    category === "night_market" ||
    category === "heritage" ||
    category === "local_food"
  ) {
    return true;
  }

  if (category === "popular_attraction" || category === "city_landmark") {
    return LOCAL_LIFE_POSITIVE_RE.test(blob);
  }

  if (category === "coffee" || isCafePlace(place)) return true;
  if (isNightMarketPlace(place)) return true;
  if (/老街|商圈|文創|巷|弄|傳統|生活感|散步/.test(blob)) return true;

  return false;
}

export function isLocalLifeMealCandidate(place: PlaceResult): boolean {
  if (isLocalLifeExcludedPlace(place)) return false;
  return isProperRestaurantPlace(place) || isCafePlace(place) || isNightMarketPlace(place);
}

export function isLocalLifePlanningCandidate(place: PlaceResult): boolean {
  if (isGeocodeEmptyPlace(place)) return false;
  if (isLocalLifeExcludedPlace(place)) return false;
  if (isLocalLifeDistrictCandidate(place) || isLocalLifeMealCandidate(place)) return true;

  const blob = placeBlob(place);
  const category = classifyTripPlaceCategory(place);
  if (
    category === "popular_attraction" ||
    category === "city_landmark" ||
    category === "museum" ||
    category === "heritage" ||
    category === "shopping_district" ||
    category === "creative" ||
    category === "alley" ||
    category === "local_food" ||
    category === "night_market" ||
    category === "coffee"
  ) {
    return true;
  }

  const primary = (place.primaryType ?? "").toLowerCase();
  const types = (place.types ?? []).join(" ").toLowerCase();
  const typeBlob = `${primary} ${types}`;
  if (
    /tourist_attraction|shopping_mall|market|restaurant|food|cafe|coffee_shop|bar|museum|art_gallery|park|point_of_interest/.test(
      typeBlob,
    )
  ) {
    return !isLargeMallPlace(place);
  }

  return LOCAL_LIFE_POSITIVE_RE.test(blob);
}

export type LocalLifeCandidatePools = {
  breakfastPool: PlaceResult[];
  attractionPool: PlaceResult[];
  lunchPool: PlaceResult[];
  cafePool: PlaceResult[];
  dinnerPool: PlaceResult[];
  eveningPool: PlaceResult[];
  all: PlaceResult[];
};

export function buildLocalLifeCandidatePools(places: PlaceResult[]): LocalLifeCandidatePools {
  const all: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    const id = place.id ?? place.name;
    if (!id || seen.has(id)) continue;
    if (!isLocalLifePlanningCandidate(place)) continue;
    seen.add(id);
    all.push(place);
  }

  const breakfastPool: PlaceResult[] = [];
  const attractionPool: PlaceResult[] = [];
  const lunchPool: PlaceResult[] = [];
  const cafePool: PlaceResult[] = [];
  const dinnerPool: PlaceResult[] = [];
  const eveningPool: PlaceResult[] = [];

  for (const place of all) {
    const blob = placeBlob(place);
    const category = classifyTripPlaceCategory(place);

    if (isProperRestaurantPlace(place) || isCafePlace(place)) {
      if (!isNightMarketPlace(place)) breakfastPool.push(place);
    }
    if (isProperRestaurantPlace(place) && !isNightMarketPlace(place)) {
      lunchPool.push(place);
    }
    if (isProperRestaurantPlace(place) || isNightMarketPlace(place)) {
      dinnerPool.push(place);
    }
    if (isCafePlace(place)) cafePool.push(place);
    if (/bar|night_club|bistro|pub|酒吧|居酒/i.test(blob)) eveningPool.push(place);

    const scenic =
      isLocalLifeDistrictCandidate(place) ||
      category === "shopping_district" ||
      category === "alley" ||
      category === "creative" ||
      category === "heritage" ||
      category === "popular_attraction" ||
      category === "city_landmark" ||
      category === "night_market" ||
      /tourist_attraction|shopping_mall|market|museum|art_gallery|park/.test(
        `${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase(),
      );
    if (scenic && !isProperRestaurantPlace(place) && !isCafePlace(place)) {
      attractionPool.push(place);
    }
    if (isNightMarketPlace(place) || /bar|night_club|bistro|pub|酒吧|居酒/i.test(blob)) {
      eveningPool.push(place);
    }
  }

  return {
    breakfastPool,
    attractionPool,
    lunchPool,
    cafePool,
    dinnerPool,
    eveningPool,
    all,
  };
}

export function filterPlacesForLocalLife(places: PlaceResult[]): PlaceResult[] {
  return buildLocalLifeCandidatePools(places).all;
}

export function buildLocalLifeSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const regional = AREA_SEARCH_QUERIES[label];
  if (regional) {
    const attempts: SearchAttempt[] = [];
    for (const queries of Object.values(regional)) {
      for (const query of queries) {
        attempts.push({
          query,
          mode: "text",
          includedTypes: ["tourist_attraction", "shopping_mall", "restaurant", "cafe", "market"],
        });
      }
    }
    return attempts;
  }

  return [
    { query: `${label} 老街`, mode: "text", includedTypes: ["tourist_attraction", "shopping_mall"] },
    { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "tourist_attraction"] },
    { query: `${label} 文創`, mode: "text", includedTypes: ["art_gallery", "tourist_attraction"] },
    { query: `${label} 傳統市場`, mode: "text", includedTypes: ["market"] },
    { query: `${label} 夜市`, mode: "text", includedTypes: ["restaurant", "night_club"] },
    { query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 小吃`, mode: "text", includedTypes: ["restaurant", "food"] },
  ];
}

export function buildLocalLifeAreaSearchAttempts(
  destination: string,
  areaKeys: string[],
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const regional = AREA_SEARCH_QUERIES[label];
  if (!regional) return buildLocalLifeSearchAttempts(destination);

  const attempts: SearchAttempt[] = [];
  const seen = new Set<string>();
  for (const areaKey of areaKeys) {
    const queries = regional[areaKey] ?? [];
    for (const query of queries) {
      if (seen.has(query)) continue;
      seen.add(query);
      attempts.push({
        query,
        mode: "text",
        includedTypes: ["tourist_attraction", "shopping_mall", "restaurant", "cafe", "market"],
      });
    }
  }
  return attempts;
}

export function buildLocalLifeSupplementAttempts(
  destination: string,
  pass: number,
  usedAreaKeys: string[],
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const regional = AREA_SEARCH_QUERIES[label];
  if (regional && pass >= 1) {
    const unused = Object.keys(regional).filter((k) => !usedAreaKeys.includes(k));
    if (unused.length) {
      return buildLocalLifeAreaSearchAttempts(destination, unused.slice(0, 2));
    }
  }

  return [
    { query: `${label} 老街 散步`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 在地美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 特色咖啡`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 黃昏 景點`, mode: "text", includedTypes: ["tourist_attraction", "observation_deck"] },
  ];
}

export function buildLocalLifeIncompleteDaySearchAttempts(
  destination: string,
  dayIndex: number,
  usedAreaKeys: string[],
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const regional = AREA_SEARCH_QUERIES[label];
  if (!regional) return buildLocalLifeSupplementAttempts(destination, dayIndex + 1, usedAreaKeys);

  const prefer = preferredAreaKeysForDay(destination, dayIndex);
  const unusedPrefer = prefer.filter((k) => !usedAreaKeys.includes(k));
  const allKeys = Object.keys(regional);
  const unused = allKeys.filter((k) => !usedAreaKeys.includes(k));
  const targetKeys = [...unusedPrefer, ...unused.filter((k) => !unusedPrefer.includes(k))].slice(0, 3);

  if (targetKeys.length) {
    logAiExpandAreaSearch(destination, targetKeys.join(","));
    return buildLocalLifeAreaSearchAttempts(destination, targetKeys);
  }
  return buildLocalLifeSupplementAttempts(destination, dayIndex + 1, usedAreaKeys);
}

export function logAiTripDedupStart(): void {
  logAiPipeline("[AI_TRIP_DEDUP_START]");
}

export function logAiAreaKeyAssigned(day: number, areaKey: string, name: string): void {
  logAiPipeline("[AI_AREA_KEY_ASSIGNED]", `day=${day}`, `area=${areaKey}`, `name=${name}`);
}

export function logAiDuplicatePlaceDrop(name: string, reason: string): void {
  logAiPipeline("[AI_DUPLICATE_PLACE_DROP]", `name=${name}`, `reason=${reason}`);
}

export function logAiDuplicateAreaDrop(areaKey: string, day: number): void {
  logAiPipeline("[AI_DUPLICATE_AREA_DROP]", `area=${areaKey}`, `day=${day}`);
}

export function logAiExpandAreaSearch(destination: string, areaKeys: string): void {
  logAiPipeline("[AI_EXPAND_AREA_SEARCH]", `destination=${destination}`, `areas=${areaKeys}`);
}

export function logAiDayRebuildForDuplicate(day: number, reason: string): void {
  logAiPipeline("[AI_DAY_REBUILD_FOR_DUPLICATE]", `day=${day}`, `reason=${reason}`);
}

export function logAiTripDedupPass(): void {
  logAiPipeline("[AI_TRIP_DEDUP_PASS]");
}

/** API 不可用時，以具名地點補足 local life 候選池 */
const LOCAL_LIFE_CITY_FALLBACK: Record<string, string[]> = {
  台中: [
    "審計新村",
    "草悟道",
    "宮原眼科",
    "彩虹眷村",
    "第二市場",
    "勤美誠品綠園道",
    "一中商圈",
    "繼光香穌餅",
    "逢甲夜市",
    "東海藝術街",
    "高美濕地",
    "梧棲漁港",
  ],
  台北: [
    "華山1914",
    "松山文創園區",
    "迪化街",
    "大稻埕",
    "饒河夜市",
    "寧夏夜市",
    "赤峰街",
    "永康街",
    "象山",
    "北投溫泉",
    "忠孝復興商圈",
    "信義商圈",
  ],
  台南: [
    "國華街",
    "神農街",
    "藍晒圖",
    "安平老街",
    "赤崁樓",
    "林百貨",
    "花園夜市",
    "新化老街",
    "河樂廣場",
    "奇美博物館",
    "十鼓文創園區",
    "鹽水月津港",
  ],
  高雄: [
    "駁二藝術特區",
    "哈瑪星",
    "旗津",
    "瑞豐夜市",
    "六合夜市",
    "美麗島",
    "西子灣",
    "大港橋",
    "衛武營",
    "鼓山渡輪站",
    "鹽埕埔",
    "愛河",
  ],
};

export function getLocalLifeCityFallbackNames(destination: string): string[] {
  const label = normalizeDestinationLabel(destination);
  return LOCAL_LIFE_CITY_FALLBACK[label] ?? [];
}

function inferLocalLifeFallbackType(name: string): string {
  if (/咖啡|cafe/i.test(name)) return "cafe";
  if (/夜市|小吃|市場|美食/.test(name)) return "restaurant";
  if (/文創|博物館|美術|藝術/.test(name)) return "museum";
  if (/商圈|街|新村|園區/.test(name)) return "shopping_mall";
  return "tourist_attraction";
}

export function buildLocalLifeCityFallbackPlaces(params: {
  destination: string;
  lat: number;
  lng: number;
  minCount: number;
  existingNames: Set<string>;
}): PlaceResult[] {
  const names = getLocalLifeCityFallbackNames(params.destination);
  if (!names.length) return [];

  const out: PlaceResult[] = [];
  for (let i = 0; i < names.length && out.length < params.minCount; i += 1) {
    const name = names[i]!;
    if (params.existingNames.has(name)) continue;
    params.existingNames.add(name);
    const primaryType = inferLocalLifeFallbackType(name);
    const base = buildSyntheticClassicLandmarkPlace({
      name,
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      index: i,
    });
    out.push({
      ...base,
      id: `local-life-fallback:${normalizePlaceName(name) || name}`,
      types: [primaryType],
      primaryType,
    });
  }
  return out;
}
