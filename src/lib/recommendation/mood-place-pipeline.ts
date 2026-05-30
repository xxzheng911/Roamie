import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { resolvePlaceIdentity, collectPlaceTypes, type PlaceIdentityInput } from "@/lib/place-identity";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";

/** 推薦條件 tag（對應 Google Places 類型／名稱特徵） */
export type MoodPlaceTag =
  | "cafe"
  | "coffee_shop"
  | "bakery"
  | "dessert"
  | "bookstore"
  | "museum"
  | "art_gallery"
  | "shopping_mall"
  | "department_store"
  | "indoor"
  | "spa"
  | "massage"
  | "restaurant"
  | "park"
  | "riverside"
  | "scenic"
  | "waterfront"
  | "coastal"
  | "night_view"
  | "quiet"
  | "outdoor_walk"
  | "night_market"
  | "bar";

export type MoodRecommendationIntent = {
  mood: string;
  detectedIntent: string;
  selectedTags: MoodPlaceTag[];
  bannedTags: MoodPlaceTag[];
  searchQueries: string[];
  preferIndoor: boolean;
  summaryTone: "rainy_indoor" | "relax_scenic" | "coffee" | "solo_quiet" | "tired_rest" | "walk" | "late_night" | "supper" | "sea" | "generic";
};

export type MoodPlaceValidation = {
  valid: boolean;
  score: number;
  rankingReason: string;
  placeTypes: string[];
  matchedTags: MoodPlaceTag[];
  bannedHits: MoodPlaceTag[];
};

export type RankedMoodPlace = {
  place: PlaceResult;
  validation: MoodPlaceValidation;
};

export type MoodPipelineMeta = {
  mood: string;
  detected_intent: string;
  selected_tags: MoodPlaceTag[];
  banned_tags: MoodPlaceTag[];
  search_queries: string[];
  validation_passed: number;
  validation_rejected: number;
  ranking_reasons: string[];
};

/** 最近一次 pipeline 結果（供 diagnostics 匯出） */
let lastPipelineMeta: MoodPipelineMeta | null = null;

export function peekLastMoodPipelineMeta(): MoodPipelineMeta | null {
  return lastPipelineMeta;
}

type MoodProfile = {
  detectedIntent: string;
  selectedTags: MoodPlaceTag[];
  bannedTags: MoodPlaceTag[];
  searchQueries: string[];
  preferIndoor: boolean;
  summaryTone: MoodRecommendationIntent["summaryTone"];
  /** 名稱命中即 ban（即使 Google type 不明確） */
  bannedNamePatterns: RegExp[];
  /** 名稱命中加分 */
  preferredNamePatterns: RegExp[];
};

