import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import {
  STYLE_DAY_SLOT_TEMPLATES,
  classifyPlanPlaceKind,
  canPlaceFillSlot,
  ensureAllDayPlansExist,
  flattenComposedDayPlanPlaces,
  minItemsPerDayForTrip,
  plannerPopulatedDayCount,
  plannerTotalPlaces,
  preferBetterComposedPlans,
  resolveEntryLabel,
  type ComposedDayPlan,
  type DayPlanEntry,
  type DayPlanSlot,
  type PlanPlaceKind,
} from "@/lib/ai/ai-day-plan-source";
import {
  filterExcludedRetailPlaces,
  isCafePlace,
  isDiningPlace,
  isExcludedRetailPlace,
  isLargeMallPlace,
  isNightMarketPlace,
  isProperRestaurantPlace,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  TripPlaceAllocator,
  isGeocodeEmptyPlace,
  resolveTripPlaceId,
  seedTripAllocatorFromPlans,
  validateTripPlaceUniqueness,
  type TripPlaceUniquenessValidation,
} from "@/lib/ai/ai-trip-place-allocator";
import { dedupeParentLandmarkPlaces } from "@/lib/ai/ai-parent-landmark-dedup";
import { filterRealPlanningPlaces } from "@/lib/ai/planning-real-place";

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
  if (poolSize <= 0) return minRenderableItemsPerDay(days);
  if (poolSize >= days * ideal) return ideal;
  if (!isPlannerPoolSufficient(poolSize, days)) return minRenderableItemsPerDay(days);
  return Math.max(minRenderableItemsPerDay(days), Math.floor(poolSize / days));
}

export function canEvenlyMeetMinPerDay(poolSize: number, days: number): boolean {
  return Math.floor(poolSize / Math.max(1, days)) >= minRenderableItemsPerDay(days);
}

