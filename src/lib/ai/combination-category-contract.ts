/**
 * Category contracts for combination themes.
 * Places must match allowed Google types / primaryType / name signals —
 * never assign by soft-chunk index or keyword alone.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

export type CombinationThemeKey =
  | "food"
  | "shopping"
  | "cafe"
  | "nature"
  | "culture"
  | "historic"
  | "coast"
  | "market"
  | "attraction"
  | "suburb"
  | "soft";

export type NormalizedPlaceCategory =
  | "restaurant"
  | "cafe"
  | "bakery"
  | "dessert"
  | "night_market"
  | "food_market"
  | "street_food"
  | "shopping_mall"
  | "department_store"
  | "market"
  | "shopping_street"
  | "boutique"
  | "souvenir"
  | "bookstore"
  | "lifestyle_store"
  | "park"
  | "scenic"
  | "museum"
  | "gallery"
  | "historic"
  | "temple"
  | "coast"
  | "farm"
  | "attraction"
  | "transit"
  | "generic"
  | "unknown";

export type PlaceCategoryInput = {
  name: string;
  types?: string[] | null;
  primaryType?: string | null;
  address?: string | null;
};

export type PlaceCategoryValidation = {
  valid: boolean;
  normalizedCategory: NormalizedPlaceCategory;
  matchedTypes: string[];
  rejectReason?: string;
};

type CategoryContract = {
  themeKey: CombinationThemeKey;
  defaultTitle: string;
  allowedTypes: Set<string>;
  forbiddenTypes: Set<string>;
  /** Name signals that support inclusion only when types are ambiguous. */
  allowNameHints: RegExp;
  /** Name signals that always reject (even if types are sparse). */
  forbidNameHints: RegExp;
  /** When primaryType alone is enough to accept. */
  allowedPrimaryTypes: Set<string>;
};

const FOOD_ALLOWED = new Set([
  "restaurant",
  "food",
  "cafe",
  "coffee_shop",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "night_market",
  "food_court",
  "street_food",
  "dessert_shop",
  "confectionery",
  "ice_cream_shop",
  "local_food",
  "bar",
  "pub",
  "brunch_restaurant",
  "japanese_restaurant",
  "chinese_restaurant",
  "korean_restaurant",
  "thai_restaurant",
  "vietnamese_restaurant",
  "italian_restaurant",
  "seafood_restaurant",
  "steak_house",
  "pizza_restaurant",
  "fast_food_restaurant",
  "ramen_restaurant",
  "sushi_restaurant",
  "vegetarian_restaurant",
  "vegan_restaurant",
  "sandwich_shop",
  "hamburger_restaurant",
]);

const FOOD_FORBIDDEN = new Set([
  "park",
  "national_park",
  "tourist_attraction",
  "observation_deck",
  "scenic_spot",
  "museum",
  "art_gallery",
  "farm",
  "airport",
  "train_station",
  "subway_station",
  "bus_station",
  "transit_station",
  "parking",
  "parking_lot",
  "point_of_interest",
  "natural_feature",
  "campground",
  "hiking_area",
  "zoo",
  "aquarium",
  "amusement_park",
  "stadium",
  "cemetery",
  "place_of_worship",
  "hindu_temple",
  "buddhist_temple",
  "shinto_shrine",
  "church",
  "mosque",
  "synagogue",
  "monument",
  "shopping_mall",
  "department_store",
  "historical_landmark",
  "castle",
  "palace",
]);

/** Reliable food evidence types — proximity / district membership never counts. */
const FOOD_EVIDENCE_TYPES = new Set([
  "restaurant",
  "cafe",
  "bakery",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "dessert_shop",
  "food_court",
  "bar",
  "izakaya",
  "ramen_restaurant",
  "sushi_restaurant",
  "barbecue_restaurant",
  "japanese_restaurant",
  "chinese_restaurant",
  "italian_restaurant",
  "korean_restaurant",
  "thai_restaurant",
  "vietnamese_restaurant",
  "seafood_restaurant",
  "steak_house",
  "pizza_restaurant",
  "fast_food_restaurant",
  "brunch_restaurant",
  "coffee_shop",
  "confectionery",
  "ice_cream_shop",
  "night_market",
  "street_food",
  "local_food",
]);

const FOOD_NON_FOOD_NAME_RE =
  /觀音|廟|寺|神社|教堂|公園|博物|美術|觀景|景觀|城堡|城跡|天守|車站|機場|百貨|商場|購物中心|outlet|摩天輪|通天閣|電視塔|鐵塔|temple|shrine|church|mosque|museum|park|castle|tower|station|mall/i;

const FOOD_NAME_EVIDENCE_RE =
  /餐廳|餐館|食堂|料理|小吃|美食|夜市|甜點店|烘焙|咖啡廳|拉麵|壽司|燒肉|火鍋|壽喜燒|すき焼き|とん|うどん|きしめん|ひつまぶし|鰻|居酒屋|喫茶|山ちゃん|手羽|みそかつ|味噌煮|cafe|restaurant|ramen|sushi|izakaya|bakery|dessert|(?:食堂|餐館|飯店)$/i;

const SHOPPING_ALLOWED = new Set([
  "shopping_mall",
  "department_store",
  "shopping_center",
  "shopping_district",
  "commercial_street",
  "market",
  "boutique",
  "clothing_store",
  "shoe_store",
  "souvenir_store",
  "gift_shop",
  "bookstore",
  "book_store",
  "lifestyle_store",
  "outlet_mall",
  "furniture_store",
  "home_goods_store",
  "jewelry_store",
  "electronics_store",
  "convenience_store",
  "supermarket",
  "grocery_store",
  "store",
]);

