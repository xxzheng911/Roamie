import type { PlaceResult } from "@/lib/place-result";
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem, normalizeRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceItem } from "@/lib/chat-session";
import type { TripCreateDates } from "@/lib/ai/resolve-trip-create-dates";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  CHAT_DAY_PLAN_MAX_PER_DAY,
  CHAT_DAY_PLAN_MIN_PER_DAY,
  parseTripStyleKey,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { classifyTripPlaceCategory, type TripPlaceCategory } from "@/lib/ai/trip-place-scoring";
import {
  logAiBuildDayPlanStart,
  logAiDayPlanFinalSummary,
  logAiDayPlanItemAdded,
  logPlannerAssign,
  logPlannerOverwriteBlocked,
  logPlannerResult,
  logPlannerSplit,
} from "@/lib/ai/normalize-planning-places";
import {
  buildStructuredDayPlans,
  canPlaceFillSlotByCategory,
  filterExcludedRetailPlaces,
  isBarBistroPlace,
  isCafePlace,
  isCultureCreativeAreaPlace,
  isDayMealsOnly,
  isDiningPlace,
  isExcludedRetailPlace,
  isExplicitCafePlace,
  isFoodVenuePlace,
  isLargeMallPlace,
  isMarketPlace,
  isMuseumCulturePlace,
  isMealSlotEligiblePlace,
  isNightMarketPlace,
  isNonMealActivitySlot,
  isProperRestaurantPlace,
  logAiDayPlanRebuildReason,
  logAiDayRebuildNonMeal,
  logAiDayRebuildRetailExcluded,
  logAiNonMealSlotMissing,
  logAiStyleCompositionFail,
  logAiCategoryLabelFix,
  dedupeEntryTimes,
  repairDayPlanSlots,
  resolvePlaceCategoryLabel,
  scenicKindsForStyle,
  sortComposedDayPlans,
  stripExcludedRetailFromDayPlans,
  validateItinerary,
  validateNoExcludedRetailPlaces,
  validatePlaceOpenAtTime,
  validateCompleteItinerary,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  buildClassicLandmarkDayPlans,
  validateClassicLandmarkTrip,
} from "@/lib/ai/ai-classic-landmark-scheduler";
import {
  buildLocalLifeDayPlans,
  rebuildLocalLifeDayPlan,
  rebuildLocalLifeIncompleteDays,
  validateTripNoDuplicate,
} from "@/lib/ai/ai-local-life-scheduler";
import {
  buildThemedMultiDayPlans,
  canEvenlyMeetMinPerDay,
  countDiningPoolPlaces,
  countScenicPoolPlaces,
  ensureDayPlansMeetMinimum,
  ensureEveryDayPopulated,
  evaluatePlannerPoolGate,
  finalizeMultiDayItinerary,
  isPlannerPoolReady,
  isPlannerPoolSufficient,
  logMultiDayCandidatePool,
  minCandidatePoolSize,
  minRenderableItemsPerDay,
  redistributePlacesEvenly,
  resolveDayTheme,
  tripDuplicateRate,
  MAX_TRIP_DUPLICATE_RATE,
} from "@/lib/ai/ai-multi-day-planner";
import {
  TripPlaceAllocator,
  dedupePlaceCardsForRender,
  seedTripAllocatorFromPlans,
  validateTripPlaceUniqueness,
  resolveTripPlaceId,
  isGeocodeEmptyPlace,
} from "@/lib/ai/ai-trip-place-allocator";
import {
  buildLocalLifeCityFallbackPlaces,
  filterPlacesForLocalLife,
  isLocalLifeDistrictCandidate,
  isLocalLifeExcludedPlace,
  isLocalLifePlanningCandidate,
  LOCAL_LIFE_MIN_ITEMS_PER_DAY,
} from "@/lib/ai/ai-local-life-rules";
import {
  CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY,
  CLASSIC_LANDMARK_MIN_ITEMS_PER_DAY,
  canFillClassicLandmarkSlot,
  filterPlacesForClassicLandmark,
  isClassicLandmarkScenicCandidate,
  isExcludedFromClassicLandmarkScenic,
  logClassicDayRebuild,
  placeMatchesClassicDayRegion,
  sortClassicLandmarkPlaces,
  validateClassicLandmarkItinerary,
} from "@/lib/ai/ai-classic-landmark-rules";
import {
  filterRealPlanningPlaces,
  isAllowedItinerarySlotLabel,
  isPlaceholderPlanningPlaceName,
  isRealGooglePlanningPlace,
  normalizeItineraryEntryLabel,
  STANDARD_ITINERARY_DAY_SLOTS,
} from "@/lib/ai/planning-real-place";

/** 慢遊 fallback：每天至少 2 個地點 */
export const CHAT_DAY_PLAN_SLOW_MIN_PER_DAY = 3;

export function destinationSearchVariants(destination: string): string[] {
  const zh = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[zh];
  const variants = [zh, `${zh}市`];
  if (en && en !== zh) {
    variants.push(en, `${en} City`);
  }
  return [...new Set(variants.filter(Boolean))];
}

export function logAiPlaceSearchRetry(reason: string, query: string): void {
  logAiPipeline("[AI_PLACE_SEARCH_RETRY]", `reason=${reason}`, `query=${query}`);
}

export function logAiPlaceSearchFallback(type: string): void {
  logAiPipeline("[AI_PLACE_SEARCH_FALLBACK]", `type=${type}`);
}

export function logAiDayPlanRebuild(): void {
  logAiPipeline("[AI_DAY_PLAN_REBUILD]");
}

export function logAiDayPlanFinalValidate(
  days: number,
  ok: boolean,
  minPerDay: number,
  sparseDays: number[],
): void {
  logAiPipeline(
    "[AI_DAY_PLAN_FINAL_VALIDATE]",
    `days=${days}`,
    `ok=${ok}`,
    `minPerDay=${minPerDay}`,
    `sparse=${sparseDays.join(",") || "none"}`,
  );
}

export function countScenicPlaces(places: PlaceResult[]): number {
  const buckets = bucketPlacesByKind(places);
  return buckets.attraction.length + buckets.nature.length + buckets.culture.length;
}

