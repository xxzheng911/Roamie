import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { isRecEnginePlannerEnabled } from "@/lib/recommendation/engine/feature-flag-planner";
import {
  classifyPlanPlaceKind,
  canPlaceFillSlot,
  ensureAllDayPlansExist,
  flattenComposedDayPlanPlaces,
  minItemsPerDayForTrip,
  plannerPopulatedDayCount,
  plannerTotalPlaces,
  preferBetterComposedPlans,
  resolveEntryLabel,
  resolvePlannerStyleKey,
  resolveStyleDaySlotTemplate,
  type ComposedDayPlan,
  type DayPlanEntry,
  type DayPlanSlot,
  type PlanPlaceKind,
} from "@/lib/ai/ai-day-plan-source";
import {
  filterExcludedRetailPlaces,
  dedupeEntryTimes,
  isCafePlace,
  isDiningPlace,
  isExcludedRetailPlace,
  isLargeMallPlace,
  isNightMarketPlace,
  isProperRestaurantPlace,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  computeSlotDeficitFromPools,
  hasSlotDeficit,
  type CategoryPoolCounts,
} from "@/lib/ai/itinerary-postprocess-diagnostics";
import {
  TripPlaceAllocator,
  isGeocodeEmptyPlace,
  resolveTripPlaceId,
  seedTripAllocatorFromPlans,
  validateTripPlaceUniqueness,
  type TripPlaceUniquenessValidation,
} from "@/lib/ai/ai-trip-place-allocator";
import { dedupeParentLandmarkPlaces } from "@/lib/ai/ai-parent-landmark-dedup";
import { dedupeByCanonicalLandmark } from "@/lib/ai/canonical-landmark";
import { filterRealPlanningPlaces } from "@/lib/ai/planning-real-place";
import {
  applyPlannerRouteAndCapacityAssembly,
  buildDayPreferredPools,
  passesDayRouteConstraint,
  resolveNearbyExtensionDay,
  type PlannerPaceHint,
} from "@/lib/ai/planner-day-route-assembly";
import {
  classifyDailyDiversityCategory,
  formatDailyDiversityFamilySummary,
  resolveDailyDiversityLimits,
} from "@/lib/ai/daily-category-diversity";

export const MAX_TRIP_DUPLICATE_RATE = 0.2;
/** 進入 Planner 前：候選池每天至少 6 個（4 天 = 至少 24） */
export const MIN_POOL_PLACES_PER_DAY = 6;
/** 餐飲候選：每天至少 3 個（早/午/晚） */
export const MIN_DINING_POOL_PER_DAY = 3;
/** 景點/活動候選：每天至少 3 個 */
export const MIN_SCENIC_POOL_PER_DAY = 3;
/** 可渲染行程：每天至少 7 個（完整日程結構） */
export const MIN_RENDERABLE_ITEMS_PER_DAY = 7;
export const PLANNING_RADIUS_STEPS_M = [3_000, 5_000, 10_000, 15_000, 20_000] as const;

export type DayThemeProfile = {
  theme: string;
  preferKinds: PlanPlaceKind[];
  keywordRe: RegExp;
};

const STYLE_DAY_THEMES: Partial<Record<TripStyleKey, DayThemeProfile[]>> = {
  classic_landmarks: [
    { theme: "古蹟文化", preferKinds: ["attraction", "culture"], keywordRe: /古蹟|廟|孔廟|測候|博物|文化|遺址|歷史/i },
    { theme: "老街美食", preferKinds: ["market", "restaurant", "shopping"], keywordRe: /老街|市場|小吃|美食|商圈/i },
    { theme: "自然景觀", preferKinds: ["nature", "attraction"], keywordRe: /公園|步道|海|濱|山|濕地|綠|自然/i },
    { theme: "文創咖啡", preferKinds: ["culture", "cafe", "shopping"], keywordRe: /文創|藝術|咖啡|書店|園區|倉庫/i },
    { theme: "伴手禮市場", preferKinds: ["market", "shopping", "restaurant"], keywordRe: /市場|伴手|商圈|百貨|購物/i },
  ],
  local_life: [
    { theme: "市場早午餐", preferKinds: ["market", "restaurant"], keywordRe: /市場|早|傳統/i },
    { theme: "巷弄日常", preferKinds: ["shopping", "culture"], keywordRe: /巷|弄|街|社區|里/i },
    { theme: "公園散策", preferKinds: ["nature", "attraction"], keywordRe: /公園|河|綠|步道/i },
    { theme: "咖啡午後", preferKinds: ["cafe", "culture"], keywordRe: /咖啡|甜|茶/i },
    { theme: "夜市晚餐", preferKinds: ["night_market", "restaurant"], keywordRe: /夜市|小吃|排/i },
  ],
  slow_nature: [
    { theme: "自然慢步", preferKinds: ["nature", "attraction"], keywordRe: /公園|步道|山|海|濕|森林/i },
    { theme: "文化小旅行", preferKinds: ["culture", "attraction"], keywordRe: /文|藝|博物|古/i },
    { theme: "咖啡午後", preferKinds: ["cafe", "culture"], keywordRe: /咖啡|甜/i },
    { theme: "街區探索", preferKinds: ["shopping", "market"], keywordRe: /街|巷|市場/i },
    { theme: "療癒收尾", preferKinds: ["nature", "cafe"], keywordRe: /溫泉|海|公園|咖啡/i },
  ],
  mixed: [
    { theme: "必去經典", preferKinds: ["attraction", "culture"], keywordRe: /地標|經典|必去|觀光/i },
    { theme: "美食探索", preferKinds: ["restaurant", "market"], keywordRe: /餐|美食|小吃|市場/i },
    { theme: "自然風景", preferKinds: ["nature", "attraction"], keywordRe: /公園|山|海|步道/i },
    { theme: "文創咖啡", preferKinds: ["culture", "cafe"], keywordRe: /文創|藝術|咖啡/i },
    { theme: "自由收尾", preferKinds: ["shopping", "market", "attraction"], keywordRe: /商圈|伴手|購物/i },
  ],
};