const SHOPPING_FORBIDDEN = new Set([
  "park",
  "national_park",
  "scenic_spot",
  "tourist_attraction",
  "farm",
  "airport",
  "train_station",
  "subway_station",
  "bus_station",
  "transit_station",
  "museum",
  "art_gallery",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "bar",
  "observation_deck",
  "natural_feature",
  "point_of_interest",
  "campground",
  "hiking_area",
  "zoo",
  "aquarium",
]);

const CAFE_ALLOWED = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "dessert_shop",
  "confectionery",
  "ice_cream_shop",
  "tea_house",
]);

const CAFE_FORBIDDEN = new Set([
  ...FOOD_FORBIDDEN,
  "restaurant",
  "meal_delivery",
  "shopping_mall",
  "department_store",
]);

const NATURE_ALLOWED = new Set([
  "park",
  "national_park",
  "garden",
  "zoo",
  "natural_feature",
  "campground",
  "hiking_area",
  "beach",
  "marina",
  "waterfall",
  "scenic_spot",
  "observation_deck",
]);

const NATURE_FORBIDDEN = new Set([
  "restaurant",
  "cafe",
  "shopping_mall",
  "department_store",
  "airport",
  "train_station",
  "parking",
]);

const CONTRACTS: Record<string, CategoryContract> = {
  food: {
    themeKey: "food",
    defaultTitle: "人氣美食組合",
    allowedTypes: FOOD_ALLOWED,
    forbiddenTypes: FOOD_FORBIDDEN,
    allowNameHints:
      /餐廳|小吃|美食|夜市|小吃攤|美食街|甜點|烘焙|咖啡廳|食堂|料理|拉麵|壽司|火鍋|燒烤|餐酒館|壽喜燒|すき焼き|とん|うどん|きしめん|ひつまぶし|鰻|居酒屋|喫茶|restaurant|food\s*court|night\s*market|bakery|dessert/i,
    forbidNameHints:
      /觀音|廟|寺|神社|教堂|公園|觀景|景觀平台|農場|機場|車站|停車場|博物|美術|文化館|飛場|登山|步道|濕地|城堡|城跡|天守|百貨|商場|購物中心|摩天輪|通天閣|電視塔|park|observation|viewpoint|farm|airport|museum|temple|shrine|church|castle|tower|mall/i,
    allowedPrimaryTypes: FOOD_ALLOWED,
  },
  shopping: {
    themeKey: "shopping",
    defaultTitle: "購物散策組合",
    allowedTypes: SHOPPING_ALLOWED,
    forbiddenTypes: SHOPPING_FORBIDDEN,
    allowNameHints:
      /商圈|百貨|商場|購物|Outlet|outlet|老街|市集|市場|伴手禮|選物|商店街|步行街|mall|market|shopping|boutique|souvenir/i,
    forbidNameHints:
      /公園|觀景|農場|機場|車站|博物|美術|文化館|飛場|景觀|步道|濕地|餐廳|食堂|park|farm|airport|museum|observation|viewpoint/i,
    allowedPrimaryTypes: SHOPPING_ALLOWED,
  },
  cafe: {
    themeKey: "cafe",
    defaultTitle: "咖啡散步組合",
    allowedTypes: CAFE_ALLOWED,
    forbiddenTypes: CAFE_FORBIDDEN,
    allowNameHints: /咖啡|Café|Cafe|cafe|甜點|烘焙|茶屋|茶館|coffee|bakery|dessert/i,
    forbidNameHints:
      /公園|觀景|農場|機場|車站|博物|美術|文化館|飛場|景觀|park|farm|airport|museum|observation/i,
    allowedPrimaryTypes: CAFE_ALLOWED,
  },
  nature: {
    themeKey: "nature",
    defaultTitle: "自然風景組合",
    allowedTypes: NATURE_ALLOWED,
    forbiddenTypes: NATURE_FORBIDDEN,
    allowNameHints:
      /公園|步道|濕地|湖|山|森林|草原|綠地|動物園|瀑布|觀景|beach|park|trail|garden|nature|waterfall|viewpoint|view\s*point|lookout|observation|zipline/i,
    forbidNameHints: /機場|車站|停車場|百貨|商場|airport|station|mall/i,
    allowedPrimaryTypes: NATURE_ALLOWED,
  },
  market: {
    themeKey: "market",
    defaultTitle: "商圈市集組合",
    allowedTypes: new Set([...SHOPPING_ALLOWED, "night_market", "food_court"]),
    forbiddenTypes: new Set(
      [...SHOPPING_FORBIDDEN].filter((t) => t !== "restaurant" && t !== "cafe"),
    ),
    allowNameHints:
      /夜市|市場|商圈|老街|市集|商場|百貨|mall|market|shopping/i,
    forbidNameHints:
      /公園|觀景|農場|機場|車站|博物|美術|飛場|景觀|park|farm|airport|museum|observation/i,
    allowedPrimaryTypes: new Set([...SHOPPING_ALLOWED, "night_market", "food_court"]),
  },
};

/**
 * Landmark / family exploration titles — mixed attractions.
 * Food titles (美食探索 / 在地美食 / …) use the strict food contract instead.
 */
const ATTRACTION_EXPLORATION_TITLE_RE =
  /親子娛樂|親子同遊|親子休閒|經典大阪|經典東京|經典京都|經典首爾|經典曼谷|經典名古屋|經典地標|經典景點|經典.*組合|夜景地標|家庭娛樂|family/i;

/** Titles that must always use the food combination contract. */
const FOOD_EXPLORATION_TITLE_RE =
  /美食探索|美食漫遊|美食之旅|人氣美食|在地美食|巷弄美食|街頭美食|夜市美食|美食咖啡|美食市集|美食夜生活|拉麵與在地|甜點咖啡|熟食中心|咖啡早午餐/i;

/** Secondary Google types that alone must never reject a place. */
const SECONDARY_ONLY_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "tourist_attraction",
  "premise",
  "geocode",
]);