const MOOD_PROFILES: Record<string, MoodProfile> = {
  下雨天: {
    detectedIntent: "rainy_day_indoor",
    selectedTags: [
      "cafe",
      "coffee_shop",
      "bookstore",
      "museum",
      "art_gallery",
      "shopping_mall",
      "department_store",
      "dessert",
      "bakery",
      "indoor",
    ],
    bannedTags: ["park", "riverside", "scenic", "waterfront", "outdoor_walk", "coastal"],
    searchQueries: [
      "indoor cafe",
      "bookstore",
      "museum",
      "art gallery",
      "shopping mall",
      "dessert bakery",
      "department store",
    ],
    preferIndoor: true,
    summaryTone: "rainy_indoor",
    bannedNamePatterns: [/公園|河|步道|水岸|親水|廣場|堤|湿地|綠道|LOVE RIVER|愛河/i],
    preferredNamePatterns: [/咖啡|書店|書局|博物|美術|百貨|商場|mall|室内|室内|甜點|蛋糕/i],
  },
  想放空: {
    detectedIntent: "relax_scenic",
    selectedTags: ["riverside", "waterfront", "coastal", "park", "scenic", "cafe", "quiet"],
    bannedTags: ["shopping_mall", "department_store", "night_market", "bar"],
    searchQueries: [
      "scenic riverside walk",
      "quiet park lake",
      "waterfront cafe",
      "coastal scenic view",
      "temple garden",
    ],
    preferIndoor: false,
    summaryTone: "relax_scenic",
    bannedNamePatterns: [/百貨|商場|夜市|KTV|karaoke/i],
    preferredNamePatterns: [/河|湖|海|公園|步道|景觀|咖啡|view|park/i],
  },
  找咖啡: {
    detectedIntent: "find_coffee",
    selectedTags: ["cafe", "coffee_shop", "bakery", "dessert"],
    bannedTags: ["park", "museum", "art_gallery", "shopping_mall", "department_store", "riverside"],
    searchQueries: ["cafe", "coffee shop", "specialty coffee", "bakery cafe", "dessert cafe"],
    preferIndoor: false,
    summaryTone: "coffee",
    bannedNamePatterns: [/公園|博物|美術|百貨|商場|河|步道|廣場/i],
    preferredNamePatterns: [/咖啡|cafe|coffee|甜點|烘焙|bakery|roaster/i],
  },
  一個人: {
    detectedIntent: "solo_quiet",
    selectedTags: ["cafe", "bookstore", "museum", "art_gallery", "quiet", "riverside"],
    bannedTags: ["night_market", "bar", "shopping_mall"],
    searchQueries: [
      "quiet cafe solo",
      "bookstore cafe",
      "small art museum",
      "riverside walk quiet",
    ],
    preferIndoor: false,
    summaryTone: "solo_quiet",
    bannedNamePatterns: [/夜市|KTV|karaoke|酒吧|bar|club/i],
    preferredNamePatterns: [/咖啡|書|博物|美術|河|quiet|独立/i],
  },
  今天有點累: {
    detectedIntent: "tired_rest",
    selectedTags: ["cafe", "spa", "massage", "restaurant", "riverside", "quiet"],
    bannedTags: ["park", "scenic", "museum"],
    searchQueries: [
      "cafe relax",
      "spa massage",
      "quiet restaurant",
      "scenic cafe view",
    ],
    preferIndoor: false,
    summaryTone: "tired_rest",
    bannedNamePatterns: [/登山|爬山|運動|體育|gym|健行|trail|hiking/i],
    preferredNamePatterns: [/咖啡|spa|按摩|rest|放鬆|景觀|河/i],
  },
  想散步: {
    detectedIntent: "casual_walk",
    selectedTags: ["park", "riverside", "scenic", "outdoor_walk", "waterfront"],
    bannedTags: ["shopping_mall", "museum"],
    searchQueries: ["park walk trail", "riverside pedestrian", "scenic walk path"],
    preferIndoor: false,
    summaryTone: "walk",
    bannedNamePatterns: [/百貨|商場|museum/i],
    preferredNamePatterns: [/公園|步道|河|滨|walk|trail/i],
  },
  深夜散步: {
    detectedIntent: "late_night_walk",
    selectedTags: ["night_view", "riverside", "scenic", "cafe", "outdoor_walk"],
    bannedTags: ["museum", "shopping_mall"],
    searchQueries: ["night view park", "late night cafe", "night scenic walk"],
    preferIndoor: false,
    summaryTone: "late_night",
    bannedNamePatterns: [/百貨|商場|博物/i],
    preferredNamePatterns: [/夜景|night|河|view|咖啡|park/i],
  },
  宵夜: {
    detectedIntent: "late_night_food",
    selectedTags: ["night_market", "restaurant", "bar"],
    bannedTags: ["park", "museum", "scenic"],
    searchQueries: ["late night food", "night market", "supper restaurant", "24 hour restaurant"],
    preferIndoor: false,
    summaryTone: "supper",
    bannedNamePatterns: [/公園|博物|步道/i],
    preferredNamePatterns: [/宵夜|夜市|小吃|滷味|燒烤|restaurant|food/i],
  },
  看海: {
    detectedIntent: "coastal_scenic",
    selectedTags: ["coastal", "waterfront", "scenic", "park"],
    bannedTags: ["shopping_mall", "museum", "bookstore"],
    searchQueries: ["coastal walk", "seaside park", "harbor scenic", "beach view"],
    preferIndoor: false,
    summaryTone: "sea",
    bannedNamePatterns: [/百貨|書店/i],
    preferredNamePatterns: [/海|港|岸|滨|coast|beach|harbor/i],
  },
};

