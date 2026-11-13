import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  dedupeCandidatePlaces,
  evaluatePlannerPoolGate,
  isPlannerPoolReady,
  minCandidatePoolSize,
  PLANNING_RADIUS_STEPS_M,
} from "@/lib/ai/ai-multi-day-planner";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { shouldSkipPlanningPlacesApi } from "@/lib/ai/planning-candidate-pool";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { filterRealPlanningPlaces } from "@/lib/ai/planning-real-place";

export const POOL_EXPANSION_VARIANTS = ["top_rated", "popular", "hidden_gems", "open_now"] as const;
export type PoolExpansionVariant = (typeof POOL_EXPANSION_VARIANTS)[number];

export type PoolExpansionCategory = {
  key: string;
  label: string;
  types: string[];
};

/** 分類擴充順序：先景點類，再生活類，最後美食 */
export const POOL_EXPANSION_CATEGORIES: PoolExpansionCategory[] = [
  { key: "tourist_attraction", label: "熱門景點", types: ["tourist_attraction", "point_of_interest"] },
  { key: "landmark", label: "地標", types: ["tourist_attraction", "historical_landmark", "cultural_landmark"] },
  { key: "museum", label: "博物館", types: ["museum"] },
  { key: "art_gallery", label: "美術館", types: ["art_gallery", "museum"] },
  { key: "historic_site", label: "古蹟", types: ["tourist_attraction", "historical_landmark", "monument"] },
  { key: "cultural_center", label: "文化景點", types: ["museum", "art_gallery", "cultural_center", "library"] },
  { key: "park", label: "自然景觀", types: ["park", "natural_feature"] },
  { key: "viewpoint", label: "觀景", types: ["tourist_attraction", "observation_deck", "natural_feature"] },
  { key: "visitor_center", label: "遊客中心", types: ["tourist_information_center", "visitor_center"] },
  { key: "amusement", label: "主題樂園", types: ["amusement_park", "theme_park", "zoo", "aquarium"] },
  { key: "local_attraction", label: "在地景點", types: ["tourist_attraction", "point_of_interest", "establishment"] },
  { key: "shopping_mall", label: "商圈", types: ["shopping_mall", "department_store"] },
  { key: "shopping_street", label: "購物街", types: ["shopping_mall", "store", "tourist_attraction"] },
  { key: "market", label: "市場", types: ["market"] },
  { key: "night_market", label: "夜市", types: ["restaurant", "market", "night_club"] },
  { key: "cafe", label: "咖啡", types: ["cafe", "coffee_shop", "bakery"] },
  { key: "breakfast", label: "早餐", types: ["restaurant", "cafe", "bakery", "meal_takeaway"] },
  { key: "restaurant", label: "美食", types: ["restaurant", "food"] },
  { key: "bakery", label: "烘焙", types: ["bakery", "cafe"] },
  { key: "souvenir", label: "伴手禮", types: ["store", "shopping_mall", "tourist_attraction"] },
  { key: "indoor", label: "室內景點", types: ["museum", "art_gallery", "shopping_mall", "amusement_park", "aquarium"] },
];

function variantQuerySuffix(variant: PoolExpansionVariant): { zh: string; en: string } {
  switch (variant) {
    case "top_rated":
      return { zh: "高評分", en: "top rated" };
    case "popular":
      return { zh: "熱門", en: "popular" };
    case "hidden_gems":
      return { zh: "隱藏版", en: "hidden gems" };
    case "open_now":
      return { zh: "營業中", en: "open now" };
  }
}

export function buildPoolExpansionAttempts(
  destination: string,
  category: PoolExpansionCategory,
  variant: PoolExpansionVariant,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const suffix = variantQuerySuffix(variant);
  const queries = [
    `${label} ${category.label} ${suffix.zh}`,
    `${label} ${suffix.zh} ${category.label}`,
    `${label} ${category.label}`,
  ];
  const en = EN_CITY_NAMES[label];
  if (en && en !== label) {
    queries.push(`${en} ${suffix.en} ${category.key.replace(/_/g, " ")}`);
  }
  return queries.map((query) => ({
    query,
    mode: "text" as const,
    includedTypes: category.types,
  }));
}

