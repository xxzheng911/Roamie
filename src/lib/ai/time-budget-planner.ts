/**
 * Time Budget Planner — minute-based daily capacity (SoT).
 * Stop count is only an auxiliary cap; remainingMinutes gates adds.
 */
import { estimatePlaceVisitDuration, type VisitDurationPace } from "@/lib/ai/estimate-place-visit-duration";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  resolvePlaceCategoryFamily,
  type PlaceCategoryFamily,
} from "@/lib/ai/place-category-family";
import { distanceMeters } from "@/lib/geo-distance";
import type { PlaceResult } from "@/lib/place-result";

export type DayTimeBudget = {
  day: number;
  isArrivalDay: boolean;
  isDepartureDay: boolean;
  dayStartTime: string;
  dayEndTime: string;
  availableMinutes: number;
  mealMinutes: number;
  travelMinutes: number;
  visitMinutes: number;
  bufferMinutes: number;
  remainingMinutes: number;
  stopCount: number;
  capacityPass: boolean;
};

export type DayBudgetPolicy = {
  firstDayPolicy: "arrival_aware" | "full_day_capped";
  lastDayPolicy: "departure_aware" | "full_day_capped";
  isArrivalDay: boolean;
  isDepartureDay: boolean;
  effectiveAvailableMinutes: number;
};

const DEFAULT_DAY_START = "09:30";
const DEFAULT_DAY_END = "20:30";
const DEFAULT_MEAL_MINUTES = 150; // lunch + dinner reserved blocks
const DEFAULT_BUFFER_MINUTES = 45;
/** Heuristic walk/drive when Directions not yet available (~4 km/h walk). */
const FALLBACK_TRAVEL_MIN_PER_KM = 12;
const MIN_TRAVEL_MINUTES = 8;
const MAX_TRAVEL_ESTIMATE = 90;

