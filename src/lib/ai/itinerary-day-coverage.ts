/**
 * Day Map Source of Truth + empty-day coverage repair.
 *
 * dayNumber is always 1…tripDays. Planner / Auto Repair / Validator / Persistence
 * must use the same normalized map — never leave a travel day empty solely because
 * candidates were packed into earlier days.
 */

import type { ComposedDayPlan, DayPlanEntry } from "@/lib/ai/ai-day-plan-source";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
  wouldViolateDailyDiversity,
  type DailyDiversityCategory,
} from "@/lib/ai/daily-category-diversity";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import {
  isPlaceLocked,
  type SelectedPlaceLock,
} from "@/lib/ai/required-anchor-runtime";

export type DayCoveragePlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

export type DayCoveragePlan = {
  day: number;
  entries: DayCoveragePlanEntry[];
  isIncomplete?: boolean;
  /** Explicit free day (user-requested). Empty is allowed only when true. */
  dayType?: "travel_day" | "free_day";
  userRequestedFreeDay?: boolean;
};

export type DayCoverageTargets = {
  dayNumber: number;
  isArrivalDay: boolean;
  isDepartureDay: boolean;
  isFreeDay: boolean;
  minimumStops: number;
  targetStops: number;
  maximumStops: number;
};

export type DayCoverageGateResult = {
  expectedDays: number;
  actualDays: number;
  nonEmptyDays: number[];
  emptyDays: number[];
  dayCounts: number[];
  arrivalDayPolicy: string;
  departureDayPolicy: string;
  allDaysCovered: boolean;
};

export type ItineraryFailureChain = {
  primary: string;
  validator?: string;
  persistence?: string;
  affectedDays?: number[];
  payloadPresent?: boolean;
  dayCount?: number;
  stopCount?: number;
  failedRules?: string[];
  warnings?: string[];
};

const FULL_DAY_MIN_STOPS = 2;
const PARTIAL_DAY_MIN_STOPS = 1;

function clonePlans<T extends DayCoveragePlan>(plans: readonly T[]): T[] {
  return plans.map((p) => ({
    ...p,
    entries: [...p.entries],
  })) as T[];
}

function isLockedEntry(
  entry: DayCoveragePlanEntry,
  lock: SelectedPlaceLock | null | undefined,
): boolean {
  if (!lock) return false;
  return isPlaceLocked(
    {
      name: entry.name,
      placeName: entry.place.name,
      id: entry.place.id,
      googlePlaceId: entry.place.id,
    },
    lock,
  );
}

/** Build complete dayNumber 1…tripDays map (empty shells allowed). */
export function normalizeCompleteDayMap<T extends DayCoveragePlan>(
  plans: readonly T[],
  tripDays: number,
): T[] {
  const safeDays = Math.max(1, tripDays);
  const byDay = new Map<number, T>();
  for (const plan of plans) {
    const day = Math.max(1, Math.floor(plan.day));
    if (day > safeDays) continue;
    const existing = byDay.get(day);
    if (!existing) {
      byDay.set(day, { ...plan, day, entries: [...plan.entries] } as T);
    } else {
      byDay.set(day, {
        ...existing,
        entries: [...existing.entries, ...plan.entries],
      } as T);
    }
  }
  const out: T[] = [];
  for (let day = 1; day <= safeDays; day += 1) {
    out.push(byDay.get(day) ?? ({ day, entries: [] } as unknown as T));
  }
  return out;
}