export function buildAttractionSupplementAttempts(destination: string): SearchAttempt[] {
  const variants = destinationSearchVariants(destination);
  const attempts: SearchAttempt[] = [];

  for (const v of variants) {
    const isLatin = /^[A-Za-z]/.test(v);
    if (isLatin) {
      attempts.push(
        { query: `${v} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${v} scenic spots`, mode: "text", includedTypes: ["tourist_attraction", "natural_feature", "park"] },
        { query: `${v} museums`, mode: "text", includedTypes: ["museum", "art_gallery"] },
        { query: `${v} parks`, mode: "text", includedTypes: ["park", "natural_feature"] },
        { query: `${v} night market`, mode: "text", includedTypes: ["restaurant", "market"] },
      );
    } else {
      attempts.push(
        { query: `${v} 景點`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${v} 美食`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${v} 咖啡`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
        { query: `${v} 自然景點`, mode: "text", includedTypes: ["park", "natural_feature", "tourist_attraction"] },
        { query: `${v} 博物館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
        { query: `${v} 夜市`, mode: "text", includedTypes: ["restaurant", "market"] },
      );
    }
  }

  return [...new Map(attempts.map((a) => [a.query, a])).values()];
}

export type PlanPlaceKind =
  | "attraction"
  | "restaurant"
  | "cafe"
  | "shopping"
  | "market"
  | "culture"
  | "nature"
  | "night_market";

export type DayPlanSlot = {
  time: string;
  kind: PlanPlaceKind;
  label: string;
};

export type DayPlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

export type ComposedDayPlan = {
  day: number;
  entries: DayPlanEntry[];
  /** 該日景點未達最低門檻時為 true（仍保留在輸出中） */
  isIncomplete?: boolean;
};

export type DayPlanBucketWithEntries = {
  day: number;
  names: string[];
  entries: DayPlanEntry[];
};

export const TRIP_STYLE_COMPOSITION: Record<
  TripStyleKey,
  Partial<Record<PlanPlaceKind, number>>
> = {
  classic_landmarks: {
    attraction: 70,
    culture: 50,
    nature: 40,
    restaurant: 20,
    cafe: 10,
  },
  local_life: {
    shopping: 40,
    culture: 30,
    attraction: 15,
    cafe: 15,
    restaurant: 10,
  },
  slow_nature: {
    nature: 40,
    attraction: 40,
    culture: 20,
    cafe: 20,
    restaurant: 20,
  },
  mixed: {
    attraction: 40,
    culture: 25,
    shopping: 15,
    restaurant: 25,
    cafe: 10,
    night_market: 10,
  },
};

export const STYLE_ITEMS_PER_DAY: Record<TripStyleKey, { min: number; max: number }> = {
  classic_landmarks: { min: 7, max: 8 },
  local_life: { min: 7, max: 8 },
  slow_nature: { min: 7, max: 8 },
  mixed: { min: 7, max: 8 },
};

/** 依總天數決定每日最低行程點：完整日程 7 項（3 天以上） */
export function minItemsPerDayForTrip(days: number): number {
  return Math.max(1, days) >= 3 ? 7 : 5;
}

export function logAiDayCountValidate(
  requestedDays: number,
  plans: ComposedDayPlan[],
): { ok: boolean; generatedDays: number; dayCounts: Record<number, number> } {
  const normalized = ensureAllDayPlansExist(plans, requestedDays);
  const dayCounts = Object.fromEntries(
    normalized.map((plan) => [plan.day, plan.entries.length]),
  ) as Record<number, number>;
  const generatedDays = normalized.length;
  const ok = requestedDays === generatedDays;
  logAiPipeline("[AI_DAY_COUNT_VALIDATE]", {
    requestedDays,
    generatedDays,
    dayCounts,
  });
  return { ok, generatedDays, dayCounts };
}

export type GeneratedDaysValidation = {
  ok: boolean;
  reasons: string[];
  incompleteDays: number[];
};

const ITINERARY_PLACEHOLDER_RE = /行程生成中/;

export function logAiIncompleteDayDetected(day: number, count: number, reason: string): void {
  logAiPipeline("[AI_INCOMPLETE_DAY_DETECTED]", `day=${day}`, `count=${count}`, `reason=${reason}`);
}

export function logAiRebuildIncompleteDay(days: number[], reason: string): void {
  logAiPipeline("[AI_REBUILD_INCOMPLETE_DAY]", `days=${days.join(",")}`, `reason=${reason}`);
}

export function logAiRenderBlockedIncompleteDay(
  requestedDays: number,
  reasons: string[],
  dayCounts: Record<number, number>,
): void {
  logAiPipeline("[AI_RENDER_BLOCKED_INCOMPLETE_DAY]", {
    requestedDays,
    reasons,
    dayCounts,
  });
}

function parseEntryMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function localLifeDayHasRequiredComposition(_entries: DayPlanEntry[]): boolean {
  // local_life 僅影響候選排序權重，不作額外 composition 驗證
  return true;
}

function dedupePlanningPlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const place of places) {
    const id = resolveTripPlaceId(place);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(place);
  }
  return out;
}

function ensureLocalLifePlanningPool(params: {
  places: PlaceResult[];
  destination: string;
  days: number;
  lat?: number;
  lng?: number;
}): PlaceResult[] {
  const minPool = params.days * minItemsPerDayForTrip(params.days);
  let safePlaces = filterPlacesForLocalLife(filterExcludedRetailPlaces(params.places));
  if (safePlaces.length >= minPool) return safePlaces;

  const existingNames = new Set(safePlaces.map((p) => (p.name ?? "").trim()).filter(Boolean));
  if (params.lat != null && params.lng != null) {
    const backup = buildLocalLifeCityFallbackPlaces({
      destination: params.destination,
      lat: params.lat,
      lng: params.lng,
      minCount: minPool - safePlaces.length,
      existingNames,
    });
    safePlaces = dedupePlanningPlaces([...safePlaces, ...backup]);
  }

  if (safePlaces.length < minPool) {
    const seen = new Set(safePlaces.map((p) => resolveTripPlaceId(p)));
    for (const place of filterExcludedRetailPlaces(params.places)) {
      const id = resolveTripPlaceId(place);
      if (!id || seen.has(id) || isGeocodeEmptyPlace(place)) continue;
      if (!isLocalLifePlanningCandidate(place)) continue;
      safePlaces.push(place);
      seen.add(id);
      if (safePlaces.length >= minPool) break;
    }
  }

  return safePlaces;
}

function dayCountsFromPlans(plans: ComposedDayPlan[]): Record<number, number> {
  return Object.fromEntries(plans.map((plan) => [plan.day, plan.entries.length])) as Record<number, number>;
}

export function validateGeneratedDays(
  dayPlans: ComposedDayPlan[],
  requestedDays: number,
  style?: TripStyleKey,
): GeneratedDaysValidation {
  const minItems = minItemsPerDayForTrip(requestedDays);
  const normalized = ensureAllDayPlansExist(dayPlans, requestedDays);
  const reasons: string[] = [];
  const incompleteDays: number[] = [];

  if (normalized.length !== requestedDays) {
    reasons.push(`day_count_mismatch:${normalized.length}!=${requestedDays}`);
  }

  const maxPerDay = minItemsPerDayForTrip(requestedDays);

  for (const plan of normalized) {
    const count = plan.entries.length;
    logDaySlotValidation(plan.day, plan.entries);

    if (count === 0) {
      reasons.push(`empty_day:${plan.day}`);
      incompleteDays.push(plan.day);
      logAiIncompleteDayDetected(plan.day, 0, "empty_day");
    } else if (count === 1) {
      reasons.push(`single_item_day:${plan.day}`);
      incompleteDays.push(plan.day);
      logAiIncompleteDayDetected(plan.day, 1, "single_item_day");
    } else if (count < minItems) {
      reasons.push(`sparse_day:${plan.day}:${count}<${minItems}`);
      incompleteDays.push(plan.day);
      logAiIncompleteDayDetected(plan.day, count, `sparse:${count}<${minItems}`);
    } else if (count > maxPerDay) {
      reasons.push(`overflow_day:${plan.day}:${count}>${maxPerDay}`);
      incompleteDays.push(plan.day);
      logAiIncompleteDayDetected(plan.day, count, `overflow:${count}>${maxPerDay}`);
    }

    const hasPlaceholder = plan.entries.some(
      (e) => ITINERARY_PLACEHOLDER_RE.test(e.name) || isPlaceholderPlanningPlaceName(e.name),
    );
    if (hasPlaceholder) {
      reasons.push(`placeholder_day:${plan.day}`);
      incompleteDays.push(plan.day);
      logAiIncompleteDayDetected(plan.day, count, "placeholder_text");
    }

    if (style === "local_life" && count >= minItems && !localLifeDayHasRequiredComposition(plan.entries)) {
      reasons.push(`local_life_composition:day${plan.day}`);
      incompleteDays.push(plan.day);
      logAiIncompleteDayDetected(plan.day, count, "local_life_composition");
    }
  }

  const dayCountCheck = logAiDayCountValidate(requestedDays, normalized);
  if (!dayCountCheck.ok) {
    reasons.push(`generated_days:${dayCountCheck.generatedDays}!=${requestedDays}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    incompleteDays: [...new Set(incompleteDays)],
  };
}

export function rebuildIncompleteDays(
  plans: ComposedDayPlan[],
  incompleteDays: number[],
  places: PlaceResult[],
  style: TripStyleKey,
  destination?: string,
  days?: number,
): ComposedDayPlan[] {
  if (!incompleteDays.length) return plans;
  logAiRebuildIncompleteDay(incompleteDays, style);

  if (style === "local_life" && destination && days) {
    return rebuildLocalLifeIncompleteDays({
      plans,
      incompleteDays,
      places,
      destination,
      days,
    });
  }

  const failed = new Set(incompleteDays);
  const allocator = new TripPlaceAllocator();
  seedTripAllocatorFromPlans(allocator, plans, incompleteDays);

  return plans.map((plan) => {
    if (!failed.has(plan.day)) return plan;
    const themed = buildThemedMultiDayPlans({
      places: allocator.filterPool(places),
      days: 1,
      style,
      startDay: plan.day,
      tripDays: days,
      seedAllocator: allocator,
    });
    const rebuilt = themed[0];
    if (rebuilt?.entries.length) {
      return { day: plan.day, entries: rebuilt.entries };
    }
    const structured = buildStructuredDayPlans({
      places: allocator.filterPool(places),
      days: 1,
      style,
      classifyKind: classifyPlanPlaceKind,
      resolveLabel: resolveEntryLabel,
    })[0];
    return structured?.entries.length ? { day: plan.day, entries: structured.entries } : plan;
  });
}

export function isItineraryRenderable(
  dayPlans: ComposedDayPlan[],
  requestedDays: number,
  style?: TripStyleKey,
  plannedDate?: string,
): boolean {
  const validation = validateCompleteItinerary(
    dayPlans,
    requestedDays,
    style,
    plannedDate,
    classifyPlanPlaceKind,
  );
  if (validation.ok) return true;

  const normalized = ensureAllDayPlansExist(dayPlans, requestedDays);
  const total = plannerTotalPlaces(normalized);
  const expected = expectedItineraryItemCount(requestedDays);
  if (!isExactSlotDayPlans(normalized, requestedDays) || total !== expected) {
    return false;
  }

  const hardBlock = validation.reasons.some((reason) =>
    /^(empty_day|overflow_day|duplicate_place_id|day_count_mismatch|incomplete_day:)/.test(reason),
  );
  if (hardBlock) return false;

  logAiPipeline("[AI_RENDER_SOFT_VALIDATE]", {
    requestedDays,
    total,
    reasons: validation.reasons.slice(0, 6),
  });
  return true;
}

export function plannerTotalPlaces(plans: ComposedDayPlan[]): number {
  return plans.reduce((n, plan) => n + plan.entries.length, 0);
}

export function plannerPopulatedDayCount(plans: ComposedDayPlan[], requestedDays: number): number {
  return ensureAllDayPlansExist(plans, requestedDays).filter((plan) => plan.entries.length > 0).length;
}

export function isPlannerResultBetter(
  candidate: ComposedDayPlan[],
  current: ComposedDayPlan[],
  requestedDays: number,
  style?: TripStyleKey,
): boolean {
  return plannerQualityScore(candidate, requestedDays, style) > plannerQualityScore(current, requestedDays, style);
}

/** 保留較完整的 Planner 結果，避免 rebuild / 空結果覆蓋較好的行程 */
function maybeTrimOverflowDayPlans(plans: ComposedDayPlan[], requestedDays: number): ComposedDayPlan[] {
  const normalized = ensureAllDayPlansExist(plans, requestedDays);
  const maxPerDay = minItemsPerDayForTrip(requestedDays);
  if (!normalized.some((plan) => plan.entries.length > maxPerDay)) {
    return normalized;
  }
  return enforceStandardDaySlotPlans(normalized, requestedDays);
}

function finalizePlannerOutput(
  plans: ComposedDayPlan[],
  days: number,
  style: TripStyleKey,
): ComposedDayPlan[] {
  return markItineraryDayCompleteness(maybeTrimOverflowDayPlans(plans, days), days);
}

export function preferBetterComposedPlans(
  candidate: ComposedDayPlan[],
  current: ComposedDayPlan[],
  requestedDays: number,
  style?: TripStyleKey,
): ComposedDayPlan[] {
  const normalizedCandidate = maybeTrimOverflowDayPlans(candidate, requestedDays);
  const normalizedCurrent = maybeTrimOverflowDayPlans(current, requestedDays);
  const candTotal = plannerTotalPlaces(normalizedCandidate);
  const currTotal = plannerTotalPlaces(normalizedCurrent);

  // 空結果永遠不可覆蓋既有有效行程
  if (currTotal > 0 && candTotal <= 0) return normalizedCurrent;
  if (candTotal > 0 && currTotal <= 0) return normalizedCandidate;

  const candRenderable = isItineraryRenderable(normalizedCandidate, requestedDays, style);
  const currRenderable = isItineraryRenderable(normalizedCurrent, requestedDays, style);

  // 已可 render 的結果鎖定，除非候選同樣可 render 且更完整
  if (currRenderable && !candRenderable) return normalizedCurrent;
  if (candRenderable && !currRenderable) return normalizedCandidate;

  if (candRenderable && currRenderable) {
    return isPlannerResultBetter(normalizedCandidate, normalizedCurrent, requestedDays, style)
      ? normalizedCandidate
      : normalizedCurrent;
  }

  return isPlannerResultBetter(normalizedCandidate, normalizedCurrent, requestedDays, style)
    ? normalizedCandidate
    : normalizedCurrent;
}

/** 完整 dayPlan 通過驗證後才凍結，避免低品質行程鎖定 */
export function shouldFreezePlannerResult(
  plans: ComposedDayPlan[],
  requestedDays: number,
  style?: TripStyleKey,
  plannedDate?: string,
): boolean {
  return (
    plannerTotalPlaces(plans) > 0 &&
    validateCompleteItinerary(
      plans,
      requestedDays,
      style,
      plannedDate,
      classifyPlanPlaceKind,
    ).ok
  );
}

const MIN_FILL_SLOT_TIMES = ["10:00", "14:00", "16:00", "11:30", "15:30"];

function collectUsedTripPlaceIds(plans: ComposedDayPlan[]): Set<string> {
  const used = new Set<string>();
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = resolveTripPlaceId(entry.place);
      if (id) used.add(id);
    }
  }
  return used;
}

/** 將未使用的候選地點補進空白天（每天至少 1 個） */
export function fillEmptyDaysFromCandidatePool(params: {
  composedPlans: ComposedDayPlan[];
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const normalized = ensureAllDayPlansExist(params.composedPlans, params.days);
  const emptyDays = normalized.filter((plan) => plan.entries.length === 0);
  if (!emptyDays.length) return normalized;

  const usedIds = collectUsedTripPlaceIds(normalized);
  const unused = params.places.filter((place) => {
    const id = resolveTripPlaceId(place);
    return id && !usedIds.has(id) && !isExcludedRetailPlace(place);
  });

  if (unused.length < emptyDays.length) {
    return normalized;
  }

  const result = normalized.map((plan) => ({ ...plan, entries: [...plan.entries] }));
  let poolIdx = 0;
  for (const emptyPlan of emptyDays) {
    const target = result.find((plan) => plan.day === emptyPlan.day);
    if (!target) continue;
    const place = unused[poolIdx++];
    if (!place?.name?.trim()) continue;
    const kind = classifyPlanPlaceKind(place);
    const slot: DayPlanSlot = {
      time: MIN_FILL_SLOT_TIMES[(emptyPlan.day - 1) % MIN_FILL_SLOT_TIMES.length] ?? "10:00",
      kind,
      label: kind === "restaurant" ? "午餐" : kind === "cafe" ? "咖啡" : "景點",
    };
    target.entries.push({
      time: slot.time,
      label: resolveEntryLabel(slot, place),
      name: place.name.trim(),
      place,
    });
  }

  logAiPipeline(
    "[AI_DAY_PLAN_EMPTY_DAYS_FILLED]",
    `days=${emptyDays.map((p) => p.day).join(",")}`,
    `filled=${result.filter((p) => p.entries.length > 0).length}`,
  );
  return result;
}

/** 部分天數空白時，平均重分配 / 補點，確保可 render */
export function ensureRenderableComposedPlans(params: {
  composedPlans: ComposedDayPlan[];
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  destination?: string;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const { places, days, style, destination, plannedDate } = params;
  let current = ensureAllDayPlansExist(params.composedPlans, days);
  const mergedPool = dedupePlanningPlaces([
    ...flattenComposedDayPlanPlaces(current),
    ...places,
  ]);

  if (!isPlannerPoolSufficient(mergedPool.length, days)) {
    logAiPipeline(
      "[AI_PLANNER_POOL_INSUFFICIENT]",
      `pool=${mergedPool.length}`,
      `target=${minCandidatePoolSize(days)}`,
      "action=ensure_renderable_partial",
    );
  }

  if (mergedPool.length > 0 && plannerPopulatedDayCount(current, days) < days) {
    return ensureEveryDayPopulated({
      plans: current,
      pool: mergedPool,
      days,
      style,
      plannedDate,
    });
  }

  if (isItineraryRenderable(current, days, style)) {
    return current;
  }

  const validation = validateGeneratedDays(current, days, style);
  if (validation.incompleteDays.length) {
    const rebuilt = rebuildIncompleteDays(
      current,
      validation.incompleteDays,
      mergedPool,
      style,
      destination,
      days,
    );
    current = preferBetterComposedPlans(
      ensureAllDayPlansExist(rebuilt, days),
      current,
      days,
    );
  }

  if (!isItineraryRenderable(current, days, style) && mergedPool.length > 0) {
    current = buildThemedMultiDayPlans({
      places: mergedPool,
      days,
      style,
      plannedDate,
    });
    current = finalizeMultiDayItinerary({
      plans: current,
      pool: mergedPool,
      days,
      style,
      plannedDate,
    });
  }

  return ensureAllDayPlansExist(current, days);
}

export function ensureAllDayPlansExist(
  plans: ComposedDayPlan[],
  days: number,
): ComposedDayPlan[] {
  const safeDays = Math.max(1, days);
  const byDay = new Map(plans.map((plan) => [plan.day, plan]));
  const result: ComposedDayPlan[] = [];
  for (let day = 1; day <= safeDays; day += 1) {
    const existing = byDay.get(day);
    result.push(
      existing ?? { day, entries: [], isIncomplete: true },
    );
  }
  return result;
}

const STANDARD_DAY_SLOTS: DayPlanSlot[] = STANDARD_ITINERARY_DAY_SLOTS.map((slot) => ({
  time: slot.time,
  kind: slot.kind as PlanPlaceKind,
  label: slot.label,
}));

export const EXPECTED_SLOTS_PER_DAY = 7;

export function expectedItineraryItemCount(days: number): number {
  return Math.max(1, days) * minItemsPerDayForTrip(days);
}

export function isExactSlotDayPlans(plans: ComposedDayPlan[], days: number): boolean {
  const expectedPerDay = minItemsPerDayForTrip(days);
  return ensureAllDayPlansExist(plans, days).every((plan) => plan.entries.length === expectedPerDay);
}

function plannerQualityScore(
  plans: ComposedDayPlan[],
  requestedDays: number,
  style?: TripStyleKey,
): number {
  const normalized = ensureAllDayPlansExist(plans, requestedDays);
  const total = plannerTotalPlaces(normalized);
  const expected = expectedItineraryItemCount(requestedDays);
  const renderable = isItineraryRenderable(normalized, requestedDays, style);
  const exactSlots = isExactSlotDayPlans(normalized, requestedDays);
  const populated = plannerPopulatedDayCount(normalized, requestedDays);

  let score = 0;
  if (renderable) score += 10_000;
  if (exactSlots) score += 5_000;
  score += populated * 100;
  score -= Math.abs(total - expected) * 50;
  if (total > expected) score -= (total - expected) * 500;
  return score;
}

export function logDaySlotValidation(day: number, entries: DayPlanEntry[]): void {
  const template = STANDARD_DAY_SLOTS;
  const expected = template.map((s) => s.label).join(",");
  const actual = entries.map((e) => `${e.time}:${e.label}`).join(",");
  const expectedLabels = template.map((s) => s.label);
  const actualLabels = entries.map((e) => e.label);
  const missing = expectedLabels.filter((label) => !actualLabels.includes(label));
  const extra = actualLabels.filter((label) => !expectedLabels.includes(label));
  const duplicateType = expectedLabels.filter(
    (label, idx, arr) => arr.indexOf(label) !== idx || actualLabels.filter((l) => l === label).length > 1,
  );

  if (entries.length !== template.length || missing.length > 0 || extra.length > 0) {
    logAiPipeline("[DAY_SLOT_VALIDATION]", {
      day,
      expected,
      actual,
      missing: missing.join(",") || "none",
      extra: extra.join(",") || "none",
      duplicateType: [...new Set(duplicateType)].join(",") || "none",
    });
  }
}

/** 將 dayPlan 修剪為標準 7-slot，候選池與最終行程分離 */
export function enforceStandardDaySlotPlans(
  plans: ComposedDayPlan[],
  days: number,
): ComposedDayPlan[] {
  const template = STANDARD_DAY_SLOTS;
  return ensureAllDayPlansExist(plans, days).map((plan) => {
    const usedIds = new Set<string>();
    const byTime = new Map(plan.entries.map((entry) => [entry.time, entry]));
    const byLabel = new Map<string, DayPlanEntry[]>();
    for (const entry of plan.entries) {
      const list = byLabel.get(entry.label) ?? [];
      list.push(entry);
      byLabel.set(entry.label, list);
    }

    const entries: DayPlanEntry[] = [];
    for (const slot of template) {
      let entry = byTime.get(slot.time);
      if (!entry) {
        const labelMatches = byLabel.get(slot.label) ?? [];
        entry = labelMatches.find((candidate) => {
          const id = resolveTripPlaceId(candidate.place);
          return id && !usedIds.has(id);
        });
      }
      if (!entry?.name) continue;
      const id = resolveTripPlaceId(entry.place);
      if (id && usedIds.has(id)) continue;
      if (id) usedIds.add(id);
      entries.push({
        time: slot.time,
        label: resolveEntryLabel(slot, entry.place),
        name: entry.name,
        place: entry.place,
      });
    }

    logDaySlotValidation(plan.day, entries);
    return { day: plan.day, entries: dedupeEntryTimes(entries) };
  });
}


export const STYLE_DAY_SLOT_TEMPLATES: Record<TripStyleKey, DayPlanSlot[][]> = {
  classic_landmarks: [STANDARD_DAY_SLOTS],
  local_life: [STANDARD_DAY_SLOTS],
  slow_nature: [STANDARD_DAY_SLOTS],
  mixed: [STANDARD_DAY_SLOTS],
};

/** 將任意 style 字串正規成 TripStyleKey（非法值 → mixed，避免模板 Map miss）。 */
export function resolvePlannerStyleKey(
  style?: string | TripStyleKey | null,
): TripStyleKey {
  if (!style) return "mixed";
  if (
    style === "classic_landmarks" ||
    style === "local_life" ||
    style === "slow_nature" ||
    style === "mixed"
  ) {
    return style;
  }
  return parseTripStyleKey(String(style)) ?? "mixed";
}

/**
 * 依 style + day（1-based 或 0-based index）安全取得當日 slot template。
 * 禁止 `STYLE_DAY_SLOT_TEMPLATES[style][day-1]` 直接索引（非法 style 會 throw）。
 */
export function resolveStyleDaySlotTemplate(
  style: string | TripStyleKey | null | undefined,
  dayOrIndex: number,
): DayPlanSlot[] {
  const key = resolvePlannerStyleKey(style);
  const templates = STYLE_DAY_SLOT_TEMPLATES[key] ?? STYLE_DAY_SLOT_TEMPLATES.mixed;
  const safe =
    templates.length > 0 ? templates : STYLE_DAY_SLOT_TEMPLATES.mixed;
  const fallback = STYLE_DAY_SLOT_TEMPLATES.mixed[0] ?? STANDARD_DAY_SLOTS;
  if (safe.length === 0) return fallback;
  // Accept 1-based day or 0-based index; wrap so Day5+ still resolves.
  const index = dayOrIndex >= 1 ? dayOrIndex - 1 : Math.max(0, dayOrIndex);
  return safe[index % safe.length] ?? safe[0] ?? fallback;
}

export function logAiGenerateAttractions(count: number): void {
  logAiPipeline("[AI_GENERATE_ATTRACTIONS]", `count=${count}`);
}

export function logAiGenerateRestaurants(count: number): void {
  logAiPipeline("[AI_GENERATE_RESTAURANTS]", `count=${count}`);
}

export function logAiGenerateCafes(count: number): void {
  logAiPipeline("[AI_GENERATE_CAFES]", `count=${count}`);
}

export function logAiBuildDayPlan(days: number): void {
  logAiPipeline("[AI_BUILD_DAY_PLAN]", `days=${days}`);
}

export function logAiDayPlanSummary(summary: {
  attractions: number;
  restaurants: number;
  cafes: number;
}): void {
  logAiPipeline(
    "[AI_DAY_PLAN_SUMMARY]",
    `attractions=${summary.attractions}`,
    `restaurants=${summary.restaurants}`,
    `cafes=${summary.cafes}`,
  );
}

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

export function classifyPlanPlaceKind(place: PlaceResult): PlanPlaceKind {
  if (isExcludedRetailPlace(place)) return "attraction";
  const types = placeTypes(place);
  const blob = placeBlob(place);
  const tripCategory = classifyTripPlaceCategory(place);

  if (isNightMarketPlace(place) || tripCategory === "night_market") return "night_market";
  if (isMarketPlace(place)) return "market";
  if (isCultureCreativeAreaPlace(place)) return "culture";
  if (isExplicitCafePlace(place)) return "cafe";
  if (isBarBistroPlace(place)) return "restaurant";
  if (
    types.has("restaurant") ||
    types.has("food") ||
    types.has("meal_takeaway") ||
    types.has("bar") ||
    tripCategory === "local_food" ||
    tripCategory === "bar" ||
    /餐|食|小吃|料理|bistro|dining|grill|diner|餐酒館|餐酒/.test(blob)
  ) {
    return "restaurant";
  }
  if (
    types.has("shopping_mall") ||
    types.has("department_store") ||
    tripCategory === "shopping_district"
  ) {
    return "shopping";
  }
  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    types.has("library") ||
    tripCategory === "museum" ||
    tripCategory === "art_gallery" ||
    tripCategory === "heritage" ||
    isMuseumCulturePlace(place)
  ) {
    return "culture";
  }
  if (
    types.has("park") ||
    types.has("natural_feature") ||
    tripCategory === "park" ||
    tripCategory === "trail" ||
    tripCategory === "sea_view" ||
    tripCategory === "mountain_view" ||
    tripCategory === "riverside"
  ) {
    return "nature";
  }
  return "attraction";
}

export function buildOpenHoursFallbackAttempts(
  destination: string,
  meal: "早餐" | "午餐" | "晚餐" | "咖啡",
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const typeMap: Record<string, string[]> = {
    早餐: ["cafe", "bakery", "restaurant"],
    午餐: ["restaurant", "food"],
    晚餐: ["restaurant", "food"],
    咖啡: ["cafe", "coffee_shop", "bakery"],
  };
  return [
    { query: `${label} ${meal} 營業中`, mode: "text", includedTypes: typeMap[meal] },
    { query: `${label} ${meal}`, mode: "text", includedTypes: typeMap[meal] },
  ];
}
export function buildCategorySearchAttempts(
  destination: string,
  kind: PlanPlaceKind,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label];
  const enLabel = en && en !== label ? en : null;

  switch (kind) {
    case "restaurant":
      return [
        { query: `${label} 美食 餐廳`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 必吃`, mode: "text", includedTypes: ["restaurant"] },
        { query: `${label} 小吃`, mode: "text", includedTypes: ["restaurant", "food"] },
        ...(enLabel
          ? [{ query: `${enLabel} restaurants`, mode: "text" as const, includedTypes: ["restaurant", "food"] }]
          : []),
      ];
    case "cafe":
      return [
        { query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
        { query: `${label} 下午茶`, mode: "text", includedTypes: ["cafe", "bakery"] },
        ...(enLabel
          ? [{ query: `${enLabel} cafes`, mode: "text" as const, includedTypes: ["cafe", "coffee_shop"] }]
          : []),
      ];
    case "shopping":
      return [
        { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "department_store"] },
        { query: `${label} 購物`, mode: "text", includedTypes: ["shopping_mall"] },
      ];
    case "market":
      return [
        { query: `${label} 傳統市場`, mode: "text", includedTypes: ["market"] },
        { query: `${label} 市集`, mode: "text", includedTypes: ["market"] },
      ];
    case "night_market":
      return [
        { query: `${label} 夜市`, mode: "text", includedTypes: ["restaurant", "night_club"] },
        ...(enLabel
          ? [{ query: `${enLabel} night market`, mode: "text" as const, includedTypes: ["restaurant", "market"] }]
          : []),
      ];
    case "culture":
      return [
        { query: `${label} 博物館`, mode: "text", includedTypes: ["museum"] },
        { query: `${label} 美術館`, mode: "text", includedTypes: ["art_gallery", "museum"] },
        ...(enLabel
          ? [{ query: `${enLabel} museums`, mode: "text" as const, includedTypes: ["museum", "art_gallery"] }]
          : []),
      ];
    case "nature":
      return [
        { query: `${label} 自然景觀`, mode: "text", includedTypes: ["park", "natural_feature"] },
        { query: `${label} 公園`, mode: "text", includedTypes: ["park"] },
        ...(enLabel
          ? [
              { query: `${enLabel} scenic spots`, mode: "text" as const, includedTypes: ["tourist_attraction", "natural_feature", "park"] },
              { query: `${enLabel} parks`, mode: "text" as const, includedTypes: ["park", "natural_feature"] },
            ]
          : []),
      ];
    case "attraction":
    default:
      return [
        { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${label} 地標`, mode: "text", includedTypes: ["tourist_attraction"] },
        ...(enLabel
          ? [
              { query: `${enLabel} tourist attractions`, mode: "text" as const, includedTypes: ["tourist_attraction"] },
              { query: `${enLabel} attractions`, mode: "text" as const, includedTypes: ["tourist_attraction"] },
            ]
          : []),
      ];
  }
}

export function markItineraryDayCompleteness(
  plans: ComposedDayPlan[],
  days: number,
): ComposedDayPlan[] {
  const minPerDay = minItemsPerDayForTrip(days);
  return ensureAllDayPlansExist(plans, days).map((plan) => ({
    ...plan,
    isIncomplete: plan.entries.length < minPerDay,
  }));
}

export function kindsForStyle(style: TripStyleKey): PlanPlaceKind[] {
  const composition = TRIP_STYLE_COMPOSITION[style];
  return Object.entries(composition)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([kind]) => kind as PlanPlaceKind);
}

const MEAL_SLOT_LABEL_RE = /早餐|午餐|晚餐|宵夜|下午茶/;

export function isMealSlotLabel(label: string): boolean {
  return MEAL_SLOT_LABEL_RE.test(label);
}

export function isRestaurantCapableKind(kind: PlanPlaceKind): boolean {
  return kind === "restaurant" || kind === "night_market";
}

export function canPlaceFillMealSlot(place: PlaceResult, slot: DayPlanSlot): boolean {
  if (!isMealSlotLabel(slot.label)) return true;
  if (isCultureCreativeAreaPlace(place)) return false;
  if (!isMealSlotEligiblePlace(place)) return false;
  if (!canPlaceFillSlotByCategory(place, slot)) return false;
  if (!validatePlaceOpenAtTime(place, undefined, slot.time)) return false;
  if (isExcludedRetailPlace(place)) return false;
  if (/早餐/.test(slot.label)) {
    return (isProperRestaurantPlace(place) || isCafePlace(place)) && !isBarBistroPlace(place);
  }
  if (/午餐/.test(slot.label)) {
    return isProperRestaurantPlace(place) && !isBarBistroPlace(place);
  }
  if (/晚餐|宵夜/.test(slot.label)) {
    if (isMuseumCulturePlace(place)) return false;
    if (isProperRestaurantPlace(place) || isBarBistroPlace(place)) return true;
    if (isNightMarketPlace(place)) {
      const hour = Number(slot.time.split(":")[0] ?? "19");
      return hour >= 18;
    }
    return false;
  }
  const kind = classifyPlanPlaceKind(place);
  if (kind === "cafe" && /早餐|咖啡|下午茶/.test(slot.label)) return true;
  return isProperRestaurantPlace(place);
}

export function canPlaceFillSlot(place: PlaceResult, slot: DayPlanSlot, plannedDate?: string): boolean {
  if (isExcludedRetailPlace(place)) return false;
  if (!canPlaceFillSlotByCategory(place, slot)) return false;
  if (!validatePlaceOpenAtTime(place, plannedDate, slot.time)) return false;

  const kind = classifyPlanPlaceKind(place);
  if (isNightMarketPlace(place)) {
    const hour = Number(slot.time.split(":")[0] ?? "12");
    if (hour < 18) return false;
  }
  if (isNonMealActivitySlot(slot)) {
    if (isDiningPlace(place, classifyPlanPlaceKind)) return false;
    if (kind === "restaurant" || kind === "night_market" || kind === "cafe") return false;
  }
  if (isMealSlotLabel(slot.label)) {
    if (kind === "market" || kind === "shopping" || kind === "attraction" || kind === "culture" || kind === "nature") {
      return false;
    }
    return canPlaceFillMealSlot(place, slot);
  }
  if ((kind === "cafe" || isCafePlace(place)) && slot.kind !== "cafe" && !/咖啡|下午茶/.test(slot.label)) {
    return false;
  }
  if (isFoodVenuePlace(place) && slot.kind !== "restaurant" && slot.kind !== "cafe") {
    return false;
  }
  if (isMuseumCulturePlace(place) && /晚餐|宵夜/.test(slot.label)) return false;
  return slotKindMatches(kind, slot.kind);
}

/** 僅允許六類固定標題，依地點類型修正 */
export function resolveEntryLabel(slot: DayPlanSlot, place: PlaceResult): string {
  return normalizeItineraryEntryLabel(
    { time: slot.time, kind: slot.kind, label: slot.label },
    place,
  );
}

function slotKindMatches(placeKind: PlanPlaceKind, slotKind: PlanPlaceKind): boolean {
  if (placeKind === slotKind) return true;
  if (slotKind === "attraction" && (placeKind === "culture" || placeKind === "nature")) return true;
  if (slotKind === "culture" && (placeKind === "attraction" || placeKind === "shopping" || placeKind === "market")) {
    return true;
  }
  if (slotKind === "restaurant" && placeKind === "night_market") return true;
  if (slotKind === "shopping" && (placeKind === "market" || placeKind === "attraction")) return true;
  if (slotKind === "nature" && placeKind === "attraction") return true;
  return false;
}

export function computeDayPlanPlaceNeed(days: number, style: TripStyleKey = "mixed"): number {
  const safeDays = Math.max(1, days);
  let slots = 0;
  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const template = resolveStyleDaySlotTemplate(style, dayIndex);
    slots += template.length;
  }
  return Math.max(slots, safeDays * CHAT_DAY_PLAN_MIN_PER_DAY);
}