const TYPE_TO_TAG: Record<string, MoodPlaceTag> = {
  cafe: "cafe",
  coffee_shop: "coffee_shop",
  bakery: "bakery",
  dessert_shop: "dessert",
  dessert: "dessert",
  bookstore: "bookstore",
  book_store: "bookstore",
  museum: "museum",
  art_gallery: "art_gallery",
  shopping_mall: "shopping_mall",
  department_store: "department_store",
  spa: "spa",
  beauty_salon: "spa",
  massage: "massage",
  restaurant: "restaurant",
  park: "park",
  tourist_attraction: "scenic",
  bar: "bar",
  night_club: "bar",
};

const IDENTITY_TO_TAG: Partial<Record<string, MoodPlaceTag>> = {
  cafe: "cafe",
  bakery: "bakery",
  dessert: "dessert",
  bookstore: "bookstore",
  museum: "museum",
  shopping_mall: "shopping_mall",
  department_store: "department_store",
  park: "park",
  tourist_attraction: "scenic",
  bar: "bar",
  night_market: "night_market",
  restaurant: "restaurant",
};

function normalizeMoodKey(mood: string): string {
  const trimmed = mood.trim();
  if (MOOD_PROFILES[trimmed]) return trimmed;
  for (const key of Object.keys(MOOD_PROFILES)) {
    if (trimmed.includes(key) || key.includes(trimmed)) return key;
  }
  if (/咖啡/.test(trimmed)) return "找咖啡";
  if (/宵夜|消夜|小吃|夜市/.test(trimmed)) return "宵夜";
  if (/雨/.test(trimmed)) return "下雨天";
  if (/累|休息/.test(trimmed)) return "今天有點累";
  if (/散步|走走/.test(trimmed)) return "想散步";
  if (/放空|放鬆/.test(trimmed)) return "想放空";
  if (/一個人|獨自/.test(trimmed)) return "一個人";
  if (/深夜|夜景/.test(trimmed)) return "深夜散步";
  if (/海|海岸/.test(trimmed)) return "看海";
  return trimmed;
}

/** 心情 + 使用者文字 + 天氣 → 推薦 intent */
export function resolveMoodRecommendationIntent(
  mood: string,
  opts?: { userText?: string; weather?: WeatherSummary | null },
): MoodRecommendationIntent {
  const text = opts?.userText?.trim() ?? "";
  let key = normalizeMoodKey(mood);

  if (/咖啡|caf[eé]/i.test(text)) key = "找咖啡";
  else if (/宵夜|消夜|小吃|夜市/.test(text)) key = "宵夜";
  else if (/下雨|室內/.test(text)) key = "下雨天";
  else if (/累|休息|按摩|spa/i.test(text)) key = "今天有點累";
  else if (/散步|走走|河堤/.test(text)) key = "想散步";
  else if (/海|海岸/.test(text)) key = "看海";

  const profile = MOOD_PROFILES[key] ?? {
    detectedIntent: "generic_nearby",
    selectedTags: ["cafe", "restaurant", "scenic"] as MoodPlaceTag[],
    bannedTags: [] as MoodPlaceTag[],
    searchQueries: [`${key || mood} nearby places`, "cafe", "restaurant"],
    preferIndoor: opts?.weather?.recommendation === "indoor",
    summaryTone: "generic" as const,
    bannedNamePatterns: [] as RegExp[],
    preferredNamePatterns: [] as RegExp[],
  };

  const weatherIndoor = opts?.weather?.recommendation === "indoor";
  const preferIndoor = profile.preferIndoor || (weatherIndoor && key !== "看海" && key !== "想散步");

  return {
    mood: key,
    detectedIntent: preferIndoor && key === "下雨天" ? "rainy_day_indoor" : profile.detectedIntent,
    selectedTags: profile.selectedTags,
    bannedTags: profile.bannedTags,
    searchQueries: profile.searchQueries,
    preferIndoor,
    summaryTone: profile.summaryTone,
  };
}

export function resolveMoodSearchQueries(mood: string, userText?: string): string[] {
  return resolveMoodRecommendationIntent(mood, { userText }).searchQueries;
}

const TAG_TO_NEARBY_TYPE: Partial<Record<MoodPlaceTag, string>> = {
  cafe: "cafe",
  coffee_shop: "cafe",
  bakery: "bakery",
  dessert: "dessert_shop",
  bookstore: "bookstore",
  museum: "museum",
  art_gallery: "art_gallery",
  shopping_mall: "shopping_mall",
  department_store: "department_store",
  spa: "spa",
  massage: "spa",
  restaurant: "restaurant",
  park: "park",
  scenic: "tourist_attraction",
  waterfront: "tourist_attraction",
  coastal: "tourist_attraction",
  night_view: "tourist_attraction",
  outdoor_walk: "park",
  night_market: "restaurant",
  bar: "bar",
  quiet: "cafe",
  indoor: "cafe",
};