/** Tourism types always allowed under attraction / classic / family themes. */
const ATTRACTION_ALLOWED_TYPES = new Set([
  "tourist_attraction",
  "observation_deck",
  "ferris_wheel",
  "aquarium",
  "amusement_park",
  "landmark",
  "museum",
  "art_gallery",
  "shopping_mall",
  "department_store",
  "store",
  "restaurant",
  "cafe",
  "coffee_shop",
  "park",
  "zoo",
  "hindu_temple",
  "place_of_worship",
  "church",
  "mosque",
  "synagogue",
  "historical_landmark",
  "monument",
  "castle",
  "palace",
  "stadium",
  "performing_arts_theater",
]);

/** Map display titles / soft labels → contract theme keys. */
export function resolveCombinationThemeKey(
  theme: string | null | undefined,
  title?: string | null,
): CombinationThemeKey {
  const t = `${theme ?? ""} ${title ?? ""}`.replace(/\s+/g, "");
  // Food exploration titles must use the food contract — never attraction soft-allow.
  if (FOOD_EXPLORATION_TITLE_RE.test(t) || theme === "food_exploration") {
    return "food";
  }
  // Curated landmark / family mixes before soft "美食" substring mapping.
  if (ATTRACTION_EXPLORATION_TITLE_RE.test(t)) {
    return "attraction";
  }
  if (/人氣美食|美食|餐廳|小吃|夜市美食|在地美食|美食咖啡|美食市集|美食夜生活/i.test(t)) {
    // Prefer shopping contract when title is clearly market/shopping oriented.
    if (/購物|商圈|百貨|商場|散策/.test(t) && !/美食|餐廳|小吃/.test(t)) {
      return "shopping";
    }
    if (/市集|商圈/.test(t) && /美食|夜市|小吃/.test(t)) return "food";
    if (/咖啡甜點|咖啡散步|咖啡/.test(t) && !/美食|餐廳|小吃|夜市/.test(t)) return "cafe";
    return "food";
  }
  if (/購物|百貨|商場|Outlet|散策|商店|伴手禮|老街市集散策/i.test(t)) return "shopping";
  if (/咖啡|甜點|烘焙/i.test(t)) return "cafe";
  if (/自然|風景|公園|慢遊|綠地/i.test(t)) return "nature";
  if (/商圈|市集|夜市|市場/i.test(t)) return "market";
  if (/藝文|博物|美術|文化/i.test(t)) return "culture";
  if (/舊城|古蹟|廟|寺/i.test(t)) return "historic";
  if (/海岸|漁港|海灘|夕陽/i.test(t)) return "coast";
  if (/近郊|溫泉|牧場|森林/i.test(t)) return "suburb";
  const key = (theme ?? "").trim().toLowerCase();
  if (
    key === "food" ||
    key === "shopping" ||
    key === "cafe" ||
    key === "nature" ||
    key === "market" ||
    key === "culture" ||
    key === "historic" ||
    key === "coast" ||
    key === "suburb" ||
    key === "attraction" ||
    key === "soft"
  ) {
    return key;
  }
  return "attraction";
}

function collectTypes(place: PlaceCategoryInput): string[] {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = place.primaryType?.trim().toLowerCase();
  if (primary) out.add(primary);
  return [...out];
}

/**
 * Normalize a place into a coarse category using types first, then name hints.
 * Name keywords alone never force food/shopping without supporting types
 * (except clear venue names with food/shopping primary signals below).
 */
export function normalizePlaceCategory(place: PlaceCategoryInput): NormalizedPlaceCategory {
  const types = new Set(collectTypes(place));
  const name = place.name?.trim() ?? "";
  const blob = `${name} ${place.address ?? ""}`;

  if (
    types.has("airport") ||
    types.has("train_station") ||
    types.has("subway_station") ||
    types.has("bus_station") ||
    types.has("transit_station") ||
    /機場|火車站|高鐵|捷運站|空港/.test(blob)
  ) {
    return "transit";
  }
  if (types.has("farm") || (/農場|牧場/.test(name) && !types.has("store") && !types.has("market"))) {
    return "farm";
  }
  if (types.has("park") || types.has("national_park") || types.has("garden")) {
    if (!FOOD_ALLOWED.has([...types].find((t) => FOOD_ALLOWED.has(t)) ?? "")) {
      return "park";
    }
  }
  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    (/博物|美術|文化館|故事館/.test(name) &&
      !types.has("store") &&
      !types.has("shopping_mall") &&
      !FOOD_ALLOWED.has([...types].find((t) => FOOD_ALLOWED.has(t)) ?? ""))
  ) {
    return types.has("art_gallery") ? "gallery" : "museum";
  }
  if (
    /觀景|景觀平台|observation|viewpoint|lookout/i.test(name) &&
    !FOOD_ALLOWED.has([...types].find((t) => FOOD_ALLOWED.has(t)) ?? "")
  ) {
    return "scenic";
  }

  if (types.has("cafe") || types.has("coffee_shop") || types.has("tea_house")) return "cafe";
  if (types.has("bakery") || types.has("confectionery")) return "bakery";
  if (types.has("dessert_shop") || types.has("ice_cream_shop")) return "dessert";
  // Night markets are often unresolved / typed only as tourist_attraction.
  if (types.has("night_market") || /夜市|night\s*market/i.test(name)) {
    return "night_market";
  }
  if (
    types.has("food_court") ||
    types.has("street_food") ||
    types.has("meal_takeaway") ||
    types.has("meal_delivery")
  ) {
    return "street_food";
  }
  if (
    types.has("restaurant") ||
    types.has("food") ||
    [...types].some((t) => t.endsWith("_restaurant") || t === "brunch_restaurant")
  ) {
    return "restaurant";
  }
  if (
    types.has("market") &&
    (/美食|小吃|熟食|food|夜市/.test(blob) || types.has("food") || types.has("restaurant"))
  ) {
    return "food_market";
  }

  if (types.has("shopping_mall") || types.has("shopping_center")) return "shopping_mall";
  if (types.has("department_store") || types.has("outlet_mall")) return "department_store";
  if (
    types.has("clothing_store") ||
    types.has("boutique") ||
    types.has("shoe_store") ||
    types.has("jewelry_store")
  ) {
    return "boutique";
  }
  if (types.has("souvenir_store") || types.has("gift_shop")) return "souvenir";
  if (types.has("bookstore") || types.has("book_store")) return "bookstore";
  if (
    types.has("furniture_store") ||
    types.has("home_goods_store") ||
    types.has("lifestyle_store") ||
    types.has("electronics_store")
  ) {
    return "lifestyle_store";
  }
  if (
    types.has("market") ||
    types.has("supermarket") ||
    types.has("grocery_store") ||
    types.has("store")
  ) {
    return "market";
  }
  if (
    /商圈|商店街|步行街|老街|購物街|shopping\s*(street|district)|commercial/i.test(blob)
  ) {
    // Only when not clearly a park/museum/farm.
    if (!types.has("park") && !types.has("museum") && !types.has("farm")) {
      return "shopping_street";
    }
  }
  // Unresolved name-only shopping venues (light profile / pre-Places).
  if (
    types.size === 0 &&
    /百貨|商場|購物中心|Outlet|伴手禮店/.test(name) &&
    !/公園|農場|機場|博物|美術/.test(name)
  ) {
    return /百貨|商場|購物中心|Outlet/.test(name) ? "shopping_mall" : "souvenir";
  }

  if (types.has("beach") || types.has("marina") || /海岸|海灘|漁港/.test(name)) return "coast";
  if (
    types.has("place_of_worship") ||
    types.has("church") ||
    types.has("hindu_temple") ||
    types.has("buddhist_temple") ||
    types.has("shinto_shrine") ||
    /廟|寺|神社|教堂|觀音/.test(name)
  ) {
    return "temple";
  }
  if (types.has("historical_landmark") || types.has("cultural_landmark") || /古蹟|城門/.test(name)) {
    return "historic";
  }
  if (types.has("tourist_attraction") || types.has("landmark")) return "attraction";
  if (types.has("point_of_interest") || types.has("establishment")) return "generic";
  return "unknown";
}