export type DayPlanValidation = {
  ok: boolean;
  missingDays: number[];
  sparseDays: number[];
};

export function minItemsPerDayForStyle(style: TripStyleKey, days?: number): number {
  if (days != null) return minItemsPerDayForTrip(days);
  return STYLE_ITEMS_PER_DAY[style].min;
}

export function maxItemsPerDayForStyle(style: TripStyleKey): number {
  return STYLE_ITEMS_PER_DAY[style].max;
}

export function validateComposedDayPlans(
  plans: ComposedDayPlan[],
  days: number,
  minPerDay = minItemsPerDayForTrip(days),
): DayPlanValidation {
  const safeDays = Math.max(1, days);
  const normalized = ensureAllDayPlansExist(plans, safeDays);
  const missingDays: number[] = [];
  const sparseDays: number[] = [];

  for (let day = 1; day <= safeDays; day += 1) {
    const plan = normalized.find((p) => p.day === day);
    if (!plan) {
      missingDays.push(day);
      continue;
    }
    if (plan.entries.length < minPerDay) {
      sparseDays.push(day);
    }
  }

  return {
    ok: missingDays.length === 0 && sparseDays.length === 0,
    missingDays,
    sparseDays,
  };
}

export function logAiDayPlanValidation(result: DayPlanValidation, days: number): void {
  logAiPipeline(
    "[AI_DAY_PLAN_VALIDATION]",
    `days=${days}`,
    `ok=${result.ok}`,
    `missing=${result.missingDays.join(",") || "none"}`,
    `sparse=${result.sparseDays.join(",") || "none"}`,
  );
}