export type DaySlotBudget = {
  cafe: number;
  nightMarket: number;
  mall: number;
  shopping: number;
};

function emptyDayBudget(): DaySlotBudget {
  return { cafe: 0, nightMarket: 0, mall: 0, shopping: 0 };
}

const DAY_SLOT_LIMITS: DaySlotBudget = {
  cafe: 1,
  nightMarket: 1,
  mall: 1,
  shopping: 1,
};

export function resolveDayTheme(style: TripStyleKey, dayIndex: number): DayThemeProfile {
  const themes = STYLE_DAY_THEMES[style] ?? STYLE_DAY_THEMES.mixed!;
  return themes[dayIndex % themes.length]!;
}

export function minRenderableItemsPerDay(days: number): number {
  return minItemsPerDayForTrip(days);
}

export function isPlannerPoolSufficient(poolSize: number, days: number): boolean {
  return poolSize >= minCandidatePoolSize(days);
}

export function isPlannerPoolReady(places: PlaceResult[], days: number): boolean {
  return isPlannerPoolCompositionSufficient(places, days);
}

export function resolveAdaptiveMinPerDay(poolSize: number, days: number): number {
  const ideal = minItemsPerDayForTrip(days);
  if (poolSize <= 0) return ideal;
  // 候選池再大也只輸出固定 slot 數，不可依 pool 大小提高每日項目數
  return ideal;
}

export function canEvenlyMeetMinPerDay(poolSize: number, days: number): boolean {
  return Math.floor(poolSize / Math.max(1, days)) >= minRenderableItemsPerDay(days);
}