function hasFoodSupportingType(types: Set<string>): boolean {
  return [...types].some((t) => FOOD_ALLOWED.has(t));
}

/**
 * True only when the place itself has reliable dining evidence.
 * Nearby restaurants / being inside a food district never counts.
 */
export function hasFoodEvidence(place: PlaceCategoryInput): boolean {
  const types = new Set(collectTypes(place));
  const name = place.name?.trim() ?? "";
  const primary = (place.primaryType ?? "").trim().toLowerCase();

  if (FOOD_NON_FOOD_NAME_RE.test(name) && ![...types].some((t) => FOOD_EVIDENCE_TYPES.has(t))) {
    return false;
  }

  if (primary && FOOD_EVIDENCE_TYPES.has(primary)) return true;
  if ([...types].some((t) => FOOD_EVIDENCE_TYPES.has(t))) return true;

  // Untyped curated seeds: require explicit food name evidence, never temples/landmarks.
  if (types.size === 0 && FOOD_NAME_EVIDENCE_RE.test(name) && !FOOD_NON_FOOD_NAME_RE.test(name)) {
    return true;
  }

  // Night markets often typed only as tourist_attraction
  if (
    (/夜市|night\s*market/i.test(name) || types.has("night_market")) &&
    !types.has("park") &&
    !types.has("place_of_worship")
  ) {
    return true;
  }

  return false;
}

export type FoodCombinationContract = {
  combinationType: "food_exploration";
  allowedPrimaryKinds: readonly string[];
  forbiddenPrimaryKinds: readonly string[];
};

export const FOOD_COMBINATION_CONTRACT: FoodCombinationContract = {
  combinationType: "food_exploration",
  allowedPrimaryKinds: [
    "restaurant",
    "food",
    "meal_takeaway",
    "meal_delivery",
    "cafe",
    "bakery",
    "dessert_shop",
    "food_court",
    "market_food",
    "night_market_food",
  ],
  forbiddenPrimaryKinds: [
    "tourist_attraction",
    "place_of_worship",
    "hindu_temple",
    "buddhist_temple",
    "shinto_shrine",
    "church",
    "mosque",
    "park",
    "museum",
    "observation_deck",
    "monument",
    "shopping_mall",
    "train_station",
  ],
};

export function logCombinationContractStart(params: {
  combinationId: string | number;
  combinationType: string;
  requiredKinds?: string[];
}): void {
  logAiPipeline(
    "[COMBINATION_CONTRACT_START]",
    `combinationId=${params.combinationId}`,
    `combinationType=${params.combinationType}`,
    `requiredKinds=${(params.requiredKinds ?? FOOD_COMBINATION_CONTRACT.allowedPrimaryKinds).join(",")}`,
  );
}

export function logCombinationFoodEvidence(params: {
  name: string;
  primaryType?: string | null;
  hasFoodEvidence: boolean;
  accepted: boolean;
}): void {
  logAiPipeline(
    "[COMBINATION_FOOD_EVIDENCE]",
    `name=${params.name}`,
    `primaryType=${params.primaryType ?? ""}`,
    `hasFoodEvidence=${params.hasFoodEvidence}`,
    `accepted=${params.accepted}`,
  );
}

export function logCombinationCandidateRejected(params: {
  combinationId: string | number;
  combinationType: string;
  name: string;
  reason: string;
}): void {
  logAiPipeline(
    "[COMBINATION_CANDIDATE_REJECTED]",
    `combinationId=${params.combinationId}`,
    `combinationType=${params.combinationType}`,
    `name=${params.name}`,
    `reason=${params.reason}`,
  );
}