export function bucketPlacesByKind(
  places: PlaceResult[],
  style?: TripStyleKey,
): Record<PlanPlaceKind, PlaceResult[]> {
  const buckets: Record<PlanPlaceKind, PlaceResult[]> = {
    attraction: [],
    restaurant: [],
    cafe: [],
    shopping: [],
    market: [],
    culture: [],
    nature: [],
    night_market: [],
  };
  const seen = new Set<string>();
  for (const place of places) {
    const id = resolveTripPlaceId(place);
    if (!id || seen.has(id) || !place.name?.trim() || isExcludedRetailPlace(place, { style })) continue;
    if (style === "classic_landmarks") {
      if (isClassicLandmarkScenicCandidate(place)) {
        seen.add(id);
        const kind = classifyPlanPlaceKind(place);
        const bucket =
          kind === "culture" || kind === "nature" ? kind : "attraction";
        buckets[bucket].push(place);
      } else if (isProperRestaurantPlace(place)) {
        seen.add(id);
        buckets.restaurant.push(place);
      } else if (isCafePlace(place)) {
        seen.add(id);
        buckets.cafe.push(place);
      }
      continue;
    }
    seen.add(id);
    buckets[classifyPlanPlaceKind(place)].push(place);
  }
  return buckets;
}

function applyMultiDayTripPipeline(params: {
  plans: ComposedDayPlan[];
  places: PlaceResult[];
  style: TripStyleKey;
  days: number;
  destination?: string;
  plannedDate?: string;
  nearbyExtensions?: string[];
  pace?: "slow" | "medium" | "active";
}): ComposedDayPlan[] {
  const { places, style, days, plannedDate } = params;
  let current = enforceStandardDaySlotPlans(
    ensureAllDayPlansExist(params.plans, days),
    days,
  );

  if (isExactSlotDayPlans(current, days) && isItineraryRenderable(current, days, style)) {
    logAiPipeline("[AI_MULTI_DAY_PIPELINE_SKIP]", "reason=exact_slot_plan_ready");
    logAiDayCountValidate(days, current);
    return current;
  }

  logMultiDayCandidatePool(places.length, days);

  const mergedPool = dedupePlanningPlaces([
    ...flattenComposedDayPlanPlaces(current),
    ...places,
  ]);

  if (!isPlannerPoolSufficient(mergedPool.length, days)) {
    logAiPipeline(
      "[AI_PLANNER_SKIPPED]",
      `pool=${mergedPool.length}`,
      `target=${minCandidatePoolSize(days)}`,
      "action=refill_from_pool",
    );
    current = ensureDayPlansMeetMinimum({
      plans: current,
      pool: mergedPool,
      days,
      style,
      plannedDate,
    });
    validateTripPlaceUniqueness(current, days);
    logAiDayCountValidate(days, current);
    return ensureAllDayPlansExist(current, days);
  }

  const minPerDay = minRenderableItemsPerDay(days);
  const needsThemedPlan =
    plannerPopulatedDayCount(current, days) < days ||
    plannerTotalPlaces(current) < days * minPerDay;

  if (needsThemedPlan) {
    logAiPipeline(
      "[AI_PLANNER_THEMED]",
      `pool=${mergedPool.length}`,
      `populated=${plannerPopulatedDayCount(current, days)}/${days}`,
      `total=${plannerTotalPlaces(current)}`,
    );
    current = buildThemedMultiDayPlans({
      places: mergedPool,
      days,
      style,
      plannedDate,
      nearbyExtensions: params.nearbyExtensions,
      pace: params.pace,
    });
  }

  const duplicateRate = tripDuplicateRate(current);
  if (
    duplicateRate > MAX_TRIP_DUPLICATE_RATE ||
    (!validateTripPlaceUniqueness(current, days).ok && plannerPopulatedDayCount(current, days) >= days)
  ) {
    logAiPipeline(
      "[AI_MULTI_DAY_REBUILD]",
      `reason=duplicate_detected`,
      `rate=${duplicateRate.toFixed(2)}`,
    );
    const themed = buildThemedMultiDayPlans({
      places: mergedPool,
      days,
      style,
      plannedDate,
      nearbyExtensions: params.nearbyExtensions,
      pace: params.pace,
    });
    current = preferBetterComposedPlans(
      finalizeMultiDayItinerary({ plans: themed, pool: mergedPool, days, style, plannedDate }),
      current,
      days,
    );
  }

  current = finalizeMultiDayItinerary({
    plans: current,
    pool: mergedPool,
    days,
    style,
    plannedDate,
  });

  validateTripPlaceUniqueness(current, days);
  logAiDayCountValidate(days, current);
  return enforceStandardDaySlotPlans(ensureAllDayPlansExist(current, days), days);
}