export function resolveDayCoverageTargets(params: {
  tripDays: number;
  totalStops: number;
  partialDays?: readonly number[];
  freeDays?: readonly number[];
  maxPerDay?: number;
}): DayCoverageTargets[] {
  const safeDays = Math.max(1, params.tripDays);
  const partial = new Set(params.partialDays ?? []);
  const free = new Set(params.freeDays ?? []);
  const maxPerDay = Math.max(2, params.maxPerDay ?? 6);

  const mins: number[] = [];
  for (let day = 1; day <= safeDays; day += 1) {
    if (free.has(day)) {
      mins.push(0);
      continue;
    }
    // Explicit partial (late arrival / early departure) may use 1; otherwise full-day min=2.
    mins.push(partial.has(day) ? PARTIAL_DAY_MIN_STOPS : FULL_DAY_MIN_STOPS);
  }

  const requiredMin = mins.reduce((a, b) => a + b, 0);
  // Prefer fewer stops/day over empty days when total cannot meet full-day mins.
  let effectiveMins = [...mins];
  if (params.totalStops > 0 && params.totalStops < requiredMin) {
    effectiveMins = mins.map((m) => (m === 0 ? 0 : PARTIAL_DAY_MIN_STOPS));
  }

  const activeDays = effectiveMins.filter((m) => m > 0).length || safeDays;
  const base = Math.min(
    maxPerDay,
    Math.max(0, Math.floor(params.totalStops / Math.max(1, activeDays))),
  );
  const targets = effectiveMins.map((m) => (m === 0 ? 0 : Math.max(m, base)));
  let assigned = targets.reduce((a, b) => a + b, 0);
  // Trim if base push exceeded total (e.g. mins already high).
  while (assigned > params.totalStops) {
    let trimmed = false;
    for (let i = 0; i < safeDays; i += 1) {
      if ((targets[i] ?? 0) > (effectiveMins[i] ?? 0)) {
        targets[i] = (targets[i] ?? 0) - 1;
        assigned -= 1;
        trimmed = true;
        if (assigned <= params.totalStops) break;
      }
    }
    if (!trimmed) break;
  }
  // Spread remainder — bias middle/later days, not Day 1.
  let extra = Math.max(0, params.totalStops - assigned);
  for (let e = 0; e < extra; e += 1) {
    const idx =
      safeDays <= 1
        ? 0
        : Math.min(safeDays - 1, Math.floor(((e + 1) * safeDays) / (extra + 1)));
    if ((effectiveMins[idx] ?? 0) === 0) {
      // Fall back to last non-free day.
      for (let j = safeDays - 1; j >= 0; j -= 1) {
        if ((effectiveMins[j] ?? 0) > 0 && (targets[j] ?? 0) < maxPerDay) {
          targets[j] = (targets[j] ?? 0) + 1;
          break;
        }
      }
      continue;
    }
    if ((targets[idx] ?? 0) < maxPerDay) {
      targets[idx] = (targets[idx] ?? 0) + 1;
    }
  }

  return Array.from({ length: safeDays }, (_, i) => {
    const dayNumber = i + 1;
    const isFreeDay = free.has(dayNumber);
    const isArrivalDay = dayNumber === 1 && safeDays >= 2;
    const isDepartureDay = dayNumber === safeDays && safeDays >= 2;
    return {
      dayNumber,
      isArrivalDay,
      isDepartureDay,
      isFreeDay,
      minimumStops: effectiveMins[i] ?? 0,
      targetStops: targets[i] ?? 0,
      maximumStops: maxPerDay,
    };
  });
}

function dayCentroid(entries: DayCoveragePlanEntry[]): { lat: number; lng: number } | null {
  const coords = entries
    .map((e) => e.place)
    .filter((p) => p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!coords.length) return null;
  const lat = coords.reduce((s, p) => s + (p.lat as number), 0) / coords.length;
  const lng = coords.reduce((s, p) => s + (p.lng as number), 0) / coords.length;
  return { lat, lng };
}