function distributeSlotForPlace(
  place: PlaceResult,
  index: number,
  style: TripStyleKey,
): DayPlanSlot {
  const template =
    STYLE_DAY_SLOT_TEMPLATES[style][0] ??
    STYLE_DAY_SLOT_TEMPLATES.mixed[0] ??
    [];
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

/** 候選不足時：將 Place Pool 平均分散至所有天（8 places / 5 days → 2,2,2,1,1） */
export function redistributePlacesEvenly(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const safeDays = Math.max(1, params.days);
  const pool = dedupeCandidatePlaces(
    filterExcludedRetailPlaces(params.places).filter((p) => p.name?.trim()),
  );
  if (!pool.length) {
    return ensureAllDayPlansExist([], safeDays);
  }

  const base = Math.floor(pool.length / safeDays);
  const extra = pool.length % safeDays;
  const perDayCounts = Array.from({ length: safeDays }, (_, i) => base + (i < extra ? 1 : 0));

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

  if (!isPlannerPoolSufficient(mergedPool.length, params.days)) {
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
    "strategy=redistribute",
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
  const safeDays = Math.max(1, days);
  const pool = dedupeCandidatePlaces(filterRealPlanningPlaces(places));
  if (pool.length < minCandidatePoolSize(safeDays)) return false;
  return (
    countDiningPoolPlaces(pool) >= minDiningPoolSize(safeDays) &&
    countScenicPoolPlaces(pool) >= minScenicPoolSize(safeDays)
  );
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
  return dedupeParentLandmarkPlaces(out);
}

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ");
}

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

function pickPlaceForSlot(params: {
  pool: PlaceResult[];
  slot: DayPlanSlot;
  theme: DayThemeProfile;
  allocator: TripPlaceAllocator;
  day: number;
  budget: DaySlotBudget;
  plannedDate?: string;
  allowRepeat?: boolean;
}): PlaceResult | undefined {
  const { pool, slot, theme, allocator, day, budget, plannedDate, allowRepeat } = params;
  const candidates = pool
    .filter((place) => {
      if (!place.name?.trim()) return false;
      if (isGeocodeEmptyPlace(place)) return false;
      if (isExcludedRetailPlace(place)) return false;
      if (!allowRepeat && allocator.isUsed(place)) return false;
      if (exceedsDaySlotBudget(place, budget)) return false;
      if (!canPlaceFillSlot(place, slot, plannedDate)) return false;
      if (/早餐/.test(slot.label) && !isProperRestaurantPlace(place) && !isCafePlace(place)) {
        return false;
      }
      if (/午餐|晚餐|宵夜/.test(slot.label) && !isDiningPlace(place, classifyPlanPlaceKind)) {
        if (!isProperRestaurantPlace(place) && !isNightMarketPlace(place)) return false;
      }
      return true;
    })
    .map((place) => ({ place, score: scorePlaceForTheme(place, theme) }))
    .sort((a, b) => b.score - a.score);

  const picked = candidates[0]?.place;
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
          : kind === "market"
            ? "市場"
            : kind === "shopping"
              ? "街區"
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
}): ComposedDayPlan[] {
  const { places, style, days, plannedDate } = params;
  const safeDays = Math.max(1, days);
  const startDay = params.startDay ?? 1;
  const tripDays = params.tripDays ?? startDay + safeDays - 1;
  const pool = dedupeCandidatePlaces(filterExcludedRetailPlaces(places));
  const allocator = params.seedAllocator ?? new TripPlaceAllocator();
  const plans: ComposedDayPlan[] = [];
  const minPerDay = resolveAdaptiveMinPerDay(pool.length, tripDays);

  logAiPipeline("[AI_MULTI_DAY_BUILD_START]", `days=${safeDays}`, `pool=${pool.length}`, `startDay=${startDay}`);

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const day = startDay + dayIndex;
    const theme = resolveDayTheme(style, day - 1);
    const template =
      STYLE_DAY_SLOT_TEMPLATES[style][(day - 1) % STYLE_DAY_SLOT_TEMPLATES[style].length] ??
      STYLE_DAY_SLOT_TEMPLATES[style][0] ??
      STYLE_DAY_SLOT_TEMPLATES.mixed[0]!;
    const budget = emptyDayBudget();
    const entries: DayPlanEntry[] = [];

    logAiPipeline("[AI_DAY_THEME]", `day=${day}`, `theme=${theme.theme}`);

    for (const slot of template) {
      const place = pickPlaceForSlot({
        pool,
        slot,
        theme,
        allocator,
        day,
        budget,
        plannedDate,
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
        const place = pickPlaceForSlot({
          pool,
          slot,
          theme,
          allocator,
          day,
          budget,
          plannedDate,
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

  return ensureAllDayPlansExist(plans, safeDays);
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
    });
    current = preferBetterComposedPlans(themed, current, params.days);
    current = fillSparseDaysWithControlledRepeats({
      plans: current,
      pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }

  return ensureAllDayPlansExist(current, params.days);
}

/** Step4：候選不足時，允許少量重複（≤20%）補滿空白天 */
export function fillSparseDaysWithControlledRepeats(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const { pool, days, style, plannedDate } = params;
  const minPerDay = minItemsPerDayForTrip(days);
  let current = ensureAllDayPlansExist(params.plans, days);
  const maxRepeats = Math.floor(countTripPlaceSlots(current) * MAX_TRIP_DUPLICATE_RATE);
  let repeatBudget = Math.max(1, maxRepeats - countTripDuplicateSlots(current));
  const allocator = new TripPlaceAllocator();
  seedTripAllocatorFromPlans(allocator, current);

  current = current.map((plan) => {
    if (plan.entries.length >= minPerDay) return plan;
    const theme = resolveDayTheme(style, plan.day - 1);
    const template =
      STYLE_DAY_SLOT_TEMPLATES[style][plan.day - 1] ??
      STYLE_DAY_SLOT_TEMPLATES[style][0] ??
      STYLE_DAY_SLOT_TEMPLATES.mixed[0]!;
    const budget = emptyDayBudget();
    for (const entry of plan.entries) markDaySlotBudget(entry.place, budget);
    const entries = [...plan.entries];

    for (const slot of template) {
      if (entries.length >= minPerDay) break;
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