function safeBuildClassicLandmarkDayPlans(params: {
  places: PlaceResult[];
  days: number;
  destination: string;
  style: TripStyleKey;
  plannedDate?: string;
  dedupeRebuildAttempt?: number;
}): ComposedDayPlan[] {
  const filtered = filterPlacesForClassicLandmark(filterExcludedRetailPlaces(params.places));
  const scenicCount = filtered.filter(isClassicLandmarkScenicCandidate).length;
  const minScenic = params.days * CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY;
  if (filtered.length < params.days || scenicCount < Math.min(minScenic, params.days)) {
    logAiPipeline(
      "[AI_CLASSIC_LANDMARK_FALLBACK]",
      `places=${filtered.length}`,
      `scenic=${scenicCount}`,
      `days=${params.days}`,
    );
    return buildThemedMultiDayPlans({
      places: params.places,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }
  try {
    return buildClassicLandmarkDayPlans({
      places: filtered,
      days: params.days,
      destination: params.destination,
      dedupeRebuildAttempt: params.dedupeRebuildAttempt,
    });
  } catch (error) {
    logAiPipeline(
      "[AI_CLASSIC_LANDMARK_ERROR]",
      error instanceof Error ? error.message : String(error),
    );
    return buildThemedMultiDayPlans({
      places: params.places,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
    });
  }
}

function rebuildFailedDays(
  plans: ComposedDayPlan[],
  failedDays: number[],
  places: PlaceResult[],
  style: TripStyleKey,
  destination?: string,
  days?: number,
  plannedDate?: string,
): ComposedDayPlan[] {
  if (!failedDays.length) return plans;
  if (style === "classic_landmarks" && destination && days) {
    logClassicDayRebuild(0, "trip_rebuild");
    return safeBuildClassicLandmarkDayPlans({
      places,
      days,
      destination,
      style,
      plannedDate,
      dedupeRebuildAttempt: MAX_CLASSIC_DEDUPE_REBUILD_ATTEMPTS,
    });
  }
  if (style === "local_life" && destination && days) {
    for (const day of failedDays) {
      const hasRetail = plans
        .find((p) => p.day === day)
        ?.entries.some((e) => isExcludedRetailPlace(e.place, { style }));
      if (hasRetail) logAiDayRebuildRetailExcluded(day);
      else logAiDayRebuildNonMeal(day, "style_composition");
    }
    return buildLocalLifeDayPlans({
      places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places, { style })),
      days,
      destination,
    });
  }
  const failed = new Set(failedDays);
  return plans.map((plan) => {
    if (!failed.has(plan.day)) return plan;
    if (style === "classic_landmarks") {
      logClassicDayRebuild(plan.day, "itinerary_validation");
    }
    const rebuilt = buildStructuredDayPlans({
      places,
      days: 1,
      style,
      classifyKind: classifyPlanPlaceKind,
      resolveLabel: resolveEntryLabel,
    })[0];
    return rebuilt?.entries.length ? { day: plan.day, entries: rebuilt.entries } : plan;
  });
}

const MAX_CLASSIC_DEDUPE_REBUILD_ATTEMPTS = 1;

