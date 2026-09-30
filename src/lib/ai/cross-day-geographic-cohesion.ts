// Internal planner observation only. Analytics serialization belongs to the server adapter.
const MAX_NORMALIZATION_FAILURES = 4;
type SlotRejectionCounts = { evaluated: number; order: number; used: number; closed: number; window: number };
export type NormalizationFailure = SlotRejectionCounts & { day: number; failedTime?: string };
import type { ComposedDayPlan, DayPlanEntry } from "@/lib/ai/ai-day-plan-source";
import { minItemsPerDayForTrip } from "@/lib/ai/ai-day-plan-source";
import { maxEffectivePlacesPerDay, type PlannerPaceHint } from "@/lib/ai/planner-day-route-assembly";
import { clusterItemsByGeography, type GeoAccessor } from "@/lib/ai/geographic-clustering";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import { dailyDiversityFamilyCounts, resolveDailyDiversityLimits } from "@/lib/ai/daily-category-diversity";
import { LEGAL_DAY_TIME_SLOTS } from "@/lib/ai/day-time-slots";
import { resolveNightlifeClassification } from "@/lib/ai/nightlife-classification";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { distanceMeters } from "@/lib/geo-distance";

export type CrossDayCohesionStage =
  | "post_required_repair"
  | "post_diversity_move"
  | "post_coverage_move"
  | "post_redistribution"
  | "post_rebuild"
  | "final_pre_persistence";

export const TIMELINE_NORMALIZATION_STATUSES = ["not_called", "safe", "no_safe_slot"] as const;

export type TimelineNormalizationStatus = (typeof TIMELINE_NORMALIZATION_STATUSES)[number];

/** Observational result of this repair's normalization invocations. Never read by the repair. */
export type TimelineNormalizationObservation = {
  status: TimelineNormalizationStatus;
  affectedDays?: number[];
  failures?: NormalizationFailure[];
};

export type CrossDayCohesionContext = {
  generationId?: string;
  stage: CrossDayCohesionStage;
  plannedDate?: string;
  pace?: PlannerPaceHint;
  logDiagnostics?: boolean;
  normalizationOutcome?: TimelineNormalizationObservation;
};

const FIXED_DAY_RE =
  /reservation|reserved|預約|预约|預訂|预订|予約|固定日期|指定日期|fixed[_\s-]?day|hard[_\s-]?date/i;

function coords(entry: DayPlanEntry): { lat: number; lng: number } | null {
  const { lat, lng } = entry.place;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat ?? 0) < 0.0001 && Math.abs(lng ?? 0) < 0.0001) return null;
  return { lat: lat!, lng: lng! };
}

function fixedReason(entry: DayPlanEntry): "fixed_day" | "nearby_extension" | null {
  if (entry.place.destinationScope === "nearby_extension" || entry.place.extensionDestination) {
    return "nearby_extension";
  }
  return FIXED_DAY_RE.test([entry.label, entry.name, entry.place.primaryType, ...(entry.place.types ?? [])].join(" "))
    ? "fixed_day"
    : null;
}