/** 文字搜尋無結果時，改以 nearby types 搜尋（與首頁附近推薦同源） */
export function moodIntentToNearbyTypes(intent: MoodRecommendationIntent): string[] {
  const types = new Set<string>();
  for (const tag of intent.selectedTags) {
    const mapped = TAG_TO_NEARBY_TYPE[tag];
    if (mapped) types.add(mapped);
  }
  if (types.size === 0) {
    return ["cafe", "restaurant", "park", "tourist_attraction"];
  }
  return [...types].slice(0, 6);
}

function classifyPlaceTags(place: PlaceIdentityInput & { name: string }): MoodPlaceTag[] {
  const tags = new Set<MoodPlaceTag>();
  const types = collectPlaceTypes(place);
  for (const t of types) {
    const tag = TYPE_TO_TAG[t];
    if (tag) tags.add(tag);
  }
  const identity = resolvePlaceIdentity(place);
  const idTag = IDENTITY_TO_TAG[identity];
  if (idTag) tags.add(idTag);

  const blob = `${place.name} ${place.primaryType ?? ""} ${(place.types ?? []).join(" ")}`.toLowerCase();
  if (/coffee|cafe|咖啡/.test(blob)) tags.add("cafe");
  if (/book|書店|書局/.test(blob)) tags.add("bookstore");
  if (/museum|博物/.test(blob)) tags.add("museum");
  if (/gallery|美術/.test(blob)) tags.add("art_gallery");
  if (/mall|百貨|商場/.test(blob)) tags.add("shopping_mall");
  if (/河|river|水岸|滨|堤/.test(blob)) tags.add("riverside");
  if (/海|coast|harbor|港/.test(blob)) tags.add("coastal");
  if (/park|公園|步道|walk|trail/.test(blob)) tags.add(/park|公園/.test(blob) ? "park" : "outdoor_walk");
  if (/spa|按摩|massage/.test(blob)) tags.add(/按摩|massage/.test(blob) ? "massage" : "spa");
  if (/night|夜景/.test(blob)) tags.add("night_view");
  if (/夜市|宵夜|小吃/.test(blob)) tags.add("night_market");

  return [...tags];
}

function getProfileForIntent(intent: MoodRecommendationIntent): MoodProfile {
  return (
    MOOD_PROFILES[intent.mood] ?? {
      detectedIntent: intent.detectedIntent,
      selectedTags: intent.selectedTags,
      bannedTags: intent.bannedTags,
      searchQueries: intent.searchQueries,
      preferIndoor: intent.preferIndoor,
      summaryTone: intent.summaryTone,
      bannedNamePatterns: [],
      preferredNamePatterns: [],
    }
  );
}

/** 驗證單一地點是否符合 mood intent */
export function validatePlaceForMoodIntent(
  place: PlaceResult,
  intent: MoodRecommendationIntent,
): MoodPlaceValidation {
  const profile = getProfileForIntent(intent);
  const placeTypes = collectPlaceTypes(place);
  const tags = classifyPlaceTags(place);
  const matchedTags = intent.selectedTags.filter((t) => tags.includes(t));
  const bannedHits = intent.bannedTags.filter((t) => tags.includes(t));

  let score = 40;
  score += matchedTags.length * 18;
  score -= bannedHits.length * 35;

  for (const re of profile.preferredNamePatterns) {
    if (re.test(place.name)) score += 12;
  }
  for (const re of profile.bannedNamePatterns) {
    if (re.test(place.name)) score -= 40;
  }

  if (intent.preferIndoor) {
    if (tags.some((t) => ["park", "riverside", "outdoor_walk", "scenic", "waterfront", "coastal"].includes(t))) {
      score -= 25;
    }
    if (tags.some((t) => ["cafe", "bookstore", "museum", "shopping_mall", "indoor"].includes(t))) {
      score += 10;
    }
  }

  if (place.rating != null) score += Math.min(place.rating, 5) * 2;

  const rankingReason =
    matchedTags.length > 0
      ? `matched:${matchedTags.join(",")}`
      : bannedHits.length > 0
        ? `banned:${bannedHits.join(",")}`
        : "neutral";

  const minValidScore = intent.mood === "找咖啡" ? 45 : 38;
  const valid = score >= minValidScore && bannedHits.length === 0 && !profile.bannedNamePatterns.some((re) => re.test(place.name));

  return {
    valid,
    score,
    rankingReason,
    placeTypes,
    matchedTags,
    bannedHits,
  };
}