export function buildInitialPoolSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  return [
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction", "point_of_interest"] },
    { query: `${label} 熱門景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 地標`, mode: "text", includedTypes: ["tourist_attraction", "historical_landmark"] },
    { query: `${label} 觀光景點`, mode: "text", includedTypes: ["tourist_attraction", "museum"] },
  ];
}

export type PoolExpansionSearchFn = (params: {
  attempts: SearchAttempt[];
  caller: string;
  radiusM: number;
  excludePlaceIds: string[];
}) => Promise<PlaceResult[]>;

export type ExpandPlacePoolParams = {
  label: string;
  lat: number;
  lng: number;
  days: number;
  style: TripStyleKey;
  existingPlaces: PlaceResult[];
  caller: string;
  excludePlaceIds?: string[];
  searchBatch: PoolExpansionSearchFn;
  targetCount?: number;
  /** 同一次生成共用的搜尋預算；未提供時每次呼叫各自計算 */
  queryBudget?: PoolExpansionQueryBudget;
};

/** 單次生成擴池最多送出的不重複 query（radius+query+types），只減少呼叫 */
export const POOL_EXPANSION_QUERY_BUDGET = 120;
/** 單次擴池連續幾批新增 0 筆就停止 */
export const POOL_EXPANSION_MAX_ZERO_GAIN_BATCHES = 8;

const DINING_EXPANSION_KEYS = new Set(["night_market", "cafe", "breakfast", "restaurant", "bakery"]);
const DINING_SLOTS = new Set(["breakfast", "lunch", "cafe", "dinner", "evening"]);

/** 依 pool gate 的缺額把「缺的類別」排前面；其餘維持原順序（穩定排序） */
function prioritizeMissingCategories(places: PlaceResult[], days: number): PoolExpansionCategory[] {
  const missing = evaluatePlannerPoolGate(places, days).missingSlots;
  const needDining = missing.some((s) => DINING_SLOTS.has(s));
  const needScenic = missing.includes("attraction");
  if (!needDining && !needScenic) return POOL_EXPANSION_CATEGORIES;
  if (needDining && needScenic) {
    // 兩類都缺：景點、餐飲輪流，避免景點連續零新增時餐飲永遠輪不到
    const dining = POOL_EXPANSION_CATEGORIES.filter((c) => DINING_EXPANSION_KEYS.has(c.key));
    const scenic = POOL_EXPANSION_CATEGORIES.filter((c) => !DINING_EXPANSION_KEYS.has(c.key));
    const out: PoolExpansionCategory[] = [];
    for (let i = 0; i < Math.max(dining.length, scenic.length); i += 1) {
      if (scenic[i]) out.push(scenic[i]);
      if (dining[i]) out.push(dining[i]);
    }
    return out;
  }
  const isWanted = (c: PoolExpansionCategory) => DINING_EXPANSION_KEYS.has(c.key) === needDining;
  return [...POOL_EXPANSION_CATEGORIES.filter(isWanted), ...POOL_EXPANSION_CATEGORIES.filter((c) => !isWanted(c))];
}
export type PoolExpansionQueryBudget = { seen: Set<string>; max: number };
export function createPoolExpansionQueryBudget(): PoolExpansionQueryBudget {
  return { seen: new Set(), max: POOL_EXPANSION_QUERY_BUDGET };
}

function collectedTripPlaceIds(places: PlaceResult[]): string[] {
  return places.map((p) => (p.id ?? "").trim()).filter(Boolean);
}