function pickDonorEntry(
  donor: DayCoveragePlan,
  recipient: DayCoveragePlan,
  emptyCentroid: { lat: number; lng: number } | null,
  lock: SelectedPlaceLock | null | undefined,
  donorFloor: number,
  nearbyGuard?: NearbyDayCoverageGuard | null,
  limits = resolveDailyDiversityLimits(),
): {
  index: number;
  entry: DayCoveragePlanEntry;
  diversityFamily: DailyDiversityCategory;
  recipientCountBefore: number;
  cap: number;
} | null {
  if (donor.entries.length <= donorFloor) return null;
  let bestIdx = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDiversity = wouldViolateDailyDiversity([], donor.entries[0]!.place, limits);
  for (let i = donor.entries.length - 1; i >= 0; i -= 1) {
    const entry = donor.entries[i]!;
    const diversity = wouldViolateDailyDiversity(
      recipient.entries.map((candidate) => candidate.place),
      entry.place,
      limits,
    );
    if (isLockedEntry(entry, lock)) {
      logDayCoverageMove(donor.day, recipient.day, entry, diversity, false, "locked");
      continue;
    }
    if (!canMovePlaceToDay(entry, recipient.day, nearbyGuard)) {
      logDayCoverageMove(donor.day, recipient.day, entry, diversity, false, "invalid_recipient");
      continue;
    }
    if (!diversity.ok) {
      logDayCoverageMove(donor.day, recipient.day, entry, diversity, false, "diversity_cap");
      continue;
    }
    // Prefer movable tourism stops; keep first stop as soft anchor when possible.
    if (i === 0 && donor.entries.length > donorFloor + 1) continue;
    let score = i; // later stops preferred
    if (emptyCentroid && entry.place.lat != null && entry.place.lng != null) {
      score = distanceMeters(
        { lat: entry.place.lat, lng: entry.place.lng },
        emptyCentroid,
      );
    }
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
      bestDiversity = diversity;
    }
  }
  if (bestIdx < 0) return null;
  return {
    index: bestIdx,
    entry: donor.entries[bestIdx]!,
    diversityFamily: bestDiversity.category,
    recipientCountBefore: bestDiversity.count,
    cap: bestDiversity.limit,
  };
}

function logDayCoverageMove(
  donorDay: number,
  recipientDay: number,
  entry: DayCoveragePlanEntry,
  diversity: ReturnType<typeof wouldViolateDailyDiversity>,
  moveAccepted: boolean,
  rejectionReason: "" | "diversity_cap" | "locked" | "invalid_recipient" | "no_eligible_donor",
): void {
  logAiPipeline(
    "[DAY_COVERAGE_MOVE]",
    `donorDay=${donorDay}`,
    `recipientDay=${recipientDay}`,
    `placeId=${entry.place.id ?? ""}`,
    `diversityFamily=${diversity.category}`,
    `recipientCountBefore=${diversity.count}`,
    `cap=${Number.isFinite(diversity.limit) ? diversity.limit : "unlimited"}`,
    `moveAccepted=${moveAccepted}`,
    `rejectionReason=${rejectionReason}`,
  );
}

export type NearbyDayCoverageGuard = {
  /** True when place belongs to a nearby extension (Yokohama, etc.). */
  isNearbyPlace: (place: PlaceResult) => boolean;
  /** Days reserved for nearby-extension concentration. */
  dedicatedDays: ReadonlySet<number>;
};

function canMovePlaceToDay(
  entry: DayCoveragePlanEntry,
  targetDay: number,
  nearbyGuard?: NearbyDayCoverageGuard | null,
): boolean {
  if (!nearbyGuard) return true;
  const nearby = nearbyGuard.isNearbyPlace(entry.place);
  const targetDedicated = nearbyGuard.dedicatedDays.has(targetDay);
  // Nearby places stay on dedicated days; primary-city places stay off them when possible.
  if (nearby && !targetDedicated) return false;
  if (!nearby && targetDedicated) return false;
  return true;
}

/**
 * Peel from heaviest days into empty / under-minimum days until coverage mins met.
 * Does not invent places. Returns mutated clone.
 */