function parseHm(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 9 * 60 + 30;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatHm(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = Math.max(0, total % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function resolveDayBudgetPolicy(params: {
  day: number;
  totalDays: number;
  pace?: VisitDurationPace | null;
  arrivalTime?: string | null;
  departureTime?: string | null;
}): DayBudgetPolicy {
  const isArrivalDay = params.day === 1;
  const isDepartureDay = params.day === params.totalDays && params.totalDays > 1;
  let start = parseHm(DEFAULT_DAY_START);
  let end = parseHm(DEFAULT_DAY_END);

  if (isArrivalDay && params.arrivalTime?.trim()) {
    start = Math.max(start, parseHm(params.arrivalTime) + 60);
  } else if (isArrivalDay) {
    // No flight time: full day, but never larger capacity than other full days.
    start = parseHm(DEFAULT_DAY_START);
  }

  if (isDepartureDay && params.departureTime?.trim()) {
    end = Math.min(end, parseHm(params.departureTime) - 120);
  }

  if (params.pace === "slow") {
    end = Math.min(end, parseHm("19:30"));
  } else if (params.pace === "active") {
    start = Math.min(start, parseHm("09:00"));
    end = Math.max(end, parseHm("21:00"));
  }

  const span = Math.max(0, end - start);
  const meal = DEFAULT_MEAL_MINUTES;
  const buffer = params.pace === "slow" ? 60 : DEFAULT_BUFFER_MINUTES;
  const effectiveAvailableMinutes = Math.max(0, span - meal - buffer);

  return {
    firstDayPolicy: params.arrivalTime?.trim() ? "arrival_aware" : "full_day_capped",
    lastDayPolicy: params.departureTime?.trim() ? "departure_aware" : "full_day_capped",
    isArrivalDay,
    isDepartureDay,
    effectiveAvailableMinutes,
  };
}

function hasCoords(place: PlaceResult): boolean {
  return (
    place.lat != null &&
    place.lng != null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng) &&
    !(Math.abs(place.lat) < 0.0001 && Math.abs(place.lng) < 0.0001)
  );
}

export function estimateTravelMinutesBetween(
  from: PlaceResult | null | undefined,
  to: PlaceResult,
): number {
  if (!from || !hasCoords(from) || !hasCoords(to)) return MIN_TRAVEL_MINUTES;
  const meters = distanceMeters(
    { lat: from.lat!, lng: from.lng! },
    { lat: to.lat!, lng: to.lng! },
  );
  if (!Number.isFinite(meters)) return MIN_TRAVEL_MINUTES;
  const km = meters / 1000;
  const mins = Math.round(km * FALLBACK_TRAVEL_MIN_PER_KM);
  return Math.min(MAX_TRAVEL_ESTIMATE, Math.max(MIN_TRAVEL_MINUTES, mins));
}

export function createEmptyDayBudget(params: {
  day: number;
  totalDays: number;
  pace?: VisitDurationPace | null;
  arrivalTime?: string | null;
  departureTime?: string | null;
}): DayTimeBudget {
  const policy = resolveDayBudgetPolicy(params);
  let start = DEFAULT_DAY_START;
  let end = DEFAULT_DAY_END;
  if (policy.isArrivalDay && params.arrivalTime?.trim()) {
    start = formatHm(parseHm(params.arrivalTime) + 60);
  }
  if (policy.isDepartureDay && params.departureTime?.trim()) {
    end = formatHm(parseHm(params.departureTime) - 120);
  }
  const available = policy.effectiveAvailableMinutes;
  const budget: DayTimeBudget = {
    day: params.day,
    isArrivalDay: policy.isArrivalDay,
    isDepartureDay: policy.isDepartureDay,
    dayStartTime: start,
    dayEndTime: end,
    availableMinutes: available,
    mealMinutes: DEFAULT_MEAL_MINUTES,
    travelMinutes: 0,
    visitMinutes: 0,
    bufferMinutes: params.pace === "slow" ? 60 : DEFAULT_BUFFER_MINUTES,
    remainingMinutes: available,
    stopCount: 0,
    capacityPass: true,
  };
  return budget;
}

export function wouldFitInDayBudget(
  budget: DayTimeBudget,
  place: PlaceResult,
  previous: PlaceResult | null | undefined,
  pace?: VisitDurationPace | null,
): { ok: boolean; visit: number; travel: number; reason?: string } {
  const visit = estimatePlaceVisitDuration(place, { pace }).finalDuration;
  const travel = estimateTravelMinutesBetween(previous, place);
  const need = visit + travel;
  if (need > budget.remainingMinutes) {
    return {
      ok: false,
      visit,
      travel,
      reason: `remaining=${budget.remainingMinutes}<need=${need}`,
    };
  }
  // Theme parks / large sites: must leave meaningful remainder or own the day.
  const family = resolvePlaceCategoryFamily(place);
  if (
    (family === "theme_park" || family === "zoo_aquarium") &&
    budget.stopCount >= 1 &&
    budget.remainingMinutes - need < 60
  ) {
    return { ok: false, visit, travel, reason: `large_site_overload:${family}` };
  }
  return { ok: true, visit, travel };
}

export function applyPlaceToDayBudget(
  budget: DayTimeBudget,
  place: PlaceResult,
  previous: PlaceResult | null | undefined,
  pace?: VisitDurationPace | null,
): DayTimeBudget {
  const fit = wouldFitInDayBudget(budget, place, previous, pace);
  const visit = fit.visit;
  const travel = fit.travel;
  const remaining = Math.max(0, budget.remainingMinutes - visit - travel);
  const next: DayTimeBudget = {
    ...budget,
    visitMinutes: budget.visitMinutes + visit,
    travelMinutes: budget.travelMinutes + travel,
    remainingMinutes: remaining,
    stopCount: budget.stopCount + 1,
    capacityPass: remaining >= 0 && fit.ok,
  };
  return next;
}

export function logDayCapacitySummary(budget: DayTimeBudget): void {
  logAiPipeline(
    "[DAY_CAPACITY_SUMMARY]",
    `day=${budget.day}`,
    `isArrivalDay=${budget.isArrivalDay}`,
    `isDepartureDay=${budget.isDepartureDay}`,
    `dayStartTime=${budget.dayStartTime}`,
    `dayEndTime=${budget.dayEndTime}`,
    `availableMinutes=${budget.availableMinutes}`,
    `stopCount=${budget.stopCount}`,
    `visitMinutes=${budget.visitMinutes}`,
    `travelMinutes=${budget.travelMinutes}`,
    `mealMinutes=${budget.mealMinutes}`,
    `bufferMinutes=${budget.bufferMinutes}`,
    `remainingMinutes=${budget.remainingMinutes}`,
    `capacityPass=${budget.capacityPass && budget.remainingMinutes >= 0}`,
  );
}

export type DayLoadScore = {
  day: number;
  visitMinutes: number;
  travelMinutes: number;
  stopCount: number;
  categoryRepetitionPenalty: number;
  loadScore: number;
};

export function computeDayLoadScore(
  day: number,
  places: PlaceResult[],
  travelMinutes: number,
): DayLoadScore {
  let visitMinutes = 0;
  const familyCounts = new Map<PlaceCategoryFamily, number>();
  for (const p of places) {
    visitMinutes += estimatePlaceVisitDuration(p).finalDuration;
    const f = resolvePlaceCategoryFamily(p);
    familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
  }
  let categoryRepetitionPenalty = 0;
  for (const count of familyCounts.values()) {
    if (count > 1) categoryRepetitionPenalty += (count - 1) * 40;
  }
  const stopCountPenalty = Math.max(0, places.length - 4) * 25;
  const longDistancePenalty = travelMinutes > 120 ? (travelMinutes - 120) * 0.5 : 0;
  const loadScore =
    visitMinutes +
    travelMinutes * 0.8 +
    stopCountPenalty +
    categoryRepetitionPenalty +
    longDistancePenalty;
  return {
    day,
    visitMinutes,
    travelMinutes,
    stopCount: places.length,
    categoryRepetitionPenalty,
    loadScore,
  };
}

export function logItineraryLoadBalance(
  scores: DayLoadScore[],
): { gatePass: boolean; imbalancePercent: number } {
  if (!scores.length) {
    return { gatePass: true, imbalancePercent: 0 };
  }
  const loads = scores.map((s) => s.loadScore);
  const averageLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
  const maxLoad = Math.max(...loads);
  const minLoad = Math.min(...loads);
  const imbalancePercent =
    averageLoad > 0 ? ((maxLoad - minLoad) / averageLoad) * 100 : 0;
  const overloadedDays = scores
    .filter((s) => s.loadScore > averageLoad * 1.35)
    .map((s) => s.day);
  const underloadedDays = scores
    .filter((s) => s.loadScore < averageLoad * 0.65 && s.stopCount > 0)
    .map((s) => s.day);
  // Day 1 must not be the unique max by a wide margin on full multi-day trips.
  const day1 = scores.find((s) => s.day === 1);
  const day1Over =
    scores.length >= 3 &&
    day1 != null &&
    day1.loadScore === maxLoad &&
    day1.loadScore > averageLoad * 1.4;
  const gatePass = imbalancePercent <= 55 && !day1Over && overloadedDays.length <= 1;

  logAiPipeline(
    "[ITINERARY_LOAD_BALANCE_SUMMARY]",
    `days=${scores.map((s) => s.day).join(",")}`,
    `loadScores=${loads.map((n) => Math.round(n)).join(",")}`,
    `averageLoad=${Math.round(averageLoad)}`,
    `maxLoad=${Math.round(maxLoad)}`,
    `minLoad=${Math.round(minLoad)}`,
    `imbalancePercent=${imbalancePercent.toFixed(1)}`,
    `overloadedDays=${overloadedDays.join(",") || "-"}`,
    `underloadedDays=${underloadedDays.join(",") || "-"}`,
    `gatePass=${gatePass}`,
  );

  return { gatePass, imbalancePercent };
}