/** 依分類 × 變體 × 半徑逐步擴充，直到 Place Pool 達最低需求 */
export async function expandPlacePoolUntilSufficient(
  params: ExpandPlacePoolParams,
): Promise<PlaceResult[]> {
  const target = params.targetCount ?? minCandidatePoolSize(params.days);
  let pool = dedupeCandidatePlaces(params.existingPlaces);

  const realPool = () => dedupeCandidatePlaces(filterRealPlanningPlaces(pool));
  const poolReady = () => isPlannerPoolReady(realPool(), params.days);

  if (poolReady() || shouldSkipPlanningPlacesApi()) {
    return realPool();
  }

  logAiPipeline(
    "[AI_POOL_EXPAND_START]",
    `pool=${realPool().length}`,
    `target=${target}`,
    `days=${params.days}`,
    `ready=${poolReady()}`,
  );

  const budget = params.queryBudget ?? createPoolExpansionQueryBudget();
  let zeroGainStreak = 0;
  let stopped = false;
  const runBatch = async (
    attempts: SearchAttempt[],
    radiusM: number,
    tag: string,
  ): Promise<void> => {
    if (stopped || poolReady() || shouldSkipPlanningPlacesApi()) return;
    const keyOf = (a: SearchAttempt) => `${radiusM}|${a.query}|${(a.includedTypes ?? []).join(",")}`;
    // 同一次生成已送過的 query 結果相同（只會多排除已收錄地點），不重送
    const fresh = attempts.filter((a) => !budget.seen.has(keyOf(a)));
    if (!fresh.length) return;
    if (budget.seen.size + fresh.length > budget.max) {
      stopped = true;
      logAiPipeline("[AI_POOL_EXPAND_BUDGET]", `sent=${budget.seen.size}`, `max=${budget.max}`);
      return;
    }
    for (const a of fresh) budget.seen.add(keyOf(a));
    const before = realPool().length;
    const batch = await params.searchBatch({
      attempts: fresh,
      caller: `${params.caller}.${tag}.r${radiusM}`,
      radiusM,
      excludePlaceIds: [
        ...(params.excludePlaceIds ?? []),
        ...collectedTripPlaceIds(pool),
      ],
    });
    pool = dedupeCandidatePlaces([...pool, ...batch]);
    const after = realPool().length;
    if (after <= before) {
      zeroGainStreak += 1;
      if (zeroGainStreak >= POOL_EXPANSION_MAX_ZERO_GAIN_BATCHES) stopped = true;
    } else {
      zeroGainStreak = 0;
      logAiPipeline(
        "[AI_POOL_EXPAND_BATCH]",
        `tag=${tag}`,
        `radius=${radiusM}`,
        `added=${after - before}`,
        `pool=${after}`,
      );
    }
  };

  for (const radiusM of PLANNING_RADIUS_STEPS_M) {
    if (stopped || poolReady() || shouldSkipPlanningPlacesApi()) break;

    logAiPipeline(
      "[AI_POOL_EXPAND_RADIUS]",
      `radius=${radiusM}`,
      `pool=${realPool().length}`,
      `target=${target}`,
    );

    if (radiusM === PLANNING_RADIUS_STEPS_M[0]) {
      await runBatch(buildInitialPoolSearchAttempts(params.label), radiusM, "initial");
    }

    for (const category of prioritizeMissingCategories(realPool(), params.days)) {
      if (stopped || poolReady() || shouldSkipPlanningPlacesApi()) break;
      for (const variant of POOL_EXPANSION_VARIANTS) {
        if (stopped || poolReady() || shouldSkipPlanningPlacesApi()) break;
        const attempts = buildPoolExpansionAttempts(params.label, category, variant);
        await runBatch(attempts, radiusM, `${category.key}.${variant}`);
      }
    }
  }

  logAiPipeline(
    "[AI_POOL_EXPAND_DONE]",
    `pool=${realPool().length}`,
    `target=${target}`,
    `ready=${poolReady()}`,
  );
  return realPool();
}