export function ensureAllDaysCovered<T extends DayCoveragePlan>(params: {
  plans: readonly T[];
  tripDays: number;
  partialDays?: readonly number[];
  freeDays?: readonly number[];
  maxPerDay?: number;
  style?: TripStyleKey;
  lock?: SelectedPlaceLock | null;
  nearbyGuard?: NearbyDayCoverageGuard | null;
  /** Log tag prefix context */
  source?: string;
}): { plans: T[]; changed: boolean; emptyDaysRemaining: number[] } {
  let plans = normalizeCompleteDayMap(clonePlans(params.plans), params.tripDays);
  const diversityLimits = resolveDailyDiversityLimits({ style: params.style });
  const totalStops = plans.reduce((n, p) => n + p.entries.length, 0);
  const targets = resolveDayCoverageTargets({
    tripDays: params.tripDays,
    totalStops,
    partialDays: params.partialDays,
    freeDays: params.freeDays,
    maxPerDay: params.maxPerDay,
  });
  const beforeCounts = plans.map((p) => p.entries.length);
  let changed = false;

  // Mathematically impossible to put ≥1 stop on every non-free day.
  const required = targets.reduce((n, t) => n + t.minimumStops, 0);
  if (totalStops < required) {
    logAiPipeline(
      "[EMPTY_DAY_REPAIR]",
      `source=${params.source ?? "ensureAllDaysCovered"}`,
      `repairResult=impossible`,
      `failureReason=total_stops_below_minimum`,
      `totalStops=${totalStops}`,
      `required=${required}`,
      `beforeDayCounts=${beforeCounts.join(",")}`,
    );
    return {
      plans,
      changed: false,
      emptyDaysRemaining: plans
        .filter((p) => {
          const t = targets.find((x) => x.dayNumber === p.day);
          return (t?.minimumStops ?? 0) > 0 && p.entries.length === 0;
        })
        .map((p) => p.day),
    };
  }

  const maxPasses = params.tripDays * 6;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const under = plans
      .map((p, idx) => ({ plan: p, target: targets[idx]! }))
      .filter(({ plan, target }) => plan.entries.length < target.minimumStops)
      .sort((a, b) => a.plan.entries.length - b.plan.entries.length || a.plan.day - b.plan.day);
    if (!under.length) break;

    const { plan: emptyPlan, target } = under[0]!;
    const emptyCentroid = dayCentroid(emptyPlan.entries);

    const donors = [...plans]
      .filter((p) => {
        if (p.day === emptyPlan.day) return false;
        const donorTarget = targets.find((t) => t.dayNumber === p.day);
        const floor = donorTarget?.minimumStops ?? FULL_DAY_MIN_STOPS;
        // Allow peeling one below target when recipient is empty (coverage > balance).
        const softFloor =
          emptyPlan.entries.length === 0 ? Math.max(1, floor - 0) : floor;
        return p.entries.length > softFloor;
      })
      .sort((a, b) => b.entries.length - a.entries.length || b.day - a.day);

    let moved = false;
    for (const donor of donors) {
      if (emptyPlan.entries.length >= target.minimumStops) break;
      const donorTarget = targets.find((t) => t.dayNumber === donor.day);
      const floor =
        emptyPlan.entries.length === 0
          ? Math.max(1, (donorTarget?.minimumStops ?? FULL_DAY_MIN_STOPS) - 0)
          : (donorTarget?.minimumStops ?? FULL_DAY_MIN_STOPS);
      // When recipient still empty, allow donor to go down to 2 (or 1 if totals force it).
      const peelFloor =
        emptyPlan.entries.length === 0
          ? Math.min(floor, Math.max(PARTIAL_DAY_MIN_STOPS, FULL_DAY_MIN_STOPS))
          : floor;
      if (donor.entries.length <= peelFloor) continue;

      const pick = pickDonorEntry(
        donor,
        emptyPlan,
        emptyCentroid,
        params.lock,
        peelFloor,
        params.nearbyGuard,
        diversityLimits,
      );
      if (!pick) continue;

      donor.entries.splice(pick.index, 1);
      emptyPlan.entries.push(pick.entry);
      logDayCoverageMove(
        donor.day,
        emptyPlan.day,
        pick.entry,
        {
          ok: true,
          category: pick.diversityFamily,
          count: pick.recipientCountBefore,
          limit: pick.cap,
        },
        true,
        "",
      );
      changed = true;
      moved = true;

      const afterCounts = plans.map((p) => p.entries.length);
      logAiPipeline(
        "[EMPTY_DAY_REPAIR]",
        `emptyDay=${emptyPlan.day}`,
        `donorDay=${donor.day}`,
        `movedPlaceId=${pick.entry.place.id ?? ""}`,
        `movedPlaceName=${pick.entry.name}`,
        `beforeDayCounts=${beforeCounts.join(",")}`,
        `afterDayCounts=${afterCounts.join(",")}`,
        `repairResult=moved`,
        `failureReason=`,
        `source=${params.source ?? "ensureAllDaysCovered"}`,
      );
    }

    if (!moved) {
      logAiPipeline(
        "[EMPTY_DAY_REPAIR]",
        `emptyDay=${emptyPlan.day}`,
        `donorDay=`,
        `movedPlaceId=`,
        `movedPlaceName=`,
        `beforeDayCounts=${beforeCounts.join(",")}`,
        `afterDayCounts=${plans.map((p) => p.entries.length).join(",")}`,
        `repairResult=failed`,
        `failureReason=no_eligible_donor`,
        `source=${params.source ?? "ensureAllDaysCovered"}`,
      );
      break;
    }
  }

  // Second pass: push toward targetStops (balance), without creating new empties.
  for (let pass = 0; pass < params.tripDays * 4; pass += 1) {
    const light = plans
      .map((p, idx) => ({ plan: p, target: targets[idx]! }))
      .filter(({ plan, target }) => plan.entries.length < target.targetStops)
      .sort((a, b) => a.plan.entries.length - b.plan.entries.length)[0];
    if (!light) break;
    const heavy = [...plans]
      .filter((p) => {
        const t = targets.find((x) => x.dayNumber === p.day);
        return p.day !== light.plan.day && p.entries.length > (t?.targetStops ?? light.target.targetStops);
      })
      .sort((a, b) => b.entries.length - a.entries.length)[0];
    if (!heavy) break;
    const heavyFloor = targets.find((t) => t.dayNumber === heavy.day)?.minimumStops ?? FULL_DAY_MIN_STOPS;
    const pick = pickDonorEntry(
      heavy,
      light.plan,
      dayCentroid(light.plan.entries),
      params.lock,
      heavyFloor,
      params.nearbyGuard,
      diversityLimits,
    );
    if (!pick) break;
    heavy.entries.splice(pick.index, 1);
    light.plan.entries.push(pick.entry);
    logDayCoverageMove(
      heavy.day,
      light.plan.day,
      pick.entry,
      {
        ok: true,
        category: pick.diversityFamily,
        count: pick.recipientCountBefore,
        limit: pick.cap,
      },
      true,
      "",
    );
    changed = true;
  }

  const emptyDaysRemaining = plans
    .filter((p) => {
      const t = targets.find((x) => x.dayNumber === p.day);
      return (t?.minimumStops ?? 0) > 0 && p.entries.length === 0;
    })
    .map((p) => p.day);

  if (changed || emptyDaysRemaining.length) {
    logAiPipeline(
      "[EMPTY_DAY_REPAIR]",
      `emptyDay=${emptyDaysRemaining.join(",") || "(none)"}`,
      `beforeDayCounts=${beforeCounts.join(",")}`,
      `afterDayCounts=${plans.map((p) => p.entries.length).join(",")}`,
      `repairResult=${emptyDaysRemaining.length ? "partial" : "covered"}`,
      `failureReason=${emptyDaysRemaining.length ? "remaining_empty_days" : ""}`,
      `source=${params.source ?? "ensureAllDaysCovered"}`,
    );
  }

  return { plans, changed, emptyDaysRemaining };
}