function distributeSlotForPlace(
  place: PlaceResult,
  index: number,
  style: TripStyleKey,
): DayPlanSlot {
  const template = resolveStyleDaySlotTemplate(style, 1);
  if (template[index]) return template[index]!;

  const kind = classifyPlanPlaceKind(place);
  const fallbackTimes = ["08:30", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
  const time = fallbackTimes[index % fallbackTimes.length] ?? "10:00";

  if (kind === "restaurant" || kind === "cafe") {
    const hour = Number(time.split(":")[0] ?? "12");
    if (hour < 10) return { time, kind: "restaurant", label: "早餐" };
    if (hour < 14) return { time, kind: "restaurant", label: "午餐" };
    if (hour < 19) return { time, kind: "restaurant", label: "晚餐" };
    return { time, kind: "night_market", label: "酒吧" };
  }
  if (kind === "night_market") {
    return { time: "20:00", kind: "night_market", label: "酒吧" };
  }
  if (kind === "cafe") return { time, kind: "cafe", label: "咖啡" };
  return { time, kind: "attraction", label: "景點" };
}

function entryFromPlace(
  place: PlaceResult,
  day: number,
  index: number,
  style: TripStyleKey,
): DayPlanEntry {
  const slot = distributeSlotForPlace(place, index, style);
  return {
    time: slot.time,
    label: resolveEntryLabel(slot, place),
    name: place.name,
    place,
  };
}

/** 候選不足時：將 Place Pool 平均分散至所有天，但每天最多 7 slot（不可把整個 pool 塞進 dayPlan） */
export function redistributePlacesEvenly(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const safeDays = Math.max(1, params.days);
  const slotsPerDay = minItemsPerDayForTrip(safeDays);
  const maxTotal = safeDays * slotsPerDay;
  const pool = dedupeCandidatePlaces(
    filterExcludedRetailPlaces(params.places).filter((p) => p.name?.trim()),
  ).slice(0, maxTotal);
  if (!pool.length) {
    return ensureAllDayPlansExist([], safeDays);
  }

  const base = Math.min(slotsPerDay, Math.floor(pool.length / safeDays));
  const extra = Math.min(slotsPerDay * safeDays - base * safeDays, pool.length % safeDays);
  // Spread remainder across middle/later days — never bias Day 1 as the overflow sink.
  const perDayCounts = Array.from({ length: safeDays }, () => base);
  for (let e = 0; e < extra; e += 1) {
    const idx =
      safeDays <= 1 ? 0 : Math.min(safeDays - 1, Math.floor(((e + 1) * safeDays) / (extra + 1)));
    perDayCounts[idx] = Math.min(slotsPerDay, (perDayCounts[idx] ?? base) + 1);
  }

  logAiPipeline(
    "[AI_PLANNER_REDISTRIBUTE]",
    `pool=${pool.length}`,
    `days=${safeDays}`,
    `counts=${perDayCounts.join(",")}`,
  );

  const plans: ComposedDayPlan[] = [];
  let poolIdx = 0;
  for (let day = 1; day <= safeDays; day += 1) {
    const count = perDayCounts[day - 1] ?? 0;
    const entries: DayPlanEntry[] = [];
    for (let i = 0; i < count && poolIdx < pool.length; i += 1) {
      entries.push(entryFromPlace(pool[poolIdx]!, day, i, params.style));
      poolIdx += 1;
    }
    plans.push({ day, entries });
  }

  return ensureAllDayPlansExist(plans, safeDays);
}

/** 合併既有行程 + 候選池，確保每一天至少 1 個地點（僅在 pool 足夠時） */
export function ensureEveryDayPopulated(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const normalized = ensureAllDayPlansExist(params.plans, params.days);
  const emptyDays = normalized.filter((plan) => plan.entries.length === 0);
  if (!emptyDays.length) return normalized;

  const mergedPool = dedupeCandidatePlaces([
    ...flattenComposedDayPlanPlaces(normalized),
    ...params.pool,
  ]);
  if (!mergedPool.length) return normalized;

  const slotsPerDay = minItemsPerDayForTrip(params.days);
  const slotCap = params.days * slotsPerDay;

  if (mergedPool.length > slotCap) {
    logAiPipeline(
      "[AI_PLANNER_ENSURE_DAYS]",
      `empty=${emptyDays.map((p) => p.day).join(",")}`,
      `pool=${mergedPool.length}`,
      "strategy=slot_pick_not_redistribute",
    );
    return buildThemedMultiDayPlans({
      places: mergedPool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  // Coverage-first: if pool can put ≥1 stop on every day, redistribute (lower
  // per-day targets). Only leave empty when totals cannot cover tripDays.
  if (mergedPool.length < params.days) {
    logAiPipeline(
      "[AI_PLANNER_POOL_INSUFFICIENT]",
      `pool=${mergedPool.length}`,
      `required=${params.days}`,
      `target=${minCandidatePoolSize(params.days)}`,
      "action=leave_empty_math_impossible",
      `empty=${emptyDays.map((p) => p.day).join(",")}`,
      "sourceFunction=ensureEveryDayPopulated",
    );
    return normalized;
  }

  if (mergedPool.length < params.days * slotsPerDay) {
    logAiPipeline(
      "[AI_PLANNER_POOL_INSUFFICIENT]",
      `pool=${mergedPool.length}`,
      `required=${params.days * slotsPerDay}`,
      `target=${minCandidatePoolSize(params.days)}`,
      "action=redistribute_lower_targets_for_coverage",
      `empty=${emptyDays.map((p) => p.day).join(",")}`,
      "sourceFunction=ensureEveryDayPopulated",
    );
  } else if (!isPlannerPoolSufficient(mergedPool.length, params.days)) {
    logAiPipeline(
      "[AI_PLANNER_POOL_INSUFFICIENT]",
      `pool=${mergedPool.length}`,
      `target=${minCandidatePoolSize(params.days)}`,
      "action=redistribute_partial",
    );
  }

  logAiPipeline(
    "[AI_PLANNER_ENSURE_DAYS]",
    `empty=${emptyDays.map((p) => p.day).join(",")}`,
    `pool=${mergedPool.length}`,
    "strategy=redistribute_capped",
  );
  return redistributePlacesEvenly({
    places: mergedPool,
    days: params.days,
    style: params.style,
    plannedDate: params.plannedDate,
  });
}

export function minCandidatePoolSize(days: number): number {
  return Math.max(1, days) * MIN_POOL_PLACES_PER_DAY;
}

export function minDiningPoolSize(days: number): number {
  return Math.max(1, days) * MIN_DINING_POOL_PER_DAY;
}

export function minScenicPoolSize(days: number): number {
  return Math.max(1, days) * MIN_SCENIC_POOL_PER_DAY;
}

export function countDiningPoolPlaces(places: PlaceResult[]): number {
  return filterRealPlanningPlaces(places).filter(
    (p) =>
      isProperRestaurantPlace(p) ||
      isCafePlace(p) ||
      isNightMarketPlace(p),
  ).length;
}

export function countScenicPoolPlaces(places: PlaceResult[]): number {
  return filterRealPlanningPlaces(places).filter((p) => {
    if (isExcludedRetailPlace(p)) return false;
    const kind = classifyPlanPlaceKind(p);
    return (
      kind === "attraction" ||
      kind === "culture" ||
      kind === "nature" ||
      kind === "shopping" ||
      kind === "market"
    );
  }).length;
}

export function isPlannerPoolCompositionSufficient(places: PlaceResult[], days: number): boolean {
  return evaluatePlannerPoolGate(places, days).decision !== "block";
}

export type ItinerarySlotPools = CategoryPoolCounts & {
  all: PlaceResult[];
  breakfastPool: PlaceResult[];
  attractionPool: PlaceResult[];
  lunchPool: PlaceResult[];
  cafePool: PlaceResult[];
  dinnerPool: PlaceResult[];
  eveningPool: PlaceResult[];
};

const SLOT_POOL_KEYS = [
  "breakfast",
  "attraction_1",
  "lunch",
  "attraction_2",
  "cafe",
  "dinner",
  "evening",
] as const;

export type PlannerPoolGateDecision = "continue" | "refill" | "block";

export function buildItinerarySlotPools(places: PlaceResult[]): ItinerarySlotPools {
  const pool = dedupeCandidatePlaces(filterRealPlanningPlaces(places));
  const breakfastPool: PlaceResult[] = [];
  const attractionPool: PlaceResult[] = [];
  const lunchPool: PlaceResult[] = [];
  const cafePool: PlaceResult[] = [];
  const dinnerPool: PlaceResult[] = [];
  const eveningPool: PlaceResult[] = [];

  for (const place of pool) {
    const blob = [place.name, place.address, ...(place.types ?? []), place.primaryType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const kind = classifyPlanPlaceKind(place);

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
    if (/bar|night_club|bistro|pub|酒吧|居酒/i.test(blob) || isNightMarketPlace(place)) {
      eveningPool.push(place);
    }
    if (
      kind === "attraction" ||
      kind === "culture" ||
      kind === "nature" ||
      kind === "shopping" ||
      kind === "market"
    ) {
      if (!isProperRestaurantPlace(place) && !isCafePlace(place)) {
        attractionPool.push(place);
      }
    }
  }

  return {
    breakfast: breakfastPool.length,
    attraction: attractionPool.length,
    lunch: lunchPool.length,
    cafe: cafePool.length,
    dinner: dinnerPool.length,
    evening: eveningPool.length,
    total: pool.length,
    all: pool,
    breakfastPool,
    attractionPool,
    lunchPool,
    cafePool,
    dinnerPool,
    eveningPool,
  };
}

export function evaluatePlannerPoolGate(
  places: PlaceResult[],
  days: number,
): {
  decision: PlannerPoolGateDecision;
  candidateTotal: number;
  pools: ItinerarySlotPools;
  missingSlots: string[];
} {
  const pools = buildItinerarySlotPools(places);
  const candidateTotal = pools.total;
  const deficit = computeSlotDeficitFromPools(days, pools);
  const missingSlots: string[] = [];
  if (deficit.breakfastNeeded > 0) missingSlots.push("breakfast");
  if (deficit.attractionNeeded > 0) missingSlots.push("attraction");
  if (deficit.lunchNeeded > 0) missingSlots.push("lunch");
  if (deficit.cafeNeeded > 0) missingSlots.push("cafe");
  if (deficit.dinnerNeeded > 0) missingSlots.push("dinner");
  if (deficit.eveningNeeded > 0) missingSlots.push("evening");

  let decision: PlannerPoolGateDecision;
  if (candidateTotal < minCandidatePoolSize(days)) {
    decision = "block";
  } else if (hasSlotDeficit(deficit)) {
    decision = "refill";
  } else {
    decision = "continue";
  }

  console.warn(
    "[PLANNER_POOL_GATE]",
    `candidateTotal=${candidateTotal}`,
    `breakfast=${pools.breakfast}`,
    `attraction=${pools.attraction}`,
    `lunch=${pools.lunch}`,
    `cafe=${pools.cafe}`,
    `dinner=${pools.dinner}`,
    `evening=${pools.evening}`,
    `missingSlots=${missingSlots.join(",") || "none"}`,
    `decision=${decision}`,
  );

  return { decision, candidateTotal, pools, missingSlots };
}

export function logUsedPlaceSummary(params: {
  totalCandidates: number;
  pool: PlaceResult[];
  plans: ComposedDayPlan[];
}): void {
  const seen = new Set<string>();
  let duplicateDropped = 0;
  for (const place of params.pool) {
    const id = resolveTripPlaceId(place);
    if (!id) continue;
    if (seen.has(id)) duplicateDropped += 1;
    else seen.add(id);
  }
  const used = collectGlobalUsedPlaceIds(params.plans);
  const slotPools = buildItinerarySlotPools(
    params.pool.filter((place) => {
      const id = resolveTripPlaceId(place);
      return id && !used.has(id);
    }),
  );
  console.warn(
    "[USED_PLACE_SUMMARY]",
    `totalCandidates=${params.totalCandidates}`,
    `used=${used.size}`,
    `duplicateDropped=${duplicateDropped}`,
    `parentChildDropped=0`,
    `remainingBySlot=breakfast:${slotPools.breakfast},attraction:${slotPools.attraction},lunch:${slotPools.lunch},cafe:${slotPools.cafe},dinner:${slotPools.dinner},evening:${slotPools.evening}`,
  );
}

function collectGlobalUsedPlaceIds(plans: ComposedDayPlan[]): Set<string> {
  const used = new Set<string>();
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = resolveTripPlaceId(entry.place);
      if (id) used.add(id);
    }
  }
  return used;
}

function poolForSlotKey(
  key: (typeof SLOT_POOL_KEYS)[number],
  pools: ItinerarySlotPools,
  fallback: PlaceResult[],
): PlaceResult[] {
  switch (key) {
    case "breakfast":
      return pools.breakfastPool.length ? pools.breakfastPool : [...pools.lunchPool, ...pools.cafePool, ...fallback];
    case "lunch":
      return pools.lunchPool.length ? pools.lunchPool : [...pools.breakfastPool, ...pools.dinnerPool, ...fallback];
    case "cafe":
      return pools.cafePool.length ? pools.cafePool : fallback;
    case "dinner":
      return pools.dinnerPool.length ? pools.dinnerPool : [...pools.lunchPool, ...pools.eveningPool, ...fallback];
    case "evening":
      return pools.eveningPool.length ? pools.eveningPool : [...pools.dinnerPool, ...pools.attractionPool, ...fallback];
    case "attraction_1":
    case "attraction_2":
    default:
      return pools.attractionPool.length ? pools.attractionPool : fallback;
  }
}

export function dedupeCandidatePlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const place of places) {
    const key = resolveTripPlaceId(place);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  // placeId → parent landmark → canonical（含多語／商業複合設施）
  return dedupeByCanonicalLandmark(dedupeParentLandmarkPlaces(out)).places;
}

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ");
}

/**
 * @deprecated P2.2：Flag ON 時不再用於排序。
 * 僅 Flag OFF（legacy 回退）保留 theme 分數挑選。
 * 不得新增權重；rating 加成屬舊行為，P2.2+ 契約路徑禁止。
 */
function scorePlaceForTheme(place: PlaceResult, theme: DayThemeProfile): number {
  const blob = placeBlob(place);
  let score = 0;
  const kind = classifyPlanPlaceKind(place);
  if (theme.preferKinds.includes(kind)) score += 3;
  if (theme.keywordRe.test(blob)) score += 5;
  if (place.rating != null) score += Math.min(place.rating, 5) * 0.2;
  return score;
}

function exceedsDaySlotBudget(place: PlaceResult, budget: DaySlotBudget): boolean {
  const kind = classifyPlanPlaceKind(place);
  if (kind === "cafe" || isCafePlace(place)) return budget.cafe >= DAY_SLOT_LIMITS.cafe;
  if (kind === "night_market" || isNightMarketPlace(place)) {
    return budget.nightMarket >= DAY_SLOT_LIMITS.nightMarket;
  }
  if (isLargeMallPlace(place)) return budget.mall >= DAY_SLOT_LIMITS.mall;
  if (kind === "shopping" || kind === "market") {
    return budget.shopping >= DAY_SLOT_LIMITS.shopping;
  }
  return false;
}

function markDaySlotBudget(place: PlaceResult, budget: DaySlotBudget): void {
  const kind = classifyPlanPlaceKind(place);
  if (kind === "cafe" || isCafePlace(place)) budget.cafe += 1;
  else if (kind === "night_market" || isNightMarketPlace(place)) budget.nightMarket += 1;
  else if (isLargeMallPlace(place)) budget.mall += 1;
  else if (kind === "shopping" || kind === "market") budget.shopping += 1;
}

/**
 * Slot 約束（Contract 允許的跳過理由）：
 * Business Hours / Meal / Day Capacity / Duplicate / Route / retail 排除等。
 * 不做推薦排序。
 */
export function passesPlannerSlotConstraints(params: {
  place: PlaceResult;
  slot: DayPlanSlot;
  allocator: TripPlaceAllocator;
  budget: DaySlotBudget;
  plannedDate?: string;
  allowRepeat?: boolean;
  relaxConstraints?: boolean;
  dayPlaces?: PlaceResult[];
  day?: number;
  tripDays?: number;
  nearbyExtensions?: string[];
  skipRouteConstraint?: boolean;
}): boolean {
  const {
    place,
    slot,
    allocator,
    budget,
    plannedDate,
    allowRepeat,
    relaxConstraints,
    dayPlaces,
    day,
    tripDays,
    nearbyExtensions,
    skipRouteConstraint,
  } = params;
  if (!place.name?.trim()) return false;
  if (isGeocodeEmptyPlace(place)) return false;
  if (isExcludedRetailPlace(place)) return false;
  if (!allowRepeat && allocator.isUsed(place)) return false; // Duplicate / Lock 已用
  if (exceedsDaySlotBudget(place, budget)) return false; // Day Capacity / Pace 密度
  if (!relaxConstraints && !canPlaceFillSlot(place, slot, plannedDate)) return false; // Hours / Meal
  if (relaxConstraints) {
    const kind = classifyPlanPlaceKind(place);
    if (/早餐|午餐|晚餐|宵夜/.test(slot.label)) {
      if (!isDiningPlace(place, classifyPlanPlaceKind) && kind !== "night_market") return false;
    } else if (slot.kind === "cafe" || /咖啡/.test(slot.label)) {
      if (!isCafePlace(place) && kind !== "cafe") return false;
    } else if (isDiningPlace(place, classifyPlanPlaceKind) && !/咖啡/.test(slot.label)) {
      return false;
    }
  }
  if (/早餐/.test(slot.label) && !isProperRestaurantPlace(place) && !isCafePlace(place)) {
    return false;
  }
  if (/午餐|晚餐|宵夜/.test(slot.label) && !isDiningPlace(place, classifyPlanPlaceKind)) {
    if (!isProperRestaurantPlace(place) && !isNightMarketPlace(place)) return false;
  }
  if (
    !skipRouteConstraint &&
    !relaxConstraints &&
    day != null &&
    dayPlaces &&
    dayPlaces.length > 0
  ) {
    const route = passesDayRouteConstraint({
      place,
      dayPlaces,
      day,
      nearbyExtensions,
      nearbyDay: resolveNearbyExtensionDay(tripDays ?? day),
    });
    if (!route.ok) {
      logAiPipeline(
        "[AI_PLANNER_CANDIDATE_SKIP]",
        `day=${day}`,
        `name=${place.name}`,
        `reason=${route.reason ?? "route_too_far"}`,
      );
      return false;
    }
  }
  return true;
}

/**
 * 從已排序 Candidate Pool 挑選 slot 用地點。
 *
 * P2.2 + Flag ON：依 pool 順序消費，第一個通過約束者入選（不重排、不打分）。
 * Flag OFF：legacy theme 分數挑選（完整回退）。
 *
 * Contract: docs/raos/planner-contract.md
 */
export function pickPlaceForSlot(params: {
  pool: PlaceResult[];
  slot: DayPlanSlot;
  theme: DayThemeProfile;
  allocator: TripPlaceAllocator;
  day: number;
  budget: DaySlotBudget;
  plannedDate?: string;
  allowRepeat?: boolean;
  relaxConstraints?: boolean;
  dayPlaces?: PlaceResult[];
  nearbyExtensions?: string[];
  tripDays?: number;
  /** 容量補齊末段可暫時放寬 Route，避免空日 */
  skipRouteConstraint?: boolean;
}): PlaceResult | undefined {
  const {
    pool,
    slot,
    theme,
    allocator,
    day,
    budget,
    plannedDate,
    allowRepeat,
    relaxConstraints,
    dayPlaces,
    nearbyExtensions,
    tripDays,
    skipRouteConstraint,
  } = params;

  const constraintArgs = {
    slot,
    allocator,
    budget,
    plannedDate,
    allowRepeat,
    relaxConstraints,
    dayPlaces,
    day,
    tripDays,
    nearbyExtensions,
    skipRouteConstraint,
  };

  let picked: PlaceResult | undefined;

  if (isRecEnginePlannerEnabled()) {
    // P2.2：唯一消費順序 = Recommendation Engine 已排序的 pool
    for (const place of pool) {
      if (!passesPlannerSlotConstraints({ place, ...constraintArgs })) continue;
      picked = place;
      break;
    }
  } else {
    // Legacy 回退：theme 分數（非契約路徑；僅 Flag OFF）
    const candidates = pool
      .filter((place) => passesPlannerSlotConstraints({ place, ...constraintArgs }))
      .map((place) => ({ place, score: scorePlaceForTheme(place, theme) }))
      .sort((a, b) => b.score - a.score);
    picked = candidates[0]?.place;
  }

  if (!picked) return undefined;
  allocator.markUsed(picked, day);
  markDaySlotBudget(picked, budget);
  return picked;
}

function fillerSlotForKind(kind: PlanPlaceKind, index: number): DayPlanSlot {
  const times = ["09:00", "11:00", "14:30", "16:30", "18:00"];
  return {
    time: times[index % times.length] ?? "10:00",
    kind,
    label:
      kind === "restaurant"
        ? "午餐"
        : kind === "cafe"
          ? "咖啡"
          : "景點",
  };
}

/** Step2+5+8：依主題逐日分配，visitedPlaceIds 跨天累積 */
export function buildThemedMultiDayPlans(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
  startDay?: number;
  seedAllocator?: TripPlaceAllocator;
  tripDays?: number;
  nearbyExtensions?: string[];
  pace?: PlannerPaceHint;
}): ComposedDayPlan[] {
  const { places, style, days, plannedDate } = params;
  const safeDays = Math.max(1, days);
  const startDay = params.startDay ?? 1;
  const tripDays = params.tripDays ?? startDay + safeDays - 1;
  const pool = dedupeCandidatePlaces(filterExcludedRetailPlaces(places));
  const allocator = params.seedAllocator ?? new TripPlaceAllocator();
  const plans: ComposedDayPlan[] = [];
  const minPerDay = resolveAdaptiveMinPerDay(pool.length, tripDays);
  const dayPools = buildDayPreferredPools(pool, tripDays, params.nearbyExtensions);

  logAiPipeline("[AI_MULTI_DAY_BUILD_START]", `days=${safeDays}`, `pool=${pool.length}`, `startDay=${startDay}`);

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const day = startDay + dayIndex;
    const theme = resolveDayTheme(style, day - 1);
    const template = resolveStyleDaySlotTemplate(style, day);
    const budget = emptyDayBudget();
    const entries: DayPlanEntry[] = [];
    // 當日偏好池在前、其餘 Engine 順序在後（不重排分數）
    const preferred = dayPools.get(day) ?? [];
    const preferredIds = new Set(preferred.map((p) => resolveTripPlaceId(p)));
    const dayOrderedPool = [
      ...preferred,
      ...pool.filter((p) => !preferredIds.has(resolveTripPlaceId(p))),
    ];

    logAiPipeline("[AI_DAY_THEME]", `day=${day}`, `theme=${theme.theme}`);
    logAiPipeline("[AI_PLANNER_DAY_ASSIGN_COUNT]", `day=${day}`, `preferredPool=${preferred.length}`);

    for (const slot of template) {
      const dayPlaces = entries.map((e) => e.place);
      const place =
        pickPlaceForSlot({
          pool: dayOrderedPool,
          slot,
          theme,
          allocator,
          day,
          budget,
          plannedDate,
          dayPlaces,
          nearbyExtensions: params.nearbyExtensions,
          tripDays,
        }) ??
        pickPlaceForSlot({
          pool: dayOrderedPool,
          slot,
          theme,
          allocator,
          day,
          budget,
          plannedDate,
          dayPlaces,
          nearbyExtensions: params.nearbyExtensions,
          tripDays,
          skipRouteConstraint: true,
        });
      if (!place?.name) continue;
      entries.push({
        time: slot.time,
        label: resolveEntryLabel(slot, place),
        name: place.name,
        place,
      });
    }

    if (entries.length < minPerDay) {
      for (const kind of theme.preferKinds) {
        if (entries.length >= minPerDay) break;
        const slot = fillerSlotForKind(kind, entries.length);
        const dayPlaces = entries.map((e) => e.place);
        const place =
          pickPlaceForSlot({
            pool: dayOrderedPool,
            slot,
            theme,
            allocator,
            day,
            budget,
            plannedDate,
            dayPlaces,
            nearbyExtensions: params.nearbyExtensions,
            tripDays,
          }) ??
          pickPlaceForSlot({
            pool: dayOrderedPool,
            slot,
            theme,
            allocator,
            day,
            budget,
            plannedDate,
            dayPlaces,
            nearbyExtensions: params.nearbyExtensions,
            tripDays,
            skipRouteConstraint: true,
          });
        if (!place?.name) continue;
        entries.push({
          time: slot.time,
          label: resolveEntryLabel(slot, place),
          name: place.name,
          place,
        });
      }
    }

    plans.push({ day, entries });
    logAiPipeline(
      "[AI_DAY_VISITED_COUNT]",
      `day=${day}`,
      `visited=${allocator.usedPlaceIds.size}`,
      `entries=${entries.length}`,
      `minPerDay=${minPerDay}`,
    );
  }

  const assembled = applyPlannerRouteAndCapacityAssembly({
    plans,
    pool,
    days: safeDays,
    style,
    nearbyExtensions: params.nearbyExtensions,
    pace: params.pace,
  });
  return ensureAllDayPlansExist(assembled.plans as ComposedDayPlan[], safeDays);
}