function finalizeComposedDayPlans(
  plans: ComposedDayPlan[],
  places: PlaceResult[],
  style: TripStyleKey,
  days: number,
  destination?: string,
  plannedDate?: string,
): ComposedDayPlan[] {
  let classicFullRebuildDone = false;
  const initialPlans = ensureAllDayPlansExist(sortComposedDayPlans(plans), days);
  const initialTotal = plannerTotalPlaces(initialPlans);
  let current = initialPlans;
  let itineraryValidation = validateItinerary(current, classifyPlanPlaceKind, style, plannedDate, days);

  if (!itineraryValidation.ok) {
    logAiDayPlanRebuildReason(itineraryValidation.reasons.join(";") || "initial_validation_failed");
    current = repairDayPlanSlots(
      current,
      places,
      style,
      classifyPlanPlaceKind,
      resolveEntryLabel,
      days,
      plannedDate,
    );
    current = ensureAllDayPlansExist(sortComposedDayPlans(current), days);
    itineraryValidation = validateItinerary(current, classifyPlanPlaceKind, style, plannedDate, days);
  }

  if (!itineraryValidation.ok && itineraryValidation.failedDays.length > 0) {
    logAiDayPlanRebuild();
    logAiDayPlanRebuildReason(`failed_days:${itineraryValidation.failedDays.join(",")}`);
    current = rebuildFailedDays(
      current,
      itineraryValidation.failedDays,
      places,
      style,
      destination,
      days,
      plannedDate,
    );
    current = ensureAllDayPlansExist(sortComposedDayPlans(current), days);
    itineraryValidation = validateItinerary(current, classifyPlanPlaceKind, style, plannedDate, days);
  }

  if (!itineraryValidation.ok) {
    logAiDayPlanRebuild();
    logAiDayPlanRebuildReason(itineraryValidation.reasons.join(";") || "full_rebuild");
    if (style === "local_life" && destination) {
      current = ensureAllDayPlansExist(
        sortComposedDayPlans(
          buildLocalLifeDayPlans({
            places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places)),
            days,
            destination,
          }),
        ),
        days,
      );
    } else {
      current = ensureAllDayPlansExist(
        sortComposedDayPlans(
          buildStructuredDayPlans({
            places,
            days,
            style,
            classifyKind: classifyPlanPlaceKind,
            resolveLabel: resolveEntryLabel,
            plannedDate,
          }),
        ),
        days,
      );
    }
    validateItinerary(current, classifyPlanPlaceKind, style, plannedDate, days);
  }

  if (style === "classic_landmarks") {
    let classicValidation = validateClassicLandmarkItinerary(current, classifyPlanPlaceKind);
    if (destination) {
      const tripDedup = validateClassicLandmarkTrip(current, destination);
      if (!tripDedup.ok) {
        classicValidation = {
          ok: false,
          reasons: [...classicValidation.reasons, ...tripDedup.reasons],
          failedDays: [
            ...new Set([...classicValidation.failedDays, ...tripDedup.duplicateDays]),
          ],
        };
      }
    }
    if (!classicValidation.ok && classicValidation.failedDays.length > 0) {
      logAiDayPlanRebuild();
      current = rebuildFailedDays(
        current,
        classicValidation.failedDays,
        places,
        style,
        destination,
        days,
        plannedDate,
      );
      current = sortComposedDayPlans(current);
      classicValidation = validateClassicLandmarkItinerary(current, classifyPlanPlaceKind);
    }
    if (!classicValidation.ok && destination && !classicFullRebuildDone) {
      classicFullRebuildDone = true;
      logAiDayPlanRebuild();
      current = sortComposedDayPlans(
        safeBuildClassicLandmarkDayPlans({
          places,
          days,
          destination,
          style,
          plannedDate,
          dedupeRebuildAttempt: MAX_CLASSIC_DEDUPE_REBUILD_ATTEMPTS,
        }),
      );
      validateClassicLandmarkItinerary(current, classifyPlanPlaceKind);
      validateClassicLandmarkTrip(current, destination);
    } else if (!classicValidation.ok && destination) {
      logAiPipeline("[AI_DAY_REBUILD_ABORT]", "reason=classic_full_rebuild_skipped");
    }
  }

  if (style === "local_life" && destination) {
    const dedup = validateTripNoDuplicate(current, destination, days);
    if (!dedup.ok) {
      logAiDayPlanRebuild();
      current = sortComposedDayPlans(
        buildLocalLifeDayPlans({
          places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places)),
          days,
          destination,
        }),
      );
      validateTripNoDuplicate(current, destination, days);
    }
    validateTripPlaceUniqueness(current, days);
  }

  const countValidation = validateComposedDayPlans(
    current,
    days,
    minItemsPerDayForTrip(days),
  );
  logAiDayPlanValidation(countValidation, days);
  logAiDayPlanFinalValidate(days, countValidation.ok, minItemsPerDayForTrip(days), countValidation.sparseDays);

  const dayCountCheck = logAiDayCountValidate(days, current);
  if (!dayCountCheck.ok || !countValidation.ok) {
    logAiDayPlanRebuild();
    logAiDayPlanRebuildReason(
      !dayCountCheck.ok
        ? `day_count_mismatch:${days}!=${dayCountCheck.generatedDays}`
        : `sparse_days:${countValidation.sparseDays.join(",")}`,
    );
    current = ensureAllDayPlansExist(
      sortComposedDayPlans(
        repairDayPlanSlots(
          current,
          places,
          style,
          classifyPlanPlaceKind,
          resolveEntryLabel,
          days,
          plannedDate,
        ),
      ),
      days,
    );
    logAiDayCountValidate(days, current);
  }

  for (const plan of current) {
    if (isDayMealsOnly(plan.entries, classifyPlanPlaceKind)) {
      logAiStyleCompositionFail("meals_only_day", plan.day);
      logAiNonMealSlotMissing(plan.day);
      if (style === "local_life" && destination) {
        logAiDayRebuildNonMeal(plan.day, "meals_only_before_render");
        const replacement = rebuildLocalLifeDayPlan({
          day: plan.day,
          currentPlans: current,
          places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places, { style })),
          destination,
          days,
        });
        if (replacement && !isDayMealsOnly(replacement.entries, classifyPlanPlaceKind)) {
          plan.entries = replacement.entries;
        }
      }
    }
  }

  const retailValidation = validateNoExcludedRetailPlaces(current, style);
  if (!retailValidation.ok && retailValidation.failedDays.length > 0) {
    logAiDayPlanRebuild();
    logAiDayPlanRebuildReason(`excluded_retail:${retailValidation.failedDays.join(",")}`);
    current = stripExcludedRetailFromDayPlans(current, style);
    const safePlaces = filterExcludedRetailPlaces(places, { style });
    for (const day of retailValidation.failedDays) {
      logAiDayRebuildRetailExcluded(day);
      if (style === "local_life" && destination) {
        const replacement = rebuildLocalLifeDayPlan({
          day,
          currentPlans: current,
          places: filterPlacesForLocalLife(safePlaces),
          destination,
          days,
        });
        if (replacement?.entries.length) {
          const byDay = new Map(current.map((p) => [p.day, p]));
          byDay.set(day, replacement);
          current = [...byDay.values()].sort((a, b) => a.day - b.day);
        }
      } else {
        const rebuilt = buildStructuredDayPlans({
          places: safePlaces,
          days: 1,
          style,
          classifyKind: classifyPlanPlaceKind,
          resolveLabel: resolveEntryLabel,
          plannedDate,
        })[0];
        if (rebuilt?.entries.length) {
          const byDay = new Map(current.map((p) => [p.day, p]));
          byDay.set(day, { day, entries: rebuilt.entries });
          current = [...byDay.values()].sort((a, b) => a.day - b.day);
        }
      }
    }
    current = ensureAllDayPlansExist(sortComposedDayPlans(current), days);
    validateNoExcludedRetailPlaces(current, style);
  }

  let generatedValidation = validateGeneratedDays(current, days, style);
  if (!generatedValidation.ok) {
    current = rebuildIncompleteDays(
      current,
      generatedValidation.incompleteDays,
      places,
      style,
      destination,
      days,
    );
    current = ensureAllDayPlansExist(sortComposedDayPlans(current), days);
    generatedValidation = validateGeneratedDays(current, days, style);
  }

  const finalized = markItineraryDayCompleteness(
    sortComposedDayPlans(current).map((plan) => ({
      ...plan,
      entries: dedupeEntryTimes(plan.entries),
    })),
    days,
  );
  const finalTotal = plannerTotalPlaces(finalized);
  if (finalTotal <= 0 && initialTotal > 0) {
    logPlannerOverwriteBlocked("finalize_cleared_plan", initialTotal, finalTotal);
    return markItineraryDayCompleteness(initialPlans, days);
  }
  const chosen = preferBetterComposedPlans(finalized, initialPlans, days, style);
  return finalizePlannerOutput(chosen, days, style);
}