export function evaluateDayCoverageGate(params: {
  plans: readonly DayCoveragePlan[];
  tripDays: number;
  partialDays?: readonly number[];
  freeDays?: readonly number[];
}): DayCoverageGateResult {
  const normalized = normalizeCompleteDayMap(params.plans, params.tripDays);
  const totalStops = normalized.reduce((n, p) => n + p.entries.length, 0);
  const targets = resolveDayCoverageTargets({
    tripDays: params.tripDays,
    totalStops,
    partialDays: params.partialDays,
    freeDays: params.freeDays,
  });
  const dayCounts = normalized.map((p) => p.entries.length);
  const emptyDays: number[] = [];
  const nonEmptyDays: number[] = [];
  for (const plan of normalized) {
    if (plan.entries.length > 0) nonEmptyDays.push(plan.day);
    else {
      const t = targets.find((x) => x.dayNumber === plan.day);
      if ((t?.minimumStops ?? 0) > 0 && !t?.isFreeDay) emptyDays.push(plan.day);
    }
  }
  const allDaysCovered = emptyDays.length === 0;
  const result: DayCoverageGateResult = {
    expectedDays: params.tripDays,
    actualDays: normalized.length,
    nonEmptyDays,
    emptyDays,
    dayCounts,
    arrivalDayPolicy: `min=${PARTIAL_DAY_MIN_STOPS}`,
    departureDayPolicy: `min=${PARTIAL_DAY_MIN_STOPS}`,
    allDaysCovered,
  };
  logAiPipeline(
    "[ITINERARY_DAY_COVERAGE_GATE]",
    `expectedDays=${result.expectedDays}`,
    `actualDays=${result.actualDays}`,
    `nonEmptyDays=${nonEmptyDays.join(",")}`,
    `emptyDays=${emptyDays.join(",") || "(none)"}`,
    `dayCounts=${dayCounts.join(",")}`,
    `arrivalDayPolicy=${result.arrivalDayPolicy}`,
    `departureDayPolicy=${result.departureDayPolicy}`,
    `allDaysCovered=${allDaysCovered}`,
  );
  return result;
}