export function countTripPlaceSlots(plans: ComposedDayPlan[]): number {
  return plans.reduce((n, plan) => n + plan.entries.length, 0);
}

export function countTripDuplicateSlots(plans: ComposedDayPlan[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const key = resolveTripPlaceId(entry.place);
      if (!key) continue;
      if (seen.has(key)) duplicates += 1;
      else seen.add(key);
    }
  }
  return duplicates;
}

export function tripDuplicateRate(plans: ComposedDayPlan[]): number {
  const total = countTripPlaceSlots(plans);
  if (total === 0) return 0;
  return countTripDuplicateSlots(plans) / total;
}

function findReplacementPlace(params: {
  pool: PlaceResult[];
  allocator: TripPlaceAllocator;
  day: number;
  slot: DayPlanSlot;
  theme: DayThemeProfile;
  plannedDate?: string;
}): PlaceResult | undefined {
  const budget = emptyDayBudget();
  return pickPlaceForSlot({
    pool: params.pool,
    slot: params.slot,
    theme: params.theme,
    allocator: params.allocator,
    day: params.day,
    budget,
    plannedDate: params.plannedDate,
  });
}

/** Step9：全域驗證並以候補景點替換重複 */
export function repairTripDuplicatePlaces(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
  maxDuplicateRate?: number;
}): ComposedDayPlan[] {
  const { pool, days, style, plannedDate } = params;
  const maxRate = params.maxDuplicateRate ?? MAX_TRIP_DUPLICATE_RATE;
  let current = ensureAllDayPlansExist(params.plans, days);
  let validation = validateTripPlaceUniqueness(current, days);
  let attempts = 0;

  while (!validation.ok && attempts < days * 3) {
    attempts += 1;
    const duplicateIds = new Set(validation.duplicatePlaceIds);
    const failedDays = new Set(validation.failedDays);
    const allocator = new TripPlaceAllocator();
    seedTripAllocatorFromPlans(allocator, current, [...failedDays]);

    let changed = false;
    current = current.map((plan) => {
      if (!failedDays.has(plan.day)) return plan;
      const theme = resolveDayTheme(style, plan.day - 1);
      const entries = plan.entries.map((entry) => ({ ...entry }));
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]!;
        const key = resolveTripPlaceId(entry.place);
        if (!key || !duplicateIds.has(key)) continue;
        const slot: DayPlanSlot = {
          time: entry.time,
          kind: classifyPlanPlaceKind(entry.place),
          label: entry.label,
        };
        const replacement = findReplacementPlace({
          pool,
          allocator,
          day: plan.day,
          slot,
          theme,
          plannedDate,
        });
        if (replacement) {
          entries[i] = {
            ...entry,
            name: replacement.name,
            place: replacement,
          };
          changed = true;
        }
      }
      return { day: plan.day, entries };
    });

    if (!changed) break;
    current = ensureAllDayPlansExist(current, days);
    validation = validateTripPlaceUniqueness(current, days);
  }

  const rate = tripDuplicateRate(current);
  logAiPipeline(
    "[AI_GLOBAL_VALIDATION]",
    `ok=${validation.ok}`,
    `duplicateRate=${rate.toFixed(2)}`,
    `max=${maxRate}`,
  );

  if (rate > maxRate) {
    logAiPipeline("[AI_GLOBAL_VALIDATION]", "reason=duplicate_rate_exceeded");
  }

  return current;
}