function hashEntry(entry: DayPlanEntry): string {
  const value = `${entry.place.googlePlaceId ?? entry.place.id ?? ""}|${entry.name}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `s_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function centroid(entries: readonly DayPlanEntry[]): { lat: number; lng: number } | null {
  const points = entries.map(coords).filter((point): point is { lat: number; lng: number } => point != null);
  if (!points.length) return null;
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

function nearestDistance(entry: DayPlanEntry, entries: readonly DayPlanEntry[]): number {
  const point = coords(entry);
  if (!point) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const other of entries) {
    if (other === entry) continue;
    const target = coords(other);
    if (target) best = Math.min(best, distanceMeters(point, target));
  }
  return best;
}

function dayCost(entries: readonly DayPlanEntry[]): number {
  const center = centroid(entries);
  if (!center) return 0;
  return entries.reduce((sum, entry) => {
    const point = coords(entry);
    return sum + (point ? distanceMeters(point, center) : 0);
  }, 0);
}

function diversityOverflow(entries: readonly DayPlanEntry[]): number {
  const counts = dailyDiversityFamilyCounts(entries.map((entry) => entry.place));
  const limits = resolveDailyDiversityLimits({ style: "mixed" });
  return Object.entries(limits).reduce(
    (sum, [family, limit]) => sum + Math.max(0, (counts[family] ?? 0) - limit),
    0,
  );
}

function dateForDay(plannedDate: string | undefined, day: number): string | undefined {
  if (!plannedDate) return undefined;
  const date = new Date(`${plannedDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return plannedDate;
  date.setDate(date.getDate() + day - 1);
  return date.toISOString().slice(0, 10);
}

function legalOnDay(entry: DayPlanEntry, day: number, context: CrossDayCohesionContext): boolean {
  if (fixedReason(entry)) return false;
  return isClearlyClosedAtSlot(entry.place, dateForDay(context.plannedDate, day), entry.time) !== true;
}

const ACCESSOR: GeoAccessor<{ entry: DayPlanEntry; day: number }> = {
  coords: (item) => coords(item.entry),
  id: (item) => hashEntry(item.entry),
  name: () => "",
  address: (item) => item.entry.place.address ?? "",
  weight: (item) => item.entry.place.userRatingCount ?? 0,
};

function clockMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const LEGAL_DAY_MINUTES = LEGAL_DAY_TIME_SLOTS.map((slot) => ({
  slot,
  minutes: clockMinutes(slot)!,
}));

/** Meal windows already enforced by the itinerary validator. */
function mealWindow(label: string): { start: number; end: number } | null {
  if (/早餐|breakfast/i.test(label)) return { start: 7 * 60, end: 10 * 60 };
  if (/午餐|lunch/i.test(label)) return { start: 11 * 60 + 30, end: 13 * 60 + 30 };
  if (/晚餐|dinner/i.test(label)) return { start: 17 * 60 + 30, end: 19 * 60 + 30 };
  return null;
}

function nightlifeFloor(entry: DayPlanEntry): number | null {
  const classification = resolveNightlifeClassification(entry.place);
  if (!classification.isNightlife || classification.confidence < 0.9) return null;
  return classification.nightlifeSubtype === "night_market" ? 17 * 60 + 30 : 18 * 60;
}

function replacementWindow(entry: DayPlanEntry): { start: number; end: number } | null {
  const meal = mealWindow(entry.label ?? "");
  if (meal) return meal;
  const floor = nightlifeFloor(entry);
  if (floor == null) return null;
  return { start: floor, end: 24 * 60 };
}

function slotIsOpen(entry: DayPlanEntry, plannedDate: string | undefined, slot: string): boolean {
  return isClearlyClosedAtSlot(entry.place, plannedDate, slot) !== true;
}

function fitsWindow(minutes: number, window: { start: number; end: number } | null): boolean {
  if (!window) return true;
  return minutes >= window.start && minutes < window.end;
}

export type SameDayClockNormalization = {
  entries: DayPlanEntry[];
  /** False when any stop had no clock that is unique, later, open, and in-contract. */
  safe: boolean;
};

function nextSafeClock(
  entry: DayPlanEntry,
  previous: number,
  used: ReadonlySet<number>,
  plannedDate: string | undefined,
  counts: SlotRejectionCounts,
): { slot: string; minutes: number } | undefined {
  const window = replacementWindow(entry);
  // Same short-circuit predicates, same order, same first legal slot. Attribute one rejection per evaluated slot.
  return LEGAL_DAY_MINUTES.find(({ minutes, slot }) => {
    counts.evaluated++;
    if (!(minutes > previous)) { counts.order++; return false; }
    if (used.has(minutes)) { counts.used++; return false; }
    if (!slotIsOpen(entry, plannedDate, slot)) { counts.closed++; return false; }
    if (!fitsWindow(minutes, window)) { counts.window++; return false; }
    return true;
  });
}

/**
 * Give one affected day strictly increasing, unique clocks.
 * A replacement is applied only when every stop can keep its clock or move to a
 * slot that is unused, later, not clearly closed, inside meal/nightlife rules,
 * and drawn from the existing day-slot lists.
 * If any stop has no such slot, the day is left unchanged so the existing
 * timeline validator still blocks delivery.
 */
export function normalizeSameDayClockConflicts(
  entries: readonly DayPlanEntry[],
  plannedDate?: string,
  day?: number,
  onFailure?: (failure: NormalizationFailure) => void,
): SameDayClockNormalization {
  const used = new Set<number>();
  const assigned = new Map<number, number>();
  let previous = -1;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const current = clockMinutes(entry.time);
    const window = replacementWindow(entry);
    const canKeep =
      current != null &&
      current > previous &&
      !used.has(current) &&
      fitsWindow(current, window) &&
      slotIsOpen(entry, plannedDate, entry.time);
    if (canKeep) {
      used.add(current);
      previous = current;
      continue;
    }
    const counts: SlotRejectionCounts = {
      evaluated: 0, order: 0, used: 0,
      closed: 0, window: 0,
    };
    const choice = nextSafeClock(entry, previous, used, plannedDate, counts);
    if (!choice) {
      logAiPipeline(
        "[ITINERARY_TIMELINE_NORMALIZE]",
        "safe=false",
        "reason=no_safe_slot",
        `day=${day ?? ""}`,
        `stops=${entries.length}`,
      );
      try {
        if (day !== undefined) onFailure?.({ day, failedTime: entry.time, ...counts });
      } catch {
        // Observation must never change the no-safe-slot result.
      }
      return { entries: [...entries], safe: false };
    }
    assigned.set(index, choice.minutes);
    used.add(choice.minutes);
    previous = choice.minutes;
  }

  return {
    safe: true,
    entries: entries.map((entry, index) => {
      const minutes = assigned.get(index);
      if (minutes == null) return entry;
      return { ...entry, time: formatClock(minutes) };
    }),
  };
}

function membershipChanged(
  before: readonly DayPlanEntry[],
  after: readonly DayPlanEntry[],
): boolean {
  if (before.length !== after.length) return true;
  return after.some((entry, index) => entry !== before[index]);
}

function uniqueDays(days: readonly number[]): number[] {
  return [...new Set(days)].sort((left, right) => left - right);
}

/** Records invocations that already returned. Does not choose clocks or membership. */
function publishNormalizationOutcome(
  context: CrossDayCohesionContext,
  invoked: readonly { day: number; safe: boolean }[],
  failures: readonly NormalizationFailure[] = [],
): void {
  const outcome = context.normalizationOutcome;
  if (!outcome) return;
  try {
    delete outcome.failures;
    if (failures.length) outcome.failures = [...failures];
  } catch {
    // Diagnostic sink failure has no effect on repair output.
  }
  const failedDays = uniqueDays(invoked.filter((item) => !item.safe).map((item) => item.day));
  if (invoked.length === 0) {
    outcome.status = "not_called";
    outcome.affectedDays = undefined;
    return;
  }
  if (failedDays.length > 0) {
    outcome.status = "no_safe_slot";
    outcome.affectedDays = failedDays;
    return;
  }
  outcome.status = "safe";
  outcome.affectedDays = uniqueDays(invoked.map((item) => item.day));
}

function bucketDistance(value: number): string {
  if (value < 250) return "lt_250m";
  if (value < 750) return "250_749m";
  if (value < 2_000) return "750_1999m";
  if (value < 5_000) return "2_5km";
  return "gte_5km";
}

/**
 * Final deterministic cross-day authority.
 * Move and swap change day membership only. Intraday order stays put.
 * Days whose membership changed then get unique, increasing clocks.
 */
export function repairCrossDayGeographicCohesion(
  input: readonly ComposedDayPlan[],
  context: CrossDayCohesionContext,
): ComposedDayPlan[] {
  const plans = input.map((plan) => ({ ...plan, entries: [...plan.entries] }));
  const entriesBeforeRepair = new Map(plans.map((plan) => [plan.day, [...plan.entries]]));
  const located = plans.flatMap((plan) => plan.entries.map((entry) => ({ entry, day: plan.day }))).filter((item) => coords(item.entry));
  const invoked: { day: number; safe: boolean }[] = [];
  const failures: NormalizationFailure[] = [];
  if (located.length < 2 || plans.length < 2) {
    publishNormalizationOutcome(context, invoked);
    return plans;
  }
  const { clusters } = clusterItemsByGeography(located, plans.length, ACCESSOR, { fitToDays: false });
  const maxPerDay = maxEffectivePlacesPerDay(context.pace);
  const minPerDay = minItemsPerDayForTrip(plans.length);
  let repairApplied = false;

  for (const cluster of clusters) {
    const clusterHashes = new Set(cluster.items.map((item) => hashEntry(item.entry)));
    const membersByDay = plans.map((plan) => ({
      plan,
      members: plan.entries.filter((entry) => clusterHashes.has(hashEntry(entry))),
    })).filter((item) => item.members.length);
    if (membersByDay.length <= 1) continue;
    const target = [...membersByDay].sort((a, b) => b.members.length - a.members.length || a.plan.day - b.plan.day)[0]!;

    for (const source of membersByDay.filter((item) => item.plan.day !== target.plan.day)) {
      for (const entry of [...source.members]) {
        if (!legalOnDay(entry, target.plan.day, context)) continue;
        const sourceIndex = source.plan.entries.indexOf(entry);
        if (sourceIndex < 0) continue;
        const before = dayCost(source.plan.entries) + dayCost(target.plan.entries);
        const diversityBefore = diversityOverflow(source.plan.entries) + diversityOverflow(target.plan.entries);
        if (target.plan.entries.length < maxPerDay && source.plan.entries.length > minPerDay) {
          const nextSource = source.plan.entries.filter((candidate) => candidate !== entry);
          const nextTarget = [...target.plan.entries, entry];
          const after = dayCost(nextSource) + dayCost(nextTarget);
          const diversityAfter = diversityOverflow(nextSource) + diversityOverflow(nextTarget);
          if (after + 1 < before && diversityAfter <= diversityBefore) {
            source.plan.entries = nextSource;
            target.plan.entries = nextTarget;
            repairApplied = true;
            continue;
          }
        }
        let bestSwap: { entry: DayPlanEntry; after: number } | null = null;
        for (const swap of target.plan.entries) {
          if (clusterHashes.has(hashEntry(swap)) || !legalOnDay(swap, source.plan.day, context)) continue;
          const nextSource = source.plan.entries.map((candidate) => candidate === entry ? swap : candidate);
          const nextTarget = target.plan.entries.map((candidate) => candidate === swap ? entry : candidate);
          const after = dayCost(nextSource) + dayCost(nextTarget);
          const diversityAfter = diversityOverflow(nextSource) + diversityOverflow(nextTarget);
          if (after + 1 < before && diversityAfter <= diversityBefore && (!bestSwap || after < bestSwap.after)) bestSwap = { entry: swap, after };
        }
        if (bestSwap) {
          source.plan.entries[sourceIndex] = bestSwap.entry;
          const swapIndex = target.plan.entries.indexOf(bestSwap.entry);
          target.plan.entries[swapIndex] = entry;
          repairApplied = true;
        }
      }
    }
  }

  for (const plan of plans) {
    const before = entriesBeforeRepair.get(plan.day) ?? [];
    if (!membershipChanged(before, plan.entries)) continue;
    const normalized = normalizeSameDayClockConflicts(
      plan.entries,
      dateForDay(context.plannedDate, plan.day),
      plan.day,
      (failure) => { if (failures.length < MAX_NORMALIZATION_FAILURES) failures.push(failure); },
    );
    plan.entries = normalized.entries;
    invoked.push({ day: plan.day, safe: normalized.safe });
  }
  publishNormalizationOutcome(context, invoked, failures);

  if (context.logDiagnostics !== false) {
    const finalItems = plans.flatMap((plan) => plan.entries.map((entry) => ({ entry, day: plan.day })));
    const finalClusters = clusterItemsByGeography(finalItems.filter((item) => coords(item.entry)), plans.length, ACCESSOR, { fitToDays: false }).clusters;
    for (const cluster of finalClusters) {
      const days = new Set(cluster.items.map((item) => item.day));
      for (const item of cluster.items) {
        const assigned = plans.find((plan) => plan.day === item.day)!;
        const assignedCenter = centroid(assigned.entries);
        const point = coords(item.entry)!;
        const alternatives = plans.filter((plan) => plan.day !== item.day).map((plan) => ({ day: plan.day, distance: nearestDistance(item.entry, plan.entries) })).sort((a, b) => a.distance - b.distance);
        console.info("[ITINERARY_DAY_ASSIGNMENT]", {
          generationId: context.generationId ?? "", stopHash: hashEntry(item.entry), sourceStage: context.stage,
          assignedDay: item.day, clusterId: cluster.clusterId, assignmentReason: days.size === 1 ? "cluster_colocated" : "best_legal_geographic_assignment",
          movable: !fixedReason(item.entry), distanceToAssignedDayCentroid: assignedCenter ? Math.round(distanceMeters(point, assignedCenter)) : null,
          nearestAssignedDayDistance: Number.isFinite(nearestDistance(item.entry, assigned.entries)) ? Math.round(nearestDistance(item.entry, assigned.entries)) : null,
          bestAlternativeDay: alternatives[0]?.day ?? null,
          bestAlternativeDistance: Number.isFinite(alternatives[0]?.distance) ? Math.round(alternatives[0]!.distance) : null,
        });
      }
      if (days.size > 1) {
        for (let i = 0; i < cluster.items.length; i += 1) for (let j = i + 1; j < cluster.items.length; j += 1) {
          const a = cluster.items[i]!, b = cluster.items[j]!;
          if (a.day === b.day) continue;
          const distance = distanceMeters(coords(a.entry)!, coords(b.entry)!);
          console.info("[ITINERARY_CROSS_DAY_CONFLICT]", {
            generationId: context.generationId ?? "", stopHashA: hashEntry(a.entry), stopHashB: hashEntry(b.entry),
            dayA: a.day, dayB: b.day, sameCluster: true, distanceMetersBucket: bucketDistance(distance),
            movableA: !fixedReason(a.entry), movableB: !fixedReason(b.entry),
            reasonNotCoLocated: fixedReason(a.entry) ?? fixedReason(b.entry) ?? "no_improving_legal_move_or_swap",
          });
        }
      }
    }
    for (const plan of plans) {
      const points = plan.entries.filter((entry) => coords(entry));
      const center = centroid(points);
      const spread = center ? Math.round(Math.max(0, ...points.map((entry) => distanceMeters(coords(entry)!, center)))) : 0;
      let maxPair = 0;
      for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) maxPair = Math.max(maxPair, distanceMeters(coords(points[i]!)!, coords(points[j]!)!));
      console.info("[ITINERARY_DAY_COHESION]", {
        generationId: context.generationId ?? "", dayIndex: plan.day, stopCount: plan.entries.length,
        centroidSpreadMeters: spread, maxPairDistanceMeters: Math.round(maxPair),
        crossDayNearestNeighborConflictCount: finalClusters.filter((cluster) => cluster.items.some((item) => item.day === plan.day) && new Set(cluster.items.map((item) => item.day)).size > 1).length,
        cohesionRepairApplied: repairApplied,
      });
    }
  }
  return plans;
}