export function buildComposedDayPlans(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  destination?: string;
  plannedDate?: string;
  lat?: number;
  lng?: number;
  nearbyExtensions?: string[];
  pace?: "slow" | "medium" | "active";
}): ComposedDayPlan[] {
  const { days, style, destination, plannedDate, lat, lng } = params;
  const places = filterRealPlanningPlaces(params.places);
  const safeDays = Math.max(1, days);
  const pool = dedupePlanningPlaces(places);

  if (!isPlannerPoolReady(pool, safeDays)) {
    const gate = evaluatePlannerPoolGate(pool, safeDays);
    if (gate.decision === "block") {
      logAiPipeline(
        "[AI_PLANNER_POOL_GATE]",
        `pool=${pool.length}`,
        `target=${minCandidatePoolSize(safeDays)}`,
        `dining=${countDiningPoolPlaces(pool)}`,
        `scenic=${countScenicPoolPlaces(pool)}`,
        "action=skip_await_expansion",
      );
      logPlannerOverwriteBlocked("insufficient_pool_skip", 0, 0);
      return ensureAllDayPlansExist([], safeDays);
    }
    logAiPipeline(
      "[AI_PLANNER_POOL_GATE]",
      `pool=${pool.length}`,
      `decision=${gate.decision}`,
      "action=continue_with_refill",
    );
  }

  if (style === "classic_landmarks" && destination) {
    const safePlaces = filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places));
    logAiBuildDayPlanStart(safeDays, safePlaces.length);
    const plans = safeBuildClassicLandmarkDayPlans({
      places,
      days: safeDays,
      destination,
      style,
      plannedDate,
    });
    logPlannerSplit(dayCountsFromPlans(plans));
    const finalized = finalizeComposedDayPlans(plans, safePlaces, style, safeDays, destination, plannedDate);
    const piped = ensureDayPlansMeetMinimum({
      plans: applyMultiDayTripPipeline({
        plans: finalized,
        places,
        style,
        days: safeDays,
        destination,
        plannedDate,
        nearbyExtensions: params.nearbyExtensions,
        pace: params.pace,
      }),
      pool: places,
      days: safeDays,
      style,
      plannedDate,
      nearbyExtensions: params.nearbyExtensions,
      pace: params.pace,
    });
    logPlannerAssign(dayCountsFromPlans(piped));
    for (const plan of piped) {
      for (const entry of plan.entries) {
        logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
      }
    }
    const totalItems = piped.reduce((n, p) => n + p.entries.length, 0);
    logAiDayPlanFinalSummary(safeDays, totalItems);
    logPlannerResult(piped.length, totalItems, isItineraryRenderable(piped, safeDays, style));
    return finalizePlannerOutput(piped, safeDays, style);
  }

  if (style === "local_life" && destination) {
    const safePlaces = ensureLocalLifePlanningPool({
      places,
      destination,
      days: safeDays,
      lat,
      lng,
    });
    logAiBuildDayPlanStart(safeDays, safePlaces.length);
    const plans = buildLocalLifeDayPlans({
      places: safePlaces,
      days: safeDays,
      destination,
      lat,
      lng,
    });
    logPlannerSplit(dayCountsFromPlans(plans));
    const finalized = finalizeComposedDayPlans(plans, safePlaces, style, safeDays, destination, plannedDate);
    const piped = ensureDayPlansMeetMinimum({
      plans: applyMultiDayTripPipeline({
        plans: finalized,
        places: safePlaces,
        style,
        days: safeDays,
        destination,
        plannedDate,
        nearbyExtensions: params.nearbyExtensions,
        pace: params.pace,
      }),
      pool: safePlaces,
      days: safeDays,
      style,
      plannedDate,
      nearbyExtensions: params.nearbyExtensions,
      pace: params.pace,
    });
    logPlannerAssign(dayCountsFromPlans(piped));
    for (const plan of piped) {
      for (const entry of plan.entries) {
        logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
      }
    }
    const totalItems = piped.reduce((n, p) => n + p.entries.length, 0);
    logAiDayPlanFinalSummary(safeDays, totalItems);
    logPlannerResult(piped.length, totalItems, isItineraryRenderable(piped, safeDays, style));
    return finalizePlannerOutput(piped, safeDays, style);
  }

  const safePlaces =
    style === "classic_landmarks"
      ? filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places))
      : filterExcludedRetailPlaces(places);
  logAiBuildDayPlanStart(safeDays, safePlaces.length);
  const byKind = bucketPlacesByKind(safePlaces, style);
  const used = new Set<string>();
  const plans: ComposedDayPlan[] = [];

  const pickFromKind = (kind: PlanPlaceKind, filter?: (place: PlaceResult) => boolean): PlaceResult | undefined => {
    const primary = byKind[kind] ?? [];
    const fallbackKinds: PlanPlaceKind[] =
      kind === "restaurant"
        ? []
        : kind === "attraction"
          ? style === "classic_landmarks"
            ? ["culture", "nature"]
            : ["culture", "nature", "shopping"]
          : kind === "shopping"
            ? ["market", "attraction"]
            : kind === "culture"
              ? style === "classic_landmarks"
                ? ["nature", "attraction"]
                : ["nature", "attraction"]
              : kind === "nature"
                ? style === "classic_landmarks"
                  ? ["culture", "attraction"]
                  : ["culture", "attraction", "market"]
                : kind === "cafe"
                  ? []
                  : [];

    const orderSources = (list: PlaceResult[]) =>
      style === "classic_landmarks" ? sortClassicLandmarkPlaces(list) : list;

    for (const source of [primary, ...fallbackKinds.map((k) => byKind[k] ?? [])]) {
      for (const place of orderSources(source)) {
        const id = resolveTripPlaceId(place);
        if (!id || used.has(id) || isGeocodeEmptyPlace(place)) continue;
        if (filter && !filter(place)) continue;
        used.add(id);
        return place;
      }
    }
    return undefined;
  };

  const pickForSlot = (
    slot: DayPlanSlot,
    dayState: { cafeCount: number; mallCount: number },
    dayIndex: number,
  ): PlaceResult | undefined => {
    if (style === "classic_landmarks") {
      if (/午餐/.test(slot.label)) {
        return pickFromKind("restaurant", (p) => canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind));
      }
      if (/晚餐|宵夜/.test(slot.label)) {
        return pickFromKind("restaurant", (p) => canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind));
      }
      if (slot.kind === "cafe" || /咖啡|甜點/.test(slot.label)) {
        if (dayState.cafeCount >= 1) return undefined;
        const cafe = pickFromKind("cafe", (p) => canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind));
        if (cafe) dayState.cafeCount += 1;
        return cafe;
      }
      const regionalFilter = (p: PlaceResult) =>
        canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind) &&
        (!destination || placeMatchesClassicDayRegion(p, destination, dayIndex));
      let place = pickFromKind(slot.kind, regionalFilter);
      if (!place) {
        place = pickFromKind(slot.kind, (p) =>
          canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind),
        );
      }
      if (!place) {
        for (const kind of ["attraction", "culture", "nature"] as PlanPlaceKind[]) {
          place = pickFromKind(kind, regionalFilter);
          if (place) break;
          place = pickFromKind(kind, (p) =>
            canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind),
          );
          if (place) break;
        }
      }
      return place;
    }

    if (/午餐/.test(slot.label)) {
      const place = pickFromKind(
        "restaurant",
        (p) => isProperRestaurantPlace(p) && !isBarBistroPlace(p) && canPlaceFillSlot(p, slot, plannedDate),
      );
      return place;
    }
    if (/晚餐|宵夜/.test(slot.label)) {
      for (const kind of ["restaurant", "night_market"] as PlanPlaceKind[]) {
        const place = pickFromKind(
          kind,
          kind === "restaurant"
            ? (p) => (isProperRestaurantPlace(p) || isBarBistroPlace(p)) && canPlaceFillSlot(p, slot, plannedDate)
            : (p) => isNightMarketPlace(p) && canPlaceFillSlot(p, slot, plannedDate),
        );
        if (place && canPlaceFillMealSlot(place, slot)) return place;
        if (place) {
          const id = resolveTripPlaceId(place);
          if (id) used.delete(id);
        }
      }
      return undefined;
    }
    if (slot.kind === "cafe" || /咖啡|下午茶/.test(slot.label)) {
      if (dayState.cafeCount >= 1) return undefined;
      const place = pickFromKind("cafe", (p) => isCafePlace(p) && canPlaceFillSlot(p, slot, plannedDate));
      if (place) dayState.cafeCount += 1;
      return place;
    }

    if (slot.kind === "shopping" || /商圈/.test(slot.label)) {
      if (dayState.mallCount >= 1) {
        const place = pickFromKind("attraction", (p) => !isLargeMallPlace(p));
        return place;
      }
    }

    let place = pickFromKind(slot.kind, (p) => {
      if (dayState.mallCount >= 1 && isLargeMallPlace(p)) return false;
      return canPlaceFillSlot(p, slot, plannedDate);
    });
    if (!place) {
      for (const kind of scenicKindsForStyle(style)) {
        place = pickFromKind(kind, (p) => canPlaceFillSlot(p, slot, plannedDate));
        if (place) break;
        place = undefined;
      }
    }
    if (place && !canPlaceFillSlot(place, slot, plannedDate)) {
      const id = resolveTripPlaceId(place);
      if (id) used.delete(id);
      return undefined;
    }
    if (place && (isCafePlace(place) || classifyPlanPlaceKind(place) === "cafe")) {
      dayState.cafeCount += 1;
    }
    if (place && isLargeMallPlace(place)) {
      dayState.mallCount += 1;
    }
    return place;
  };

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const template = resolveStyleDaySlotTemplate(style, dayIndex);
    const entries: DayPlanEntry[] = [];
    const dayState = { cafeCount: 0, mallCount: 0 };

    for (const slot of template) {
      const place = pickForSlot(slot, dayState, dayIndex);
      if (!place?.name) continue;
      entries.push({
        time: slot.time,
        label: resolveEntryLabel(slot, place),
        name: place.name,
        place,
      });
    }

    const minPerDay = minItemsPerDayForTrip(safeDays);
    if (entries.length < minPerDay) {
      for (const kind of scenicKindsForStyle(style)) {
        if (entries.length >= minPerDay) break;
        const place = pickFromKind(kind, (p) => !isExcludedRetailPlace(p) && !isDiningPlace(p, classifyPlanPlaceKind));
        if (!place?.name) continue;
        const fillerTimes = ["09:00", "11:00", "14:30", "16:00", "17:30"];
        const fillerTime = fillerTimes[Math.min(entries.length, fillerTimes.length - 1)] ?? "16:00";
        const fillerSlot: DayPlanSlot = {
          time: fillerTime,
          kind,
          label: "景點",
        };
        if (!canPlaceFillSlot(place, fillerSlot, plannedDate)) {
          const id = resolveTripPlaceId(place);
          if (id) used.delete(id);
          continue;
        }
        if (fillerSlot.kind === "cafe" && dayState.cafeCount >= 1) {
          const id = resolveTripPlaceId(place);
          if (id) used.delete(id);
          continue;
        }
        if (fillerSlot.kind === "cafe") dayState.cafeCount += 1;
        entries.push({
          time: fillerSlot.time,
          label: resolveEntryLabel(fillerSlot, place),
          name: place.name,
          place,
        });
      }
    }

    plans.push({ day: dayIndex + 1, entries });
  }

  logAiBuildDayPlan(safeDays);
  const finalized = finalizeComposedDayPlans(plans, safePlaces, style, safeDays, destination, plannedDate);
  const summary = {
    attractions: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "attraction").length,
    restaurants: finalized.flatMap((p) => p.entries).filter((e) => {
      const k = classifyPlanPlaceKind(e.place);
      return k === "restaurant" || k === "night_market";
    }).length,
    cafes: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "cafe").length,
  };
  logAiDayPlanSummary(summary);

  if (
    style === "slow_nature" &&
    !validateComposedDayPlans(finalized, safeDays, minItemsPerDayForTrip(safeDays)).ok &&
    safePlaces.length >= safeDays * CHAT_DAY_PLAN_SLOW_MIN_PER_DAY
  ) {
    logAiDayPlanRebuild();
    logAiDayPlanRebuildReason("slow_nature_sparse_fallback");
    const balanced = buildBalancedSlowDayPlans({ places: safePlaces, days: safeDays, style, plannedDate });
    const balancedCheck = validateComposedDayPlans(balanced, safeDays, minItemsPerDayForTrip(safeDays));
    if (balancedCheck.ok || balanced.length >= safeDays) {
      logAiDayCountValidate(safeDays, balanced);
      const totalItems = balanced.reduce((n, p) => n + p.entries.length, 0);
      logAiDayPlanFinalSummary(safeDays, totalItems);
      return markItineraryDayCompleteness(ensureAllDayPlansExist(balanced, safeDays), safeDays);
    }
  }

  logAiDayCountValidate(safeDays, finalized);

  const piped = ensureDayPlansMeetMinimum({
    plans: applyMultiDayTripPipeline({
      plans: finalized,
      places: safePlaces,
      style,
      days: safeDays,
      destination,
      plannedDate,
      nearbyExtensions: params.nearbyExtensions,
      pace: params.pace,
    }),
    pool: safePlaces,
    days: safeDays,
    style,
    plannedDate,
    nearbyExtensions: params.nearbyExtensions,
    pace: params.pace,
  });
  logPlannerSplit(dayCountsFromPlans(finalized));
  logPlannerAssign(dayCountsFromPlans(piped));

  for (const plan of piped) {
    for (const entry of plan.entries) {
      logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
    }
  }
  const totalItems = piped.reduce((n, p) => n + p.entries.length, 0);
  logAiDayPlanFinalSummary(safeDays, totalItems);

  return finalizePlannerOutput(piped, safeDays, style);
}

export function composedDayPlansToBuckets(plans: ComposedDayPlan[]): DayPlanBucketWithEntries[] {
  return plans.map((plan) => ({
    day: plan.day,
    names: plan.entries.map((entry) => entry.name),
    entries: plan.entries,
  }));
}

export function buildBalancedSlowDayPlans(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const { places, days, style, plannedDate } = params;
  const safeDays = Math.max(1, days);
  const pool =
    style === "classic_landmarks"
      ? filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places))
      : filterExcludedRetailPlaces(places);
  const plans = buildStructuredDayPlans({
    places: pool,
    days: safeDays,
    style,
    classifyKind: classifyPlanPlaceKind,
    resolveLabel: resolveEntryLabel,
    plannedDate,
  });

  const finalized = sortComposedDayPlans(plans);
  validateItinerary(finalized, classifyPlanPlaceKind, style, plannedDate, safeDays);

  logAiBuildDayPlan(safeDays);
  const validation = validateComposedDayPlans(
    finalized,
    safeDays,
    minItemsPerDayForTrip(safeDays),
  );
  logAiDayPlanValidation(validation, safeDays);
  logAiDayCountValidate(safeDays, finalized);
  const summary = {
    attractions: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "attraction").length,
    restaurants: finalized.flatMap((p) => p.entries).filter((e) => {
      const k = classifyPlanPlaceKind(e.place);
      return k === "restaurant" || k === "night_market";
    }).length,
    cafes: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "cafe").length,
  };
  logAiDayPlanSummary(summary);
  logAiPlaceSearchFallback(style === "slow_nature" ? "natural" : "balanced");
  for (const plan of finalized) {
    for (const entry of plan.entries) {
      logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
    }
  }
  const totalItems = finalized.reduce((n, p) => n + p.entries.length, 0);
  logAiDayPlanFinalSummary(safeDays, totalItems);
  return markItineraryDayCompleteness(ensureAllDayPlansExist(finalized, safeDays), safeDays);
}

export function buildComposedDayPlanSummary(
  destination: string,
  days: number,
  style: TripStyleKey,
  plans: ComposedDayPlan[],
  opts?: { slowTravel?: boolean },
): string {
  const label = normalizeDestinationLabel(destination);
  const normalized = ensureAllDayPlansExist(plans, days);

  if (!isItineraryRenderable(normalized, days, style)) {
    const validation = validateGeneratedDays(normalized, days, style);
    logAiRenderBlockedIncompleteDay(
      days,
      validation.reasons,
      Object.fromEntries(normalized.map((p) => [p.day, p.entries.length])),
    );
    return `${label} ${days} 天推薦：\n\n（行程生成中）`;
  }

  const styleLabels: Record<TripStyleKey, string> = {
    classic_landmarks: "經典地標",
    local_life: "在地生活體驗",
    slow_nature: "慢步調散策",
    mixed: "Roamie 混搭推薦",
  };
  const lines: string[] = opts?.slowTravel && style === "slow_nature"
    ? ["我先幫你排一版慢遊行程 🌿", "", `${label} ${days} 天推薦（${styleLabels[style]}）：`, ""]
    : [`${label} ${days} 天推薦（${styleLabels[style]}）：`, ""];

  for (const plan of normalized) {
    if (isDayMealsOnly(plan.entries, classifyPlanPlaceKind)) {
      logAiStyleCompositionFail("meals_only_day", plan.day);
      logAiNonMealSlotMissing(plan.day);
    }
    lines.push(`Day${plan.day}`);
    const sortedEntries = sortComposedDayPlans([plan])[0]?.entries ?? plan.entries;
    for (const entry of sortedEntries) {
      if (!isAllowedItinerarySlotLabel(entry.label)) continue;
      lines.push(`- ${entry.time} ${entry.label}：${entry.name}`);
    }
    if (plan.day < days) lines.push("");
  }

  lines.push("", "想加進行程的話，可以跟我說「加入全部」或選幾個最想去的。");
  return lines.join("\n");
}

