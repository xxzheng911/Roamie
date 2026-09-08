import type { ComposedDayPlan, DayPlanEntry } from "@/lib/ai/ai-day-plan-source";
import { minItemsPerDayForTrip } from "@/lib/ai/ai-day-plan-source";
import { maxEffectivePlacesPerDay, type PlannerPaceHint } from "@/lib/ai/planner-day-route-assembly";
import { clusterItemsByGeography, type GeoAccessor } from "@/lib/ai/geographic-clustering";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import { dailyDiversityFamilyCounts, resolveDailyDiversityLimits } from "@/lib/ai/daily-category-diversity";
import { distanceMeters } from "@/lib/geo-distance";

export type CrossDayCohesionStage =
  | "post_required_repair"
  | "post_diversity_move"
  | "post_coverage_move"
  | "post_redistribution"
  | "post_rebuild"
  | "final_pre_persistence";

export type CrossDayCohesionContext = {
  generationId?: string;
  stage: CrossDayCohesionStage;
  plannedDate?: string;
  pace?: PlannerPaceHint;
  logDiagnostics?: boolean;
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

function bucketDistance(value: number): string {
  if (value < 250) return "lt_250m";
  if (value < 750) return "250_749m";
  if (value < 2_000) return "750_1999m";
  if (value < 5_000) return "2_5km";
  return "gte_5km";
}

/** Final deterministic cross-day authority. It changes day membership only, never intraday order. */
export function repairCrossDayGeographicCohesion(
  input: readonly ComposedDayPlan[],
  context: CrossDayCohesionContext,
): ComposedDayPlan[] {
  const plans = input.map((plan) => ({ ...plan, entries: [...plan.entries] }));
  const located = plans.flatMap((plan) => plan.entries.map((entry) => ({ entry, day: plan.day }))).filter((item) => coords(item.entry));
  if (located.length < 2 || plans.length < 2) return plans;
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