const MIN_VALID_SCORE = 38;

/** 過濾 + 排序 + 回傳 meta */
export function rankAndValidatePlacesForMood(
  places: PlaceResult[],
  intent: MoodRecommendationIntent,
  opts?: { maxCount?: number; minCount?: number },
): { places: PlaceResult[]; ranked: RankedMoodPlace[]; meta: MoodPipelineMeta } {
  const maxCount = opts?.maxCount ?? 4;
  const minCount = opts?.minCount ?? 2;

  const ranked: RankedMoodPlace[] = places
    .map((place) => ({
      place,
      validation: validatePlaceForMoodIntent(place, intent),
    }))
    .sort((a, b) => b.validation.score - a.validation.score);

  let validRanked = ranked.filter((r) => r.validation.valid && r.validation.score >= MIN_VALID_SCORE);

  if (validRanked.length < minCount) {
    validRanked = ranked.filter(
      (r) =>
        r.validation.score >= MIN_VALID_SCORE - 8 &&
        r.validation.bannedHits.length === 0 &&
        !getProfileForIntent(intent).bannedNamePatterns.some((re) => re.test(r.place.name)),
    );
  }

  if (validRanked.length < minCount) {
    validRanked = ranked.filter((r) => r.validation.bannedHits.length === 0).slice(0, maxCount);
  }

  const selected = validRanked.slice(0, maxCount);
  const rejected = ranked.length - selected.length;

  const meta: MoodPipelineMeta = {
    mood: intent.mood,
    detected_intent: intent.detectedIntent,
    selected_tags: intent.selectedTags,
    banned_tags: intent.bannedTags,
    search_queries: intent.searchQueries,
    validation_passed: selected.filter((r) => r.validation.valid).length,
    validation_rejected: rejected,
    ranking_reasons: selected.map(
      (r) => `${r.place.name}:${r.validation.rankingReason}:${Math.round(r.validation.score)}`,
    ),
  };

  lastPipelineMeta = meta;
  console.info("[MOOD_PIPELINE]", meta);

  return {
    places: selected.map((r) => r.place),
    ranked: selected,
    meta,
  };
}

export function attachMoodRankingToRecommendation<T extends { name: string; reason?: string }>(
  item: T,
  ranked: RankedMoodPlace | undefined,
): T & { rankingReason?: string; moodTags?: string[]; placeTypes?: string[] } {
  if (!ranked) return item;
  return {
    ...item,
    rankingReason: ranked.validation.rankingReason,
    moodTags: ranked.validation.matchedTags,
    placeTypes: ranked.validation.placeTypes,
    reason: item.reason ?? `符合${ranked.validation.matchedTags.join("、") || "附近"}推薦`,
  };
}

function recommendationToPlaceResult(item: RoamieRecommendationItem): PlaceResult {
  return {
    id: item.googlePlaceId ?? item.name,
    name: item.placeName ?? item.name,
    address: item.address || null,
    lat: item.lat,
    lng: item.lng,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    photoName: item.photoName ?? null,
    primaryType: item.type || null,
    types: item.type ? [item.type] : [],
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: item.closingSoonNote ?? "",
    nextOpenHint: item.nextOpenHint ?? "",
  };
}

/** 驗證 AI 推薦卡是否符合 mood intent */
export function countValidMoodRecommendations(
  recs: RoamieRecommendationItem[],
  mood: string,
  opts?: { userText?: string; weather?: WeatherSummary | null },
): { validCount: number; intent: MoodRecommendationIntent } {
  const intent = resolveMoodRecommendationIntent(mood, opts);
  let validCount = 0;
  for (const rec of recs) {
    const validation = validatePlaceForMoodIntent(recommendationToPlaceResult(rec), intent);
    if (validation.valid) validCount++;
  }
  return { validCount, intent };
}