export function flattenComposedDayPlanPlaces(plans: ComposedDayPlan[]): PlaceResult[] {
  const seen = new Set<string>();
  const ordered: PlaceResult[] = [];
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = entry.place.id ?? entry.name;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ordered.push(entry.place);
    }
  }
  return ordered;
}

export type AiDayPlanItem = {
  dayIndex: number;
  orderIndex: number;
  time: string;
  slotType: string;
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  type: string;
  photo?: string | null;
  rating?: number | null;
};

export type AiDayPlan = {
  planningSessionId: string;
  destination: string;
  days: number;
  items: AiDayPlanItem[];
};

export type ItineraryDayPayload = {
  dayIndex: number;
  date?: string;
  items: RoamieItineraryItem[];
};

function sortDayPlanEntriesByTime(entries: DayPlanEntry[]): DayPlanEntry[] {
  return [...entries].sort((a, b) => {
    const parseTime = (time: string): number => {
      const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return 12 * 60;
      return Number(m[1]) * 60 + Number(m[2]);
    };
    return parseTime(a.time) - parseTime(b.time);
  });
}

export function logAiDayPlanFinal(item: AiDayPlanItem): void {
  logAiPipeline(
    "[AI_DAY_PLAN_FINAL]",
    `dayIndex=${item.dayIndex}`,
    `orderIndex=${item.orderIndex}`,
    `time=${item.time}`,
    `name=${item.name}`,
  );
}

export function logAiCreateTripFromDayPlanStart(): void {
  logAiPipeline("[AI_CREATE_TRIP_FROM_DAY_PLAN_START]");
}

export function logAiCreateTripItem(item: AiDayPlanItem, date?: string): void {
  logAiPipeline(
    "[AI_CREATE_TRIP_ITEM]",
    `dayIndex=${item.dayIndex}`,
    `orderIndex=${item.orderIndex}`,
    `time=${item.time}`,
    `name=${item.name}`,
    date ? `date=${date}` : "",
  );
}

export function logTripDetailItemsRender(item: AiDayPlanItem, date?: string): void {
  logAiPipeline(
    "[TRIP_DETAIL_ITEMS_RENDER]",
    `dayIndex=${item.dayIndex}`,
    `orderIndex=${item.orderIndex}`,
    `time=${item.time}`,
    `name=${item.name}`,
    date ? `date=${date}` : "",
  );
}

export function logAiDayPlanOrderMismatch(expected: string, actual: string): void {
  console.warn("[AI_DAY_PLAN_ORDER_MISMATCH]", `expected=${expected}`, `actual=${actual}`);
}

export function composedPlansToAiDayPlan(params: {
  composedPlans: ComposedDayPlan[];
  destination: string;
  days: number;
  planningSessionId: string;
}): AiDayPlan {
  const items: AiDayPlanItem[] = [];
  const seenPlaceKeys = new Set<string>();
  for (const plan of params.composedPlans) {
    const sortedEntries = sortDayPlanEntriesByTime(plan.entries);
    let orderIndex = 0;
    for (const entry of sortedEntries) {
      const place = entry.place;
      if (!isRealGooglePlanningPlace(place)) continue;
      const dedupeKey = resolveTripPlaceId(place) || `${entry.name}:${place.address ?? ""}`;
      if (dedupeKey && seenPlaceKeys.has(dedupeKey)) continue;
      if (dedupeKey) seenPlaceKeys.add(dedupeKey);
      const item: AiDayPlanItem = {
        dayIndex: plan.day,
        orderIndex,
        time: entry.time,
        slotType: entry.label,
        placeId: (place.id ?? "").trim(),
        name: entry.name,
        address: place.address?.trim() ?? "",
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        type: place.primaryType?.trim() || entry.label,
        photo: place.photoName ?? null,
        rating: place.rating ?? null,
      };
      items.push(item);
      logAiDayPlanFinal(item);
      orderIndex += 1;
    }
  }
  return {
    planningSessionId: params.planningSessionId,
    destination: params.destination,
    days: params.days,
    items,
  };
}

export function sortDayPlanItems(items: AiDayPlanItem[]): AiDayPlanItem[] {
  const parseTime = (time: string): number => {
    const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 12 * 60;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  return [...items].sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    const timeCmp = parseTime(a.time) - parseTime(b.time);
    if (timeCmp !== 0) return timeCmp;
    return a.orderIndex - b.orderIndex;
  });
}

export function dayPlanItemToRecommendation(item: AiDayPlanItem): RoamieRecommendationItem {
  return normalizeRecommendationItem({
    name: item.name,
    placeName: item.name,
    type: item.type,
    description: item.address || item.name,
    reason: "",
    estimatedTime: "1-2 小時",
    address: item.address || item.name,
    lat: item.lat,
    lng: item.lng,
    googleMapsUrl: "",
    reasonSource: "template",
    googlePlaceId: item.placeId || undefined,
    photoName: item.photo ?? null,
    rating: item.rating ?? null,
  });
}

export function dayPlanToRecommendations(plan: AiDayPlan): RoamieRecommendationItem[] {
  return dedupePlaceCardsForRender(
    sortDayPlanItems(plan.items).map(dayPlanItemToRecommendation),
  );
}

export function dayPlanToChatPlaces(plan: AiDayPlan): ChatPlaceItem[] {
  return dayPlanToRecommendations(plan) as ChatPlaceItem[];
}

export function mergeEnrichedIntoDayPlan(
  plan: AiDayPlan,
  enriched: RoamieRecommendationItem[],
): AiDayPlan {
  const byKey = new Map<string, RoamieRecommendationItem>();
  for (const rec of enriched) {
    const pid = (rec.googlePlaceId ?? (rec as RoamieRecommendationItem & { placeId?: string }).placeId ?? "").trim();
    if (pid) byKey.set(`id:${pid}`, rec);
    byKey.set(`name:${rec.name}`, rec);
  }

  const items = sortDayPlanItems(plan.items).map((item) => {
    const rec =
      (item.placeId ? byKey.get(`id:${item.placeId}`) : undefined) ??
      byKey.get(`name:${item.name}`);
    if (!rec) return item;
    return {
      ...item,
      placeId: rec.googlePlaceId ?? item.placeId,
      name: rec.name || item.name,
      address: rec.address?.trim() || item.address,
      lat: rec.lat ?? item.lat,
      lng: rec.lng ?? item.lng,
      type: rec.type || item.type,
      photo: rec.photoName ?? item.photo,
      rating: rec.rating ?? item.rating,
    };
  });

  return { ...plan, items };
}

/**
 * 將任意 day 編號 clamp 到 1..tripDays（禁止 Day0 / DayN+1 直接當 index）。
 */
export function clampTripDayNumber(day: number, tripDays: number): number {
  const safeDays = Math.max(1, tripDays);
  if (!Number.isFinite(day)) return 1;
  return Math.min(safeDays, Math.max(1, Math.floor(day)));
}

/**
 * Persistence 前驗證：確保 Day1..DayN 皆存在、無越界／undefined。
 * 缺日會建立空 Day；越界 day 會 clamp 後歸併。
 */
export function ensurePersistenceDayMap(
  tripDays: number,
  dayEntries: Iterable<{ day: number; items: RoamieItineraryItem[] }>,
  dayDates: readonly (string | undefined)[] = [],
): Map<number, ItineraryDayPayload> {
  const safeDays = Math.max(1, tripDays);
  const byDay = new Map<number, ItineraryDayPayload>();
  for (let day = 1; day <= safeDays; day += 1) {
    byDay.set(day, {
      dayIndex: day,
      date: dayDates[day - 1],
      items: [],
    });
  }
  for (const entry of dayEntries) {
    const day = clampTripDayNumber(entry.day, safeDays);
    const existing = byDay.get(day) ?? {
      dayIndex: day,
      date: dayDates[day - 1],
      items: [],
    };
    existing.items.push(...entry.items);
    byDay.set(day, existing);
  }
  return byDay;
}

export function persistenceDaysFromMap(
  byDay: Map<number, ItineraryDayPayload>,
): ItineraryDayPayload[] {
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, payload]) => payload);
}

export function buildItineraryFromDayPlan(
  plan: AiDayPlan,
  dates: TripCreateDates,
): RoamieItineraryItem[] {
  logAiCreateTripFromDayPlanStart();
  const safeDays = Math.max(1, plan.days);
  const dateByDay = new Map<number, string | undefined>();
  for (let day = 1; day <= safeDays; day += 1) {
    dateByDay.set(day, dates.dayDates[day - 1]);
  }
  const sorted = sortDayPlanItems(plan.items);
  return sorted.map((item) => {
    // AiDayPlanItem.dayIndex is 1-based (plan.day); clamp before any index use.
    const dayNumber = clampTripDayNumber(item.dayIndex, safeDays);
    const date = dateByDay.get(dayNumber) ?? "";
    logAiCreateTripItem({ ...item, dayIndex: dayNumber }, date || undefined);
    logTripDetailItemsRender({ ...item, dayIndex: dayNumber }, date || undefined);
    return normalizeItineraryItem({
      date,
      time: item.time,
      title: item.name,
      placeName: item.name,
      description: item.address || item.name,
      lat: item.lat,
      lng: item.lng,
      address: item.address || item.name,
      googlePlaceId: item.placeId || undefined,
      placeType: item.slotType || item.type,
      dayIndex: dayNumber - 1,
      sortIndex: item.orderIndex,
      order: item.orderIndex,
    });
  });
}

export function buildItineraryDaysFromDayPlan(
  plan: AiDayPlan,
  dates: TripCreateDates,
  itineraryItems: RoamieItineraryItem[],
): ItineraryDayPayload[] {
  const safeDays = Math.max(1, plan.days);
  const grouped = new Map<number, RoamieItineraryItem[]>();
  for (const item of itineraryItems) {
    const dayNumber = clampTripDayNumber((item.dayIndex ?? 0) + 1, safeDays);
    const list = grouped.get(dayNumber) ?? [];
    list.push(item);
    grouped.set(dayNumber, list);
  }
  const byDay = ensurePersistenceDayMap(
    safeDays,
    [...grouped.entries()].map(([day, items]) => ({ day, items })),
    dates.dayDates,
  );
  const days = persistenceDaysFromMap(byDay);
  logAiPipeline(
    "[ITINERARY_PERSISTENCE_DAYS]",
    `requested=${safeDays}`,
    `built=${days.length}`,
    `counts=${days.map((d) => d.items.length).join(",")}`,
  );
  return days;
}

export function dayPlanOrderSignature(plan: AiDayPlan): string {
  return sortDayPlanItems(plan.items)
    .map((item) => `D${item.dayIndex}@${item.orderIndex}:${item.time}:${item.name}`)
    .join("|");
}

export function itineraryOrderSignature(items: RoamieItineraryItem[]): string {
  return items
    .map((item, index) => {
      const dayIndex = (item.dayIndex ?? 0) + 1;
      const orderIndex = item.sortIndex ?? item.order ?? index;
      return `D${dayIndex}@${orderIndex}:${item.time}:${item.placeName}`;
    })
    .join("|");
}

export function verifyDayPlanItineraryOrder(plan: AiDayPlan, items: RoamieItineraryItem[]): void {
  const expected = dayPlanOrderSignature(plan);
  const actual = itineraryOrderSignature(items);
  if (expected !== actual) {
    logAiDayPlanOrderMismatch(expected, actual);
  }
}