export function logItineraryFailureChain(chain: ItineraryFailureChain): void {
  logAiPipeline(
    "[ITINERARY_FAILURE_CHAIN]",
    JSON.stringify({
      primary: chain.primary,
      validator: chain.validator ?? "",
      persistence: chain.persistence ?? "",
      payloadPresent: chain.payloadPresent ?? false,
      dayCount: chain.dayCount ?? 0,
      stopCount: chain.stopCount ?? 0,
      failedRules: chain.failedRules ?? [],
      warnings: chain.warnings ?? [],
      affectedDays: chain.affectedDays ?? [],
    }),
  );
}

/**
 * Move diversity violators to other days (do not drop locked / required anchors).
 */
export function repairDailyDiversityByMove<T extends DayCoveragePlan>(params: {
  plans: readonly T[];
  tripDays: number;
  style?: TripStyleKey;
  lock?: SelectedPlaceLock | null;
}): { plans: T[]; moved: number } {
  const limits = resolveDailyDiversityLimits({ style: params.style });
  const plans = normalizeCompleteDayMap(clonePlans(params.plans), params.tripDays);
  let moved = 0;

  for (const plan of plans) {
    const kept: DayCoveragePlanEntry[] = [];
    const keptPlaces: PlaceResult[] = [];
    const overflow: DayCoveragePlanEntry[] = [];

    for (const entry of plan.entries) {
      if (isLockedEntry(entry, params.lock)) {
        kept.push(entry);
        keptPlaces.push(entry.place);
        continue;
      }
      const check = wouldViolateDailyDiversity(keptPlaces, entry.place, limits);
      if (!check.ok) {
        overflow.push(entry);
        continue;
      }
      kept.push(entry);
      keptPlaces.push(entry.place);
    }
    plan.entries = kept;

    for (const entry of overflow) {
      const category = classifyDailyDiversityCategory(entry.place) as DailyDiversityCategory;
      const beforeCount =
        keptPlaces.filter((p) => classifyDailyDiversityCategory(p) === category).length + 1;
      const limit =
        category in limits
          ? limits[category as keyof typeof limits]
          : Number.POSITIVE_INFINITY;

      let target: T | null = null;
      for (const other of plans) {
        if (other.day === plan.day) continue;
        const otherPlaces = other.entries.map((e) => e.place);
        if (wouldViolateDailyDiversity(otherPlaces, entry.place, limits).ok) {
          // Prefer days without this category and with spare capacity.
          if (
            !target ||
            other.entries.length < target.entries.length ||
            !otherPlaces.some((p) => classifyDailyDiversityCategory(p) === category)
          ) {
            target = other;
          }
        }
      }

      if (target) {
        target.entries.push(entry);
        moved += 1;
        const afterCount = target.entries.filter(
          (e) => classifyDailyDiversityCategory(e.place) === category,
        ).length;
        logAiPipeline(
          "[DAILY_CATEGORY_HARD_GATE]",
          `day=${plan.day}`,
          `placeId=${entry.place.id}`,
          `placeName=${entry.place.localizedDisplayName ?? entry.name}`,
          `rawType=${entry.place.primaryType ?? entry.place.types?.[0] ?? ""}`,
          `categoryFamily=${category}`,
          `currentCount=${beforeCount}`,
          `limit=${limit}`,
          "action=move",
          `replacementPlaceId=${entry.place.id}`,
          `replacementCategoryFamily=${category}`,
        );
        logAiPipeline(
          "[DAILY_DIVERSITY_REPAIR]",
          `day=${plan.day}`,
          `violatingCategory=${category}`,
          `beforeCount=${beforeCount}`,
          `limit=${limit}`,
          `action=move`,
          `movedOrReplacedPlace=${entry.name}`,
          `targetDay=${target.day}`,
          `afterCount=${afterCount}`,
          `repairPass=true`,
        );
      } else {
        // No valid home. Preserve the anchor for the next replan pass, but never
        // claim delivery success; the final hard gate will reject this plan.
        plan.entries.push(entry);
        keptPlaces.push(entry.place);
        logAiPipeline(
          "[DAILY_DIVERSITY_REPAIR]",
          `day=${plan.day}`,
          `violatingCategory=${category}`,
          `beforeCount=${beforeCount}`,
          `limit=${limit}`,
          `action=keep_no_target`,
          `movedOrReplacedPlace=${entry.name}`,
          `targetDay=`,
          `afterCount=${beforeCount}`,
          `repairPass=false`,
        );
        logAiPipeline(
          "[DAILY_CATEGORY_HARD_GATE]",
          `day=${plan.day}`,
          `placeId=${entry.place.id}`,
          `placeName=${entry.place.localizedDisplayName ?? entry.name}`,
          `rawType=${entry.place.primaryType ?? entry.place.types?.[0] ?? ""}`,
          `categoryFamily=${category}`,
          `currentCount=${beforeCount}`,
          `limit=${limit}`,
          "action=replan_required",
          "replacementPlaceId=",
          "replacementCategoryFamily=",
        );
      }
    }
  }

  return { plans, moved };
}

export function asComposedDayPlans(plans: DayCoveragePlan[]): ComposedDayPlan[] {
  return plans.map((p) => ({
    day: p.day,
    entries: p.entries as DayPlanEntry[],
    isIncomplete: p.isIncomplete,
  }));
}