export function logCombinationContractResult(params: {
  combinationId: string | number;
  combinationType: string;
  candidateCount: number;
  validFoodCount: number;
  contractPassed: boolean;
}): void {
  logAiPipeline(
    "[COMBINATION_CONTRACT_RESULT]",
    `combinationId=${params.combinationId}`,
    `combinationType=${params.combinationType}`,
    `candidateCount=${params.candidateCount}`,
    `validFoodCount=${params.validFoodCount}`,
    `contractPassed=${params.contractPassed}`,
  );
}

export function logCombinationFoodGap(params: {
  required: number;
  available: number;
  missing: number;
}): void {
  logAiPipeline(
    "[COMBINATION_FOOD_GAP]",
    `required=${params.required}`,
    `available=${params.available}`,
    `missing=${params.missing}`,
  );
}

/**
 * Combination-level food contract: every displayed place must have food evidence.
 * Never pad with temples / attractions / malls / stations.
 */
export function validateFoodCombinationPlaces(
  places: PlaceCategoryInput[],
  opts?: { combinationId?: string | number; requiredCount?: number },
): { passed: boolean; validFoodCount: number; rejected: PlaceCategoryInput[] } {
  const combinationId = opts?.combinationId ?? "food";
  const required = opts?.requiredCount ?? places.length;
  logCombinationContractStart({
    combinationId,
    combinationType: "food_exploration",
  });

  const rejected: PlaceCategoryInput[] = [];
  let validFoodCount = 0;
  for (const place of places) {
    const evidence = hasFoodEvidence(place);
    const categoryOk = validatePlaceForCombination(place, "food", {
      title: "美食探索組合",
      combinationId,
    });
    const accepted = evidence && categoryOk.valid;
    logCombinationFoodEvidence({
      name: place.name,
      primaryType: place.primaryType,
      hasFoodEvidence: evidence,
      accepted,
    });
    if (accepted) {
      validFoodCount += 1;
    } else {
      rejected.push(place);
      logCombinationCandidateRejected({
        combinationId,
        combinationType: "food_exploration",
        name: place.name,
        reason: evidence ? (categoryOk.rejectReason ?? "food_contract_mismatch") : "food_contract_mismatch",
      });
    }
  }

  const passed =
    validFoodCount === places.length &&
    validFoodCount >= Math.min(required, places.length) &&
    places.length > 0;
  if (validFoodCount < required) {
    logCombinationFoodGap({
      required,
      available: validFoodCount,
      missing: Math.max(0, required - validFoodCount),
    });
  }
  logCombinationContractResult({
    combinationId,
    combinationType: "food_exploration",
    candidateCount: places.length,
    validFoodCount,
    contractPassed: passed,
  });
  return { passed, validFoodCount, rejected };
}

function hasShoppingSupportingType(types: Set<string>): boolean {
  return [...types].some((t) => SHOPPING_ALLOWED.has(t));
}

function isFoodOrientedMarket(place: PlaceCategoryInput, types: Set<string>): boolean {
  if (!types.has("market")) return false;
  const blob = `${place.name} ${place.address ?? ""}`;
  if (/夜市|小吃|美食|熟食|food\s*market|wet\s*market.*food/i.test(blob)) return true;
  if (types.has("food") || types.has("restaurant") || types.has("food_court") || types.has("night_market")) {
    return true;
  }
  return false;
}