/** assign / validation 後若某天項目不足，從 pool 依 slot 模板補滿 */
export function ensureDayPlansMeetMinimum(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
  nearbyExtensions?: string[];
  pace?: PlannerPaceHint;
}): ComposedDayPlan[] {
  const minPerDay = minItemsPerDayForTrip(params.days);
  const pool = dedupeCandidatePlaces(filterExcludedRetailPlaces(filterRealPlanningPlaces(params.pool)));
  let current = ensureAllDayPlansExist(params.plans, params.days);

  current = fillSparseDaysWithControlledRepeats({
    plans: current,
    pool,
    days: params.days,
    style: params.style,
    plannedDate: params.plannedDate,
  });

  current = refillMissingDaySlots({
    plans: current,
    pool,
    days: params.days,
    style: params.style,
    plannedDate: params.plannedDate,
  });

  const total = plannerTotalPlaces(current);
  if (total < params.days * minPerDay && pool.length > 0) {
    logAiPipeline(
      "[AI_DAY_PLAN_REFILL]",
      `before=${total}`,
      `target=${params.days * minPerDay}`,
      `pool=${pool.length}`,
    );
    const themed = buildThemedMultiDayPlans({
      places: pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
      nearbyExtensions: params.nearbyExtensions,
      pace: params.pace,
    });
    current = preferBetterComposedPlans(themed, current, params.days, params.style);
    current = fillSparseDaysWithControlledRepeats({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
    current = refillMissingDaySlots({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  const assembled = applyPlannerRouteAndCapacityAssembly({
    plans: current,
    pool,
    days: params.days,
    style: params.style,
    nearbyExtensions: params.nearbyExtensions,
    pace: params.pace,
  });
  current = ensureAllDayPlansExist(assembled.plans as ComposedDayPlan[], params.days);

  current = repairTripDuplicatePlaces({
    plans: current,
    pool,
    days: params.days,
    style: params.style,
    plannedDate: params.plannedDate,
  });

  return ensureAllDayPlansExist(current, params.days);
}

/** 逐日依 slot key 補齊缺少的固定 7-slot 結構 */
export function refillMissingDaySlots(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const pool = dedupeCandidatePlaces(filterExcludedRetailPlaces(filterRealPlanningPlaces(params.pool)));
  const slotPools = buildItinerarySlotPools(pool);
  const template = resolveStyleDaySlotTemplate(params.style, 1);
  const allocator = new TripPlaceAllocator();
  seedTripAllocatorFromPlans(allocator, params.plans);

  logUsedPlaceSummary({
    totalCandidates: pool.length,
    pool,
    plans: params.plans,
  });

  const globalUsed = new Set<string>();

  return ensureAllDayPlansExist(params.plans, params.days).map((plan) => {
    const minPerDay = minItemsPerDayForTrip(params.days);
    const hasAllSlotTimes = template.every((slot) =>
      plan.entries.some((entry) => entry.time === slot.time),
    );
    if (plan.entries.length >= minPerDay && hasAllSlotTimes) {
      return plan;
    }

    const before = plan.entries.length;
    const byTime = new Map(plan.entries.map((entry) => [entry.time, entry]));
    const byLabel = new Map<string, DayPlanEntry[]>();
    for (const entry of plan.entries) {
      const list = byLabel.get(entry.label) ?? [];
      list.push(entry);
      byLabel.set(entry.label, list);
    }

    const entries: DayPlanEntry[] = [];
    const missingKeys: string[] = [];
    const budget = emptyDayBudget();
    const theme = resolveDayTheme(params.style, plan.day - 1);

    template.forEach((slot, index) => {
      let entry = byTime.get(slot.time);
      if (!entry) {
        const labelMatches = byLabel.get(slot.label) ?? [];
        entry = labelMatches.find((candidate) => {
          const id = resolveTripPlaceId(candidate.place);
          return id && !globalUsed.has(id);
        });
      }
      if (entry?.name) {
        const id = resolveTripPlaceId(entry.place);
        if (id && !globalUsed.has(id)) {
          globalUsed.add(id);
          markDaySlotBudget(entry.place, budget);
          allocator.markUsed(entry.place, plan.day);
          entries.push({
            time: slot.time,
            label: resolveEntryLabel(slot, entry.place),
            name: entry.name,
            place: entry.place,
          });
          return;
        }
      }

      const key = SLOT_POOL_KEYS[index] ?? `slot_${index}`;
      missingKeys.push(key);
      const slotPool = poolForSlotKey(key as (typeof SLOT_POOL_KEYS)[number], slotPools, pool);
      const unusedForSlot = slotPool.filter((candidate) => !allocator.isUsed(candidate));
      const allowRepeat = unusedForSlot.length === 0 && pool.filter((candidate) => !allocator.isUsed(candidate)).length === 0;
      const place =
        pickPlaceForSlot({
          pool: unusedForSlot.length ? unusedForSlot : slotPool,
          slot,
          theme,
          allocator,
          day: plan.day,
          budget,
          plannedDate: params.plannedDate,
        }) ??
        pickPlaceForSlot({
          pool: unusedForSlot.length ? unusedForSlot : slotPool,
          slot,
          theme,
          allocator,
          day: plan.day,
          budget,
          plannedDate: params.plannedDate,
          relaxConstraints: true,
        }) ??
        pickPlaceForSlot({
          pool: pool.filter((candidate) => !allocator.isUsed(candidate)),
          slot,
          theme,
          allocator,
          day: plan.day,
          budget,
          plannedDate: params.plannedDate,
          relaxConstraints: true,
        }) ??
        (allowRepeat
          ? pickPlaceForSlot({
              pool,
              slot,
              theme,
              allocator,
              day: plan.day,
              budget,
              plannedDate: params.plannedDate,
              allowRepeat: true,
              relaxConstraints: true,
            })
          : undefined);

      if (!place?.name) return;
      const beforePlaces = entries.map((existing) => existing.place);
      entries.push({
        time: slot.time,
        label: resolveEntryLabel(slot, place),
        name: place.name,
        place,
      });
      const family = classifyDailyDiversityCategory(place);
      const limits = resolveDailyDiversityLimits({ style: params.style });
      const cap = family in limits
        ? limits[family as keyof typeof limits]
        : Number.POSITIVE_INFINITY;
      const beforeFamilyCount = beforePlaces.filter(
        (candidate) => classifyDailyDiversityCategory(candidate) === family,
      ).length;
      logAiPipeline(
        "[DAY_SLOT_REFILL_APPLY]",
        `day=${plan.day}`,
        `slot=${key}`,
        `placeId=${place.id}`,
        `placeName=${place.localizedDisplayName ?? place.name}`,
        `family=${family}`,
        `primaryType=${place.primaryType ?? ""}`,
        `beforeSummary=${formatDailyDiversityFamilySummary(beforePlaces)}`,
        `afterSummary=${formatDailyDiversityFamilySummary(entries.map((existing) => existing.place))}`,
        `introducedOverflow=${Number.isFinite(cap) && beforeFamilyCount + 1 > cap}`,
      );
    });

    const sorted = dedupeEntryTimes(entries);
    const after = sorted.length;
    if (after < before && before >= minPerDay) {
      return plan;
    }
    if (missingKeys.length) {
      console.warn(
        "[DAY_SLOT_REFILL]",
        `day=${plan.day}`,
        `before=${before}`,
        `missing=${missingKeys.join(",")}`,
        `added=${Math.max(0, after - before)}`,
        `after=${after}`,
      );
    }
    // P1 Step 1: never leave a partial / singleton day after refill — empty is honest.
    if (after > 0 && after < minPerDay) {
      logAiPipeline(
        "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
        `day=${plan.day}`,
        "action=clear_partial_day_no_singleton",
        `have=${after}`,
        `need=${minPerDay}`,
        "sourceFunction=refillMissingDaySlots",
      );
      return { day: plan.day, entries: [] };
    }
    return { day: plan.day, entries: sorted };
  });
}

/** Step4：候選不足時，允許少量重複（≤20%）補滿空白天 */
export function fillSparseDaysWithControlledRepeats(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const { pool, days, plannedDate } = params;
  const style = resolvePlannerStyleKey(params.style);
  const minPerDay = minItemsPerDayForTrip(days);
  let current = ensureAllDayPlansExist(params.plans, days);
  const maxRepeats = Math.floor(countTripPlaceSlots(current) * MAX_TRIP_DUPLICATE_RATE);
  let repeatBudget = Math.max(1, maxRepeats - countTripDuplicateSlots(current));
  const allocator = new TripPlaceAllocator();
  seedTripAllocatorFromPlans(allocator, current);

  current = current.map((plan) => {
    if (plan.entries.length >= minPerDay) return plan;
    const theme = resolveDayTheme(style, plan.day - 1);
    // Must use Map-safe helper — never STYLE_DAY_SLOT_TEMPLATES[style][plan.day-1]
    // (illegal style keys throw: undefined is not an object evaluating '[...][plan.day-1]').
    const template = resolveStyleDaySlotTemplate(style, plan.day);
    const budget = emptyDayBudget();
    for (const entry of plan.entries) markDaySlotBudget(entry.place, budget);
    const entries = [...plan.entries];

    for (const slot of template) {
      if (entries.length >= minPerDay || entries.length >= template.length) break;
      const place = pickPlaceForSlot({
        pool,
        slot,
        theme,
        allocator,
        day: plan.day,
        budget,
        plannedDate,
        allowRepeat: repeatBudget > 0,
      });
      if (!place) continue;
      if (allocator.usedPlaceIds.has(resolveTripPlaceId(place))) {
        repeatBudget -= 1;
        logAiPipeline("[AI_CONTROLLED_REPEAT]", `day=${plan.day}`, `name=${place.name}`);
      }
      entries.push({
        time: slot.time,
        label: resolveEntryLabel(slot, place),
        name: place.name,
        place,
      });
    }
    return { day: plan.day, entries };
  });

  return ensureAllDayPlansExist(current, days);
}

export function finalizeMultiDayItinerary(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const pool = dedupeCandidatePlaces(params.pool);
  let current = ensureAllDayPlansExist(params.plans, params.days);

  if (plannerPopulatedDayCount(current, params.days) < params.days) {
    current = ensureEveryDayPopulated({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  const uniqueness = validateTripPlaceUniqueness(current, params.days);
  if (!uniqueness.ok && tripDuplicateRate(current) <= MAX_TRIP_DUPLICATE_RATE) {
    // 少量重複可接受，不重分配
  } else if (!uniqueness.ok) {
    current = repairTripDuplicatePlaces({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  if (plannerPopulatedDayCount(current, params.days) < params.days) {
    current = ensureEveryDayPopulated({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  const adaptiveMin = resolveAdaptiveMinPerDay(
    plannerTotalPlaces(current) + pool.length,
    params.days,
  );
  const sparseDays = current.filter((plan) => plan.entries.length < adaptiveMin);
  if (sparseDays.length && isPlannerPoolSufficient(pool.length, params.days)) {
    current = fillSparseDaysWithControlledRepeats({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  if (plannerPopulatedDayCount(current, params.days) < params.days) {
    current = ensureEveryDayPopulated({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  return current;
}

export function logMultiDayCandidatePool(count: number, days: number): void {
  logAiPipeline(
    "[AI_CANDIDATE_POOL]",
    `count=${count}`,
    `target=${minCandidatePoolSize(days)}`,
  );
}

export type { TripPlaceUniquenessValidation };
