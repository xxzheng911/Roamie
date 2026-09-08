import type { ComposedDayPlan, DayPlanEntry } from "@/lib/ai/ai-day-plan-source";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import { distanceMeters } from "@/lib/geo-distance";

export type ItineraryRouteOrderStage =
  | "initial"
  | "post_required_repair"
  | "post_supplemental_fill"
  | "post_replan"
  | "post_redistribution"
  | "post_rebuild"
  | "final_pre_persistence";

export type FinalRouteOrderingOptions = {
  generationId?: string;
  stage: ItineraryRouteOrderStage;
  plannedDate?: string;
  isFixedAnchor?: (entry: DayPlanEntry) => boolean;
  logDiagnostics?: boolean;
};

const FIXED_SLOT_RE =
  /早餐|午餐|晚餐|宵夜|reservation|reserved|預約|预约|預訂|预订|予約|固定時間|指定時間|hard[_\s-]?time/i;
const FIXED_TIME_PLACE_RE =
  /night_market|night_club|bar|pub|晚間|夜間|夜市|夜景|酒吧|居酒/i;

function hasCoordinates(entry: DayPlanEntry): boolean {
  return (
    Number.isFinite(entry.place.lat) &&
    Number.isFinite(entry.place.lng) &&
    !(Math.abs(entry.place.lat ?? 0) < 0.0001 && Math.abs(entry.place.lng ?? 0) < 0.0001)
  );
}

function entryDistance(a: DayPlanEntry, b: DayPlanEntry): number {
  if (!hasCoordinates(a) || !hasCoordinates(b)) return Number.POSITIVE_INFINITY;
  return distanceMeters(
    { lat: a.place.lat!, lng: a.place.lng! },
    { lat: b.place.lat!, lng: b.place.lng! },
  );
}

function routeDistance(entries: readonly DayPlanEntry[]): number {
  let total = 0;
  for (let index = 1; index < entries.length; index += 1) {
    const distance = entryDistance(entries[index - 1]!, entries[index]!);
    if (Number.isFinite(distance)) total += distance;
  }
  return Math.round(total);
}

function backtrackCount(entries: readonly DayPlanEntry[]): number {
  let count = 0;
  for (let index = 0; index < entries.length - 2; index += 1) {
    const ab = entryDistance(entries[index]!, entries[index + 1]!);
    const ac = entryDistance(entries[index]!, entries[index + 2]!);
    const bc = entryDistance(entries[index + 1]!, entries[index + 2]!);
    if (
      Number.isFinite(ab) &&
      Number.isFinite(ac) &&
      Number.isFinite(bc) &&
      ab > Math.max(ac, bc) * 1.5
    ) {
      count += 1;
    }
  }
  return count;
}

function parseMinutes(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 12 * 60;
}

function greedyOrder(entries: DayPlanEntry[], startIndex: number): DayPlanEntry[] {
  const remaining = [...entries];
  const ordered = [remaining.splice(startIndex, 1)[0]!];
  while (remaining.length) {
    const current = ordered[ordered.length - 1]!;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const distance = entryDistance(current, remaining[index]!);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    ordered.push(remaining.splice(nearestIndex, 1)[0]!);
  }
  return ordered;
}

function sameEntryOrder(left: readonly DayPlanEntry[], right: readonly DayPlanEntry[]): boolean {
  return left.every((entry, index) => entry === right[index]);
}

function optimizeFreeSegment(params: {
  segment: DayPlanEntry[];
  before?: DayPlanEntry;
  after?: DayPlanEntry;
  plannedDate?: string;
}): DayPlanEntry[] {
  const { segment, before, after, plannedDate } = params;
  if (segment.length <= 1 || segment.some((entry) => !hasCoordinates(entry))) return segment;
  const freeTimes = segment.map((entry) => entry.time).sort((a, b) => parseMinutes(a) - parseMinutes(b));
  const starts = before
    ? [
        segment.reduce((best, entry, index) =>
          entryDistance(before, entry) < entryDistance(before, segment[best]!) ? index : best, 0),
      ]
    : [0, segment.length - 1];
  const candidates = [segment, ...starts.map((start) => greedyOrder(segment, start))];
  let best = segment;
  let bestDistance = routeDistance([...(before ? [before] : []), ...segment, ...(after ? [after] : [])]);
  for (const candidate of candidates) {
    const timed = candidate.map((entry, index) => ({ ...entry, time: freeTimes[index] ?? entry.time }));
    if (
      timed.some(
        (entry) => isClearlyClosedAtSlot(entry.place, plannedDate, entry.time) === true,
      )
    ) {
      continue;
    }
    const distance = routeDistance([...(before ? [before] : []), ...timed, ...(after ? [after] : [])]);
    if (distance < bestDistance) {
      best = timed;
      bestDistance = distance;
    }
  }
  return best;
}

function fixedAnchor(entry: DayPlanEntry, options: FinalRouteOrderingOptions): boolean {
  return (
    options.isFixedAnchor?.(entry) ??
    (
      FIXED_SLOT_RE.test(entry.label) ||
      FIXED_TIME_PLACE_RE.test(
        [entry.label, entry.place.primaryType, ...(entry.place.types ?? [])].join(" "),
      )
    )
  );
}

/** Final deterministic authority for order only; never changes identity or day assignment. */
export function applyFinalDayRouteOrdering(
  plans: readonly ComposedDayPlan[],
  options: FinalRouteOrderingOptions,
): ComposedDayPlan[] {
  return plans.map((plan) => {
    const input = [...plan.entries];
    const fixedIndexes = new Set<number>();
    input.forEach((entry, index) => {
      if (fixedAnchor(entry, options)) fixedIndexes.add(index);
    });
    const output = [...input];
    let cursor = 0;
    while (cursor < input.length) {
      if (fixedIndexes.has(cursor)) {
        cursor += 1;
        continue;
      }
      let end = cursor;
      while (end < input.length && !fixedIndexes.has(end)) end += 1;
      const optimized = optimizeFreeSegment({
        segment: input.slice(cursor, end),
        before: cursor > 0 ? output[cursor - 1] : undefined,
        after: end < input.length ? input[end] : undefined,
        plannedDate: options.plannedDate,
      });
      optimized.forEach((entry, offset) => {
        output[cursor + offset] = entry;
      });
      cursor = end;
    }

    const reordered = !sameEntryOrder(input, output);
    const logDiagnostics = options.logDiagnostics !== false;
    if (logDiagnostics) {
      console.info("[ITINERARY_ROUTE_ORDERING]", {
        generationId: options.generationId ?? "",
        dayIndex: plan.day,
        inputStopCount: input.length,
        reordered,
        orderingStrategy: "fixed_anchor_segmented_bidirectional_greedy",
        fixedAnchorCount: fixedIndexes.size,
        freeStopCount: input.length - fixedIndexes.size,
        totalStraightLineDistanceBefore: routeDistance(input),
        totalStraightLineDistanceAfter: routeDistance(output),
        backtrackCountBefore: backtrackCount(input),
        backtrackCountAfter: backtrackCount(output),
      });
      console.info("[ITINERARY_ROUTE_ORDER_STAGE]", {
        generationId: options.generationId ?? "",
        stage: options.stage,
        dayIndex: plan.day,
        stopCount: output.length,
        routeOrderingApplied: input.length > 1,
      });
    }
    return { ...plan, entries: output };
  });
}