function isShoppingOrientedMarket(place: PlaceCategoryInput, types: Set<string>): boolean {
  if (!types.has("market") && !types.has("shopping_mall") && !types.has("department_store")) {
    // Allow shopping-street style names only with store-like types or clear district types.
    const blob = `${place.name} ${place.address ?? ""}`;
    if (
      /商圈|商店街|步行街|老街|購物街|shopping/i.test(blob) &&
      (types.has("store") ||
        types.has("point_of_interest") ||
        types.has("tourist_attraction") ||
        types.size === 0)
    ) {
      // tourist_attraction alone is NOT enough for shopping — require store/name district.
      if (types.has("tourist_attraction") && !types.has("store") && !/商圈|商店街|步行街|老街|購物/.test(blob)) {
        return false;
      }
      if (/商圈|商店街|步行街|老街|購物街/.test(blob)) return true;
    }
    return false;
  }
  if (types.has("shopping_mall") || types.has("department_store") || types.has("store")) return true;
  if (types.has("market")) {
    const blob = `${place.name} ${place.address ?? ""}`;
    // Food-only markets belong in food, not shopping — still OK for market theme.
    if (isFoodOrientedMarket(place, types) && !/商圈|百貨|購物|伴手禮/.test(blob)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Validate that a resolved place fits a combination theme's category contract.
 */
export function validatePlaceForCombination(
  place: PlaceCategoryInput,
  combinationTheme: string,
  opts?: { title?: string | null; combinationId?: string | number },
): PlaceCategoryValidation {
  const themeKey = resolveCombinationThemeKey(combinationTheme, opts?.title);
  const normalizedCategory = normalizePlaceCategory(place);
  const types = collectTypes(place);
  const typeSet = new Set(types);
  const name = place.name?.trim() ?? "";
  const matchedTypes: string[] = [];

  const contract = CONTRACTS[themeKey];
  // Themes without a strict contract (attraction/culture/…) — soft allow, still block transit noise.
  if (!contract) {
    if (normalizedCategory === "transit") {
      return {
        valid: false,
        normalizedCategory,
        matchedTypes: types,
        rejectReason: "type_mismatch:transit",
      };
    }
    // Classic / family / exploration: explicitly allow common tourism types.
    const primary = (place.primaryType ?? "").trim().toLowerCase();
    if (
      (primary && ATTRACTION_ALLOWED_TYPES.has(primary)) ||
      [...typeSet].some((x) => ATTRACTION_ALLOWED_TYPES.has(x))
    ) {
      const result: PlaceCategoryValidation = {
        valid: true,
        normalizedCategory,
        matchedTypes: types,
      };
      logCategoryValidation(opts?.combinationId, themeKey, place, result);
      return result;
    }
    return { valid: true, normalizedCategory, matchedTypes: types };
  }

  if (contract.forbidNameHints.test(name)) {
    // Hard name forbid unless types clearly override (e.g. "公園路咖啡廳").
    const override =
      (themeKey === "food" && hasFoodSupportingType(typeSet)) ||
      (themeKey === "cafe" && [...typeSet].some((t) => CAFE_ALLOWED.has(t))) ||
      (themeKey === "shopping" && hasShoppingSupportingType(typeSet));
    if (!override) {
      const result: PlaceCategoryValidation = {
        valid: false,
        normalizedCategory,
        matchedTypes: types,
        rejectReason: "type_mismatch:forbidden_name",
      };
      logCategoryValidation(opts?.combinationId, themeKey, place, result);
      return result;
    }
  }

  // Night markets / shopping streets are often typed only as tourist_attraction.
  const nightMarketException =
    themeKey === "food" &&
    (/夜市|night\s*market/i.test(name) || typeSet.has("night_market")) &&
    !typeSet.has("park") &&
    !typeSet.has("farm") &&
    !typeSet.has("airport");
  const shoppingStreetException =
    themeKey === "shopping" &&
    /商圈|商店街|步行街|老街|購物街|shopping\s*(street|district)|outlet/i.test(name) &&
    !typeSet.has("park") &&
    !typeSet.has("farm") &&
    !typeSet.has("airport") &&
    !typeSet.has("museum") &&
    !typeSet.has("restaurant");

  for (const t of types) {
    // Secondary Google types alone never reject (point_of_interest / tourist_attraction / establishment).
    if (SECONDARY_ONLY_TYPES.has(t)) continue;
    if (contract.forbiddenTypes.has(t)) {
      // Allow when a stronger allowed type is also present, or known exceptions.
      const hasAllowed = [...typeSet].some((x) => contract.allowedTypes.has(x));
      if (!hasAllowed && !nightMarketException && !shoppingStreetException) {
        const result: PlaceCategoryValidation = {
          valid: false,
          normalizedCategory,
          matchedTypes: types,
          rejectReason: `type_mismatch:forbidden_type:${t}`,
        };
        logCategoryValidation(opts?.combinationId, themeKey, place, result);
        return result;
      }
    }
  }

  // Generic POI alone is never enough for food/shopping/cafe.
  // Allow strong named categories (night market / shopping street) before Places types resolve.
  const namedCategoryOk =
    (themeKey === "food" &&
      (normalizedCategory === "night_market" ||
        normalizedCategory === "food_market" ||
        normalizedCategory === "restaurant" ||
        normalizedCategory === "cafe" ||
        normalizedCategory === "street_food" ||
        normalizedCategory === "bakery" ||
        normalizedCategory === "dessert" ||
        hasFoodEvidence(place))) ||
    (themeKey === "shopping" &&
      (normalizedCategory === "shopping_street" ||
        normalizedCategory === "shopping_mall" ||
        normalizedCategory === "department_store" ||
        normalizedCategory === "market" ||
        normalizedCategory === "souvenir" ||
        normalizedCategory === "boutique")) ||
    (themeKey === "cafe" &&
      (normalizedCategory === "cafe" ||
        normalizedCategory === "bakery" ||
        normalizedCategory === "dessert"));

  if (
    (themeKey === "food" || themeKey === "shopping" || themeKey === "cafe") &&
    !namedCategoryOk &&
    (normalizedCategory === "generic" ||
      normalizedCategory === "unknown" ||
      normalizedCategory === "attraction" ||
      normalizedCategory === "park" ||
      normalizedCategory === "scenic" ||
      normalizedCategory === "farm" ||
      normalizedCategory === "museum" ||
      normalizedCategory === "gallery" ||
      normalizedCategory === "temple" ||
      normalizedCategory === "historic" ||
      normalizedCategory === "transit")
  ) {
    const result: PlaceCategoryValidation = {
      valid: false,
      normalizedCategory,
      matchedTypes: types,
      rejectReason: `type_mismatch:category:${normalizedCategory}`,
    };
    logCategoryValidation(opts?.combinationId, themeKey, place, result);
    return result;
  }

  let accepted = false;

  if (themeKey === "food") {
    const evidence = hasFoodEvidence(place);
    logCombinationFoodEvidence({
      name,
      primaryType: place.primaryType,
      hasFoodEvidence: evidence,
      accepted: false, // updated below when accepted
    });
    if (!evidence) {
      const result: PlaceCategoryValidation = {
        valid: false,
        normalizedCategory,
        matchedTypes: types,
        rejectReason: "food_contract_mismatch",
      };
      logCategoryValidation(opts?.combinationId, themeKey, place, result);
      logCombinationCandidateRejected({
        combinationId: opts?.combinationId ?? "",
        combinationType: "food_exploration",
        name,
        reason: "food_contract_mismatch",
      });
      return result;
    }
    if (hasFoodSupportingType(typeSet)) {
      accepted = true;
      matchedTypes.push(...types.filter((t) => FOOD_ALLOWED.has(t)));
    } else if (
      isFoodOrientedMarket(place, typeSet) ||
      nightMarketException ||
      normalizedCategory === "night_market"
    ) {
      accepted = true;
      matchedTypes.push(
        nightMarketException || normalizedCategory === "night_market"
          ? "night_market"
          : "market",
      );
    } else if (
      types.length === 0 &&
      FOOD_NAME_EVIDENCE_RE.test(name) &&
      !FOOD_NON_FOOD_NAME_RE.test(name)
    ) {
      accepted = true;
      matchedTypes.push("name_hint:food");
    }
    if (accepted) {
      logCombinationFoodEvidence({
        name,
        primaryType: place.primaryType,
        hasFoodEvidence: true,
        accepted: true,
      });
    }
  } else if (themeKey === "shopping") {
    const shoppingPrimary =
      typeSet.has("shopping_mall") ||
      typeSet.has("department_store") ||
      typeSet.has("outlet_mall") ||
      typeSet.has("clothing_store") ||
      typeSet.has("boutique") ||
      typeSet.has("souvenir_store") ||
      typeSet.has("gift_shop") ||
      typeSet.has("bookstore") ||
      typeSet.has("book_store") ||
      typeSet.has("lifestyle_store") ||
      typeSet.has("furniture_store") ||
      typeSet.has("home_goods_store") ||
      typeSet.has("electronics_store") ||
      typeSet.has("supermarket") ||
      typeSet.has("grocery_store");
    if (shoppingPrimary) {
      accepted = true;
      matchedTypes.push(...types.filter((t) => SHOPPING_ALLOWED.has(t)));
    } else if (isShoppingOrientedMarket(place, typeSet) || shoppingStreetException) {
      accepted = true;
      matchedTypes.push(shoppingStreetException ? "shopping_street" : "market_or_street");
    } else if (typeSet.has("store") && !typeSet.has("restaurant") && !typeSet.has("cafe")) {
      accepted = true;
      matchedTypes.push("store");
    } else if (
      types.length === 0 &&
      /商圈|百貨|商場|購物中心|Outlet|伴手禮店|商店街|步行街/.test(name) &&
      !contract.forbidNameHints.test(name)
    ) {
      accepted = true;
      matchedTypes.push("name_hint:shopping");
    }
  } else if (themeKey === "cafe") {
    if ([...typeSet].some((t) => CAFE_ALLOWED.has(t))) {
      accepted = true;
      matchedTypes.push(...types.filter((t) => CAFE_ALLOWED.has(t)));
    } else if (
      types.length === 0 &&
      /咖啡|Café|Cafe|甜點店|烘焙坊/.test(name) &&
      !contract.forbidNameHints.test(name)
    ) {
      accepted = true;
      matchedTypes.push("name_hint:cafe");
    }
  } else if (themeKey === "nature") {
    if ([...typeSet].some((t) => NATURE_ALLOWED.has(t)) || contract.allowNameHints.test(name)) {
      accepted = ![...typeSet].some((t) => NATURE_FORBIDDEN.has(t) && !NATURE_ALLOWED.has(t));
      if (accepted) matchedTypes.push(...types.filter((t) => NATURE_ALLOWED.has(t)));
    }
  } else if (themeKey === "market") {
    if (
      hasShoppingSupportingType(typeSet) ||
      isFoodOrientedMarket(place, typeSet) ||
      typeSet.has("night_market") ||
      (/夜市|市場|商圈|老街|市集/.test(name) &&
        !typeSet.has("park") &&
        !typeSet.has("farm") &&
        !typeSet.has("airport"))
    ) {
      accepted = true;
      matchedTypes.push(...types.filter((t) => contract.allowedTypes.has(t)));
    }
  }

  const result: PlaceCategoryValidation = accepted
    ? { valid: true, normalizedCategory, matchedTypes: matchedTypes.length ? matchedTypes : types }
    : {
        valid: false,
        normalizedCategory,
        matchedTypes: types,
        rejectReason: "type_mismatch",
      };

  logCategoryValidation(opts?.combinationId, themeKey, place, result);
  if (!result.valid) {
    logAiPipeline(
      "[COMBINATION_PLACE_CATEGORY_REJECTED]",
      `combinationId=${opts?.combinationId ?? ""}`,
      `placeName=${name}`,
      `theme=${themeKey}`,
      `reason=${result.rejectReason ?? "type_mismatch"}`,
    );
  }
  return result;
}

function logCategoryValidation(
  combinationId: string | number | undefined,
  theme: string,
  place: PlaceCategoryInput,
  result: PlaceCategoryValidation,
): void {
  logAiPipeline(
    "[COMBINATION_CATEGORY_VALIDATION]",
    `combinationId=${combinationId ?? ""}`,
    `theme=${theme}`,
    `placeName=${place.name}`,
    `primaryType=${place.primaryType ?? ""}`,
    `types=${(place.types ?? []).join("|")}`,
    `valid=${result.valid}`,
    `reason=${result.rejectReason ?? (result.valid ? "ok" : "type_mismatch")}`,
  );
}

export function logCombinationCategoryCounts(params: {
  combinationId: string | number;
  theme: string;
  candidateCount: number;
  validCount: number;
  rejectedCount: number;
}): void {
  logAiPipeline(
    "[COMBINATION_CATEGORY_COUNTS]",
    `combinationId=${params.combinationId}`,
    `theme=${params.theme}`,
    `candidateCount=${params.candidateCount}`,
    `validCount=${params.validCount}`,
    `rejectedCount=${params.rejectedCount}`,
  );
}

/** Dynamically adjust combination title to match resolved place categories. */
export function adjustCombinationTitle(
  baseTitle: string,
  themeKey: string,
  categories: NormalizedPlaceCategory[],
): string {
  if (!categories.length) return baseTitle;
  const counts = new Map<string, number>();
  for (const c of categories) counts.set(c, (counts.get(c) ?? 0) + 1);

  const resolvedKey = resolveCombinationThemeKey(themeKey, baseTitle);
  let newTitle = baseTitle;

  if (resolvedKey === "food" || /美食|餐廳|小吃/.test(baseTitle)) {
    const cafeLike =
      (counts.get("cafe") ?? 0) + (counts.get("bakery") ?? 0) + (counts.get("dessert") ?? 0);
    const restaurantLike =
      (counts.get("restaurant") ?? 0) +
      (counts.get("street_food") ?? 0) +
      (counts.get("night_market") ?? 0) +
      (counts.get("food_market") ?? 0);
    if (cafeLike >= 2 && cafeLike > restaurantLike) {
      newTitle = "咖啡甜點組合";
    } else if ((counts.get("night_market") ?? 0) >= 2) {
      newTitle = "夜市小吃組合";
    } else {
      newTitle = baseTitle.includes("組合") ? baseTitle : "人氣美食組合";
      if (!/美食|餐廳|小吃|夜市|咖啡/.test(newTitle)) newTitle = "人氣美食組合";
    }
  } else if (resolvedKey === "shopping" || /購物|商圈|百貨/.test(baseTitle)) {
    const streetLike =
      (counts.get("shopping_street") ?? 0) +
      (counts.get("market") ?? 0) +
      (counts.get("souvenir") ?? 0) +
      (counts.get("boutique") ?? 0);
    const mallLike =
      (counts.get("shopping_mall") ?? 0) + (counts.get("department_store") ?? 0);
    if (streetLike >= 2 && streetLike >= mallLike) {
      newTitle = "老街市集散策組合";
    } else if (mallLike >= 2) {
      newTitle = "百貨商場組合";
    } else if (!/購物|商圈|百貨|市集|老街/.test(baseTitle)) {
      newTitle = "購物散策組合";
    }
  } else if (resolvedKey === "cafe" || /咖啡/.test(baseTitle)) {
    newTitle = "咖啡散步組合";
  } else if (resolvedKey === "nature") {
    // Keep curated titles like 城市慢遊組合; only normalize soft/generic nature labels.
    if (/自然風景|公園綠地/.test(baseTitle) || baseTitle === "自然風景組合") {
      newTitle = "自然風景組合";
    }
  }

  if (newTitle !== baseTitle) {
    logAiPipeline(
      "[COMBINATION_TITLE_ADJUSTED]",
      `oldTitle=${baseTitle}`,
      `newTitle=${newTitle}`,
      `resolvedCategories=${categories.join("|")}`,
    );
  }
  return newTitle;
}

/** Soft-mode theme slots with dedicated category contracts. */
export const SOFT_THEME_SLOTS: Array<{
  themeKey: CombinationThemeKey;
  defaultTitle: string;
}> = [
  { themeKey: "nature", defaultTitle: "自然風景組合" },
  { themeKey: "cafe", defaultTitle: "咖啡散步組合" },
  { themeKey: "food", defaultTitle: "人氣美食組合" },
  { themeKey: "shopping", defaultTitle: "購物散策組合" },
];

/** Minimum places for strict-typed combos (food/shopping/cafe) — may show with 2. */
export const MIN_TYPED_COMBO_PLACES = 2;

/** Themes that require category-contract validation. */
export function themeRequiresCategoryContract(themeKey: string, title?: string): boolean {
  const key = resolveCombinationThemeKey(themeKey, title);
  return key === "food" || key === "shopping" || key === "cafe" || key === "market" || key === "nature";
}

/** Search queries for typed combination refill (destination-agnostic). */
export function categoryThemeSearchQueries(themeKey: string, destination: string): string[] {
  const d = destination.trim();
  const key = resolveCombinationThemeKey(themeKey);
  switch (key) {
    case "food":
      return [
        `${d} restaurant`,
        `${d} local food`,
        `${d} famous restaurant`,
        `${d} ramen`,
        `${d} sushi`,
        `${d} grilled meat`,
        `${d} cafe`,
        `${d} dessert`,
        `${d} food street restaurant`,
        `${d} local specialty restaurant`,
        `${d} 人氣餐廳`,
        `${d} 在地小吃`,
        `${d} 必吃美食`,
        `${d} 夜市`,
      ];
    case "shopping":
      return [
        `${d} 商圈`,
        `${d} 百貨`,
        `${d} 購物中心`,
        `${d} 老街`,
        `${d} 市場`,
        `${d} 伴手禮`,
        `${d} shopping mall`,
        `${d} shopping street`,
        `${d} market`,
        `${d} department store`,
      ];
    case "cafe":
      return [`${d} 咖啡廳`, `${d} cafe`, `${d} coffee`, `${d} 甜點`, `${d} bakery`];
    case "nature":
      return [`${d} 公園`, `${d} 自然風景`, `${d} park`, `${d} garden`, `${d} trail`];
    case "market":
      return [`${d} 夜市`, `${d} 市場`, `${d} 商圈`, `${d} market`, `${d} night market`];
    default:
      return [`${d} tourist attractions`, `${d} 景點`];
  }
}

export function includedTypesForTheme(themeKey: string): string[] {
  const key = resolveCombinationThemeKey(themeKey);
  switch (key) {
    case "food":
      return ["restaurant", "food", "cafe", "bakery", "meal_takeaway"];
    case "shopping":
      return ["shopping_mall", "department_store", "market", "clothing_store", "store"];
    case "cafe":
      return ["cafe", "coffee_shop", "bakery"];
    case "nature":
      return ["park", "natural_feature", "zoo"];
    case "market":
      return ["market", "shopping_mall", "department_store"];
    default:
      return ["tourist_attraction", "museum", "park"];
  }
}

/**
 * Pick the best soft theme slot for a place (most specific contract match).
 * Returns null when the place matches none of the soft slots.
 */
export function assignSoftThemeSlot(
  place: PlaceCategoryInput,
): CombinationThemeKey | null {
  const order: CombinationThemeKey[] = ["cafe", "food", "shopping", "nature"];
  for (const theme of order) {
    const result = validatePlaceForCombination(place, theme);
    if (result.valid) return theme;
  }
  return null;
}

export function getCategoryContract(themeKey: string): CategoryContract | null {
  return CONTRACTS[resolveCombinationThemeKey(themeKey)] ?? null;
}
