import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/map-explore";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { ComposedDayPlan, DayPlanEntry, DayPlanSlot } from "@/lib/ai/ai-day-plan-source";
import { classifyPlanPlaceKind, resolveEntryLabel } from "@/lib/ai/ai-day-plan-source";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";
import {
  canFillClassicLandmarkSlot,
  CLASSIC_LANDMARK_DAY_SLOTS,
  CLASSIC_LANDMARK_MAX_LEG_DISTANCE_M,
  CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY,
  filterPlacesForClassicLandmark,
  isClassicCafePlace,
  isClassicDinnerPlace,
  isClassicLandmarkScenicCandidate,
  isClassicLunchPlace,
  isClassicMealPoolPlace,
  scoreClassicLandmarkPriority,
  sortClassicLandmarkPlaces,
} from "@/lib/ai/ai-classic-landmark-rules";
import { isRecEnginePlannerEnabled } from "@/lib/recommendation/engine/feature-flag-planner";

export type ClassicLandmarkCluster = "CITY" | "LUYE" | "COAST" | "SOUTH" | "CHISHANG";

const CLUSTER_PATTERNS: Record<string, Record<ClassicLandmarkCluster, RegExp>> = {
  台東: {
    CITY: /鐵花村|森林公園|海濱|美術館|糖廠|市區|台東市|臺東市|阿伯|小白屋|生命之樹|卑南遺址/,
    LUYE: /鹿野|高台|初鹿|牧場/,
    COAST: /小野柳|加路蘭|三仙台|富岡|漁港|成功|都歷/,
    SOUTH: /多良|金剛|太麻里/,
    CHISHANG: /伯朗|池上/,
  },
  花蓮: {
    CITY: /將軍府|松園|東大門|市區|花蓮市|文化公園|文創|鐵道|市立/i,
    LUYE: /瑞穗|玉里|光復|富里/i,
    COAST: /四八高地|奇萊鼻|七星潭|海岸|太平洋|海濱|清水/i,
    SOUTH: /雲山水|鯉魚潭|立川|壽豐|吉安/i,
    CHISHANG: /池上|玉里/i,
  },
};

const DAY_CLUSTER_PRIORITY: Record<string, ClassicLandmarkCluster[][]> = {
  台東: [["CITY"], ["LUYE", "CHISHANG"], ["COAST", "SOUTH"]],
  花蓮: [["CITY"], ["COAST"], ["SOUTH"]],
};

const ALL_CLUSTERS: ClassicLandmarkCluster[] = [
  "CITY",
  "LUYE",
  "COAST",
  "SOUTH",
  "CHISHANG",
];

export function logGlobalDedupStart(): void {
  logAiPipeline("[AI_GLOBAL_DEDUP_START]");
}

export function logGlobalDedupDrop(name: string, reason: string): void {
  logAiPipeline("[AI_GLOBAL_DEDUP_DROP]", `name=${name}`, `reason=${reason}`);
}

export function logClusterAssign(day: number, cluster: string, name: string): void {
  logAiPipeline("[AI_CLUSTER_ASSIGN]", `day=${day}`, `cluster=${cluster}`, `name=${name}`);
}

export function logDayAssign(day: number, name: string, slot: string): void {
  logAiPipeline("[AI_DAY_ASSIGN]", `day=${day}`, `name=${name}`, `slot=${slot}`);
}

export function logDuplicateDetected(kind: string, detail: string): void {
  logAiPipeline("[AI_DUPLICATE_DETECTED]", `kind=${kind}`, `detail=${detail}`);
}

export function logRebuildDuplicateDay(day: number, reason: string): void {
  logAiPipeline("[AI_REBUILD_DUPLICATE_DAY]", `day=${day}`, `reason=${reason}`);
}

export function logAiClusterBuild(destination: string, summary: string): void {
  logAiPipeline("[AI_CLUSTER_BUILD]", `destination=${destination}`, summary);
}

export function logAiDayClusterAssign(day: number, clusters: string): void {
  logAiPipeline("[AI_DAY_CLUSTER_ASSIGN]", `day=${day}`, `clusters=${clusters}`);
}

export function logAiRouteSortStart(day: number, count: number): void {
  logAiPipeline("[AI_ROUTE_SORT_START]", `day=${day}`, `count=${count}`);
}

export function logAiRouteSortResult(day: number, names: string): void {
  logAiPipeline("[AI_ROUTE_SORT_RESULT]", `day=${day}`, `route=${names}`);
}

export function logAiMealInsert(day: number, slot: string, name: string): void {
  logAiPipeline("[AI_MEAL_INSERT]", `day=${day}`, `slot=${slot}`, `name=${name}`);
}

export function logAiDayValidate(day: number, ok: boolean, reason: string): void {
  logAiPipeline("[AI_DAY_VALIDATE]", `day=${day}`, `ok=${ok}`, reason ? `reason=${reason}` : "");
}

export function logAiDayRebuild(day: number, reason: string): void {
  logAiPipeline("[AI_DAY_REBUILD]", `day=${day}`, `reason=${reason}`);
}

export function normalizeClassicLandmarkPlaceName(name: string, destination?: string): string {
  const raw = name.trim();
  if (!raw) return "";

  let compact = raw.toLowerCase().replace(/\s+/g, "").replace(/[（(].*[)）]/g, "");

  const dest = destination ? normalizeDestinationLabel(destination) : "";
  if (dest) {
    compact = compact
      .replace(/台東縣|臺東縣|台東市|臺東市|花蓮縣|花蓮市/g, "")
      .replace(new RegExp(`^${dest}`, "i"), "")
      .replace(/^臺東|^台東|^花蓮/i, "");
  }

  compact = compact.replace(/觀光區|景點|遊憩區|園區|公園/g, "");
  return compact || normalizePlaceName(raw);
}

export function placeDedupeId(place: PlaceResult): string {
  const id = resolveTripPlaceId(place);
  if (id.startsWith("core:") || id.startsWith("name:")) return "";
  return id;
}

export function resolveClassicLandmarkCluster(
  place: PlaceResult,
  destination: string,
): ClassicLandmarkCluster | null {
  const label = normalizeDestinationLabel(destination);
  const patterns = CLUSTER_PATTERNS[label];
  if (!patterns) return null;
  const blob = [place.name, place.address].filter(Boolean).join(" ");
  for (const cluster of ALL_CLUSTERS) {
    if (patterns[cluster].test(blob)) return cluster;
  }
  return null;
}

function preferredClustersForDay(destination: string, dayIndex: number): ClassicLandmarkCluster[] {
  const label = normalizeDestinationLabel(destination);
  const table = DAY_CLUSTER_PRIORITY[label];
  if (!table?.length) return [];
  return table[dayIndex % table.length] ?? [];
}

function hasCoords(place: PlaceResult): boolean {
  return place.lat != null && place.lng != null;
}

function placeDistanceM(a: PlaceResult, b: PlaceResult): number {
  if (!hasCoords(a) || !hasCoords(b)) return Number.POSITIVE_INFINITY;
  return distanceMeters({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! });
}

function clusterCentroid(places: PlaceResult[]): { lat: number; lng: number } | null {
  const withCoords = places.filter(hasCoords);
  if (!withCoords.length) return null;
  const lat = withCoords.reduce((s, p) => s + p.lat!, 0) / withCoords.length;
  const lng = withCoords.reduce((s, p) => s + p.lng!, 0) / withCoords.length;
  return { lat, lng };
}

function assignPlaceToNearestCluster(
  place: PlaceResult,
  clusterPlaces: Map<ClassicLandmarkCluster, PlaceResult[]>,
  destination: string,
): ClassicLandmarkCluster | null {
  const named = resolveClassicLandmarkCluster(place, destination);
  if (named) return named;
  if (!hasCoords(place)) return null;

  let best: ClassicLandmarkCluster | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cluster of ALL_CLUSTERS) {
    const members = clusterPlaces.get(cluster) ?? [];
    const center = clusterCentroid(members);
    if (!center) continue;
    const d = distanceMeters(
      { lat: place.lat!, lng: place.lng! },
      { lat: center.lat, lng: center.lng },
    );
    if (d < bestDist) {
      bestDist = d;
      best = cluster;
    }
  }
  return best;
}

function buildClusterMap(
  attractions: PlaceResult[],
  destination: string,
): Map<ClassicLandmarkCluster, PlaceResult[]> {
  const map = new Map<ClassicLandmarkCluster, PlaceResult[]>();
  for (const cluster of ALL_CLUSTERS) {
    map.set(cluster, []);
  }

  for (const place of attractions) {
    const cluster = resolveClassicLandmarkCluster(place, destination);
    if (cluster) {
      map.get(cluster)!.push(place);
    }
  }

  for (const place of attractions) {
    if (resolveClassicLandmarkCluster(place, destination)) continue;
    const cluster = assignPlaceToNearestCluster(place, map, destination);
    if (cluster) map.get(cluster)!.push(place);
  }

  const summary = ALL_CLUSTERS.map((c) => `${c}=${map.get(c)?.length ?? 0}`).join(" ");
  logAiClusterBuild(destination, summary);
  return map;
}

/**
 * 路線組裝：最近鄰。
 * Flag ON（P2.3）：起點取 pool 順序第一個（不依 priority 重排）；後續僅 Route 約束。
 * Flag OFF：legacy 先依 scoreClassicLandmarkPriority 排序再最近鄰。
 */
function orderByNearestNeighbor(
  places: PlaceResult[],
  maxLegM = CLASSIC_LANDMARK_MAX_LEG_DISTANCE_M,
): PlaceResult[] {
  if (places.length <= 1) return [...places];

  const remaining = isRecEnginePlannerEnabled()
    ? [...places]
    : [...places].sort(
        (a, b) => scoreClassicLandmarkPriority(b) - scoreClassicLandmarkPriority(a),
      );
  const ordered: PlaceResult[] = [];
  let current = remaining.shift()!;
  ordered.push(current);

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = placeDistanceM(current, remaining[i]!);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestDist > maxLegM) break;
    current = remaining.splice(bestIdx, 1)[0]!;
    ordered.push(current);
  }

  return ordered;
}

function dayReferencePoint(places: PlaceResult[]): PlaceResult | null {
  if (!places.length) return null;
  const withCoords = places.filter(hasCoords);
  if (!withCoords.length) return places[0] ?? null;
  const center = clusterCentroid(withCoords);
  if (!center) return withCoords[0]!;
  return {
    ...withCoords[0]!,
    lat: center.lat,
    lng: center.lng,
  };
}

function pickNearestMeal(
  pool: PlaceResult[],
  ref: PlaceResult | null,
  filter: (p: PlaceResult) => boolean,
  used: Set<string>,
  maxDistM = 20_000,
): PlaceResult | undefined {
  const candidates = pool.filter((p) => {
    const id = p.id ?? p.name;
    if (!id || used.has(id)) return false;
    return filter(p);
  });

  if (!ref || !hasCoords(ref)) {
    const pick = candidates[0];
    if (pick) {
      const id = pick.id ?? pick.name;
      if (id) used.add(id);
    }
    return pick;
  }

  const ranked = candidates
    .map((p) => ({ p, d: hasCoords(p) ? placeDistanceM(ref, p) : Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.d - b.d);

  const within = ranked.find((x) => x.d <= maxDistM);
  const pick = (within ?? ranked[0])?.p;
  if (pick) {
    const id = pick.id ?? pick.name;
    if (id) used.add(id);
  }
  return pick;
}

export class ClassicLandmarkTripAllocator {
  readonly usedPlaceIds = new Set<string>();
  readonly usedPlaceNames = new Set<string>();
  readonly clustersByDay = new Map<number, Set<ClassicLandmarkCluster>>();

  isUsed(place: PlaceResult, destination: string): boolean {
    const id = resolveTripPlaceId(place);
    if (id && this.usedPlaceIds.has(id)) return true;
    const norm = normalizeClassicLandmarkPlaceName(place.name ?? "", destination);
    if (norm && this.usedPlaceNames.has(norm)) return true;
    return false;
  }

  markUsed(place: PlaceResult, destination: string, day: number): void {
    const id = resolveTripPlaceId(place);
    const norm = normalizeClassicLandmarkPlaceName(place.name ?? "", destination);
    if (id) this.usedPlaceIds.add(id);
    if (norm) this.usedPlaceNames.add(norm);
    const cluster = resolveClassicLandmarkCluster(place, destination);
    if (cluster) {
      const set = this.clustersByDay.get(day) ?? new Set<ClassicLandmarkCluster>();
      set.add(cluster);
      this.clustersByDay.set(day, set);
    }
  }

  remainingPool(allPlaces: PlaceResult[], destination: string): PlaceResult[] {
    return allPlaces.filter((p) => !this.isUsed(p, destination));
  }
}

export type ClassicLandmarkTripValidation = {
  ok: boolean;
  reasons: string[];
  duplicateDays: number[];
};

export type ClassicDayValidation = {
  ok: boolean;
  reasons: string[];
};

export function validateClassicLandmarkDay(
  plan: ComposedDayPlan,
  destination: string,
): ClassicDayValidation {
  const reasons: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const clusters = new Set<ClassicLandmarkCluster>();
  let scenicCount = 0;
  let lunchCount = 0;
  let dinnerCount = 0;
  const scenicEntries: DayPlanEntry[] = [];

  for (const entry of plan.entries) {
    const id = placeDedupeId(entry.place);
    const norm = normalizeClassicLandmarkPlaceName(entry.name, destination);
    if (id && seenIds.has(id)) reasons.push(`duplicate_id:${entry.name}`);
    if (norm && seenNames.has(norm)) reasons.push(`duplicate_name:${entry.name}`);
    if (id) seenIds.add(id);
    if (norm) seenNames.add(norm);

    if (/午餐/.test(entry.label)) {
      lunchCount += 1;
      continue;
    }
    if (/晚餐/.test(entry.label)) {
      dinnerCount += 1;
      continue;
    }
    if (/咖啡|甜點/.test(entry.label)) continue;

    if (isClassicLandmarkScenicCandidate(entry.place)) {
      scenicCount += 1;
      scenicEntries.push(entry);
      const cluster = resolveClassicLandmarkCluster(entry.place, destination);
      if (cluster) clusters.add(cluster);
    }
  }

  if (scenicCount < CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY) {
    reasons.push("too_few_attractions");
  }
  if (lunchCount < 1) reasons.push("missing_lunch");
  if (dinnerCount < 1) reasons.push("missing_dinner");
  if (clusters.size > 1) reasons.push("cross_region");

  for (let i = 1; i < scenicEntries.length; i += 1) {
    const prev = scenicEntries[i - 1]!.place;
    const next = scenicEntries[i]!.place;
    const d = placeDistanceM(prev, next);
    if (hasCoords(prev) && hasCoords(next) && d > CLASSIC_LANDMARK_MAX_LEG_DISTANCE_M) {
      reasons.push(`leg_too_long:${scenicEntries[i - 1]!.name}->${scenicEntries[i]!.name}`);
    }
  }

  logAiDayValidate(plan.day, reasons.length === 0, reasons.join(",") || "ok");
  return { ok: reasons.length === 0, reasons };
}

export function validateClassicLandmarkTrip(
  plans: ComposedDayPlan[],
  destination: string,
): ClassicLandmarkTripValidation {
  const reasons: string[] = [];
  const duplicateDays = new Set<number>();
  const seenIds = new Map<string, number>();
  const seenNames = new Map<string, number>();

  for (const plan of plans) {
    const dayValidation = validateClassicLandmarkDay(plan, destination);
    if (!dayValidation.ok) {
      reasons.push(...dayValidation.reasons.map((r) => `day${plan.day}:${r}`));
      duplicateDays.add(plan.day);
    }

    for (const entry of plan.entries) {
      const id = placeDedupeId(entry.place);
      const norm = normalizeClassicLandmarkPlaceName(entry.name, destination);
      if (id) {
        if (seenIds.has(id)) {
          const prev = seenIds.get(id)!;
          reasons.push(`duplicate_place_id:${id}`);
          logDuplicateDetected("place_id", `${entry.name} day${prev}+day${plan.day}`);
          duplicateDays.add(plan.day);
          duplicateDays.add(prev);
        } else {
          seenIds.set(id, plan.day);
        }
      }
      if (norm) {
        if (seenNames.has(norm)) {
          const prev = seenNames.get(norm)!;
          reasons.push(`duplicate_normalized_name:${norm}`);
          logDuplicateDetected("normalized_name", `${entry.name} day${prev}+day${plan.day}`);
          duplicateDays.add(plan.day);
          duplicateDays.add(prev);
        } else {
          seenNames.set(norm, plan.day);
        }
      }
    }
  }

  return { ok: reasons.length === 0, reasons, duplicateDays: [...duplicateDays] };
}

type ClassicPlacePools = {
  attractions: PlaceResult[];
  lunches: PlaceResult[];
  cafes: PlaceResult[];
  dinners: PlaceResult[];
};

function splitClassicPlacePools(places: PlaceResult[]): ClassicPlacePools {
  const attractions: PlaceResult[] = [];
  const lunches: PlaceResult[] = [];
  const cafes: PlaceResult[] = [];
  const dinners: PlaceResult[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    const id = place.id ?? place.name;
    if (!id || seen.has(id)) continue;

    if (isClassicLandmarkScenicCandidate(place)) {
      seen.add(id);
      attractions.push(place);
      continue;
    }
    if (!isClassicMealPoolPlace(place)) continue;

    if (isClassicLunchPlace(place)) {
      seen.add(id);
      lunches.push(place);
    }
    if (isClassicDinnerPlace(place)) {
      if (!seen.has(id)) {
        seen.add(id);
        dinners.push(place);
      } else {
        dinners.push(place);
      }
    }
    if (isClassicCafePlace(place)) {
      if (!seen.has(id)) {
        seen.add(id);
        cafes.push(place);
      } else if (!cafes.some((c) => (c.id ?? c.name) === id)) {
        cafes.push(place);
      }
    }
  }

  return { attractions, lunches, cafes, dinners };
}

function collectDayAttractions(
  clusterMap: Map<ClassicLandmarkCluster, PlaceResult[]>,
  preferClusters: ClassicLandmarkCluster[],
  allocator: ClassicLandmarkTripAllocator,
  destination: string,
  minCount: number,
): PlaceResult[] {
  const collected: PlaceResult[] = [];

  for (const cluster of preferClusters) {
    const members = clusterMap.get(cluster) ?? [];
    for (const place of sortClassicLandmarkPlaces(members)) {
      if (allocator.isUsed(place, destination)) continue;
      collected.push(place);
      if (collected.length >= minCount + 2) break;
    }
    if (collected.length >= minCount + 2) break;
  }

  if (collected.length < minCount) {
    for (const cluster of ALL_CLUSTERS) {
      if (preferClusters.includes(cluster)) continue;
      for (const place of sortClassicLandmarkPlaces(clusterMap.get(cluster) ?? [])) {
        if (allocator.isUsed(place, destination)) continue;
        collected.push(place);
        if (collected.length >= minCount + 2) break;
      }
      if (collected.length >= minCount + 2) break;
    }
  }

  return collected;
}

function buildSingleClassicDay(params: {
  day: number;
  dayIndex: number;
  destination: string;
  clusterMap: Map<ClassicLandmarkCluster, PlaceResult[]>;
  pools: ClassicPlacePools;
  allocator: ClassicLandmarkTripAllocator;
  preferClusters: ClassicLandmarkCluster[];
}): ComposedDayPlan {
  const { day, dayIndex, destination, clusterMap, pools, allocator, preferClusters } = params;
  logAiDayClusterAssign(day, preferClusters.join("+") || "any");

  const rawAttractions = collectDayAttractions(
    clusterMap,
    preferClusters,
    allocator,
    destination,
    CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY,
  );

  logAiRouteSortStart(day, rawAttractions.length);
  const routed = orderByNearestNeighbor(rawAttractions);
  logAiRouteSortResult(day, routed.map((p) => p.name).join("->"));

  const morning = routed[0];
  const afternoon = routed[1];
  const mealUsed = new Set<string>();
  const entries: DayPlanEntry[] = [];

  for (const slot of CLASSIC_LANDMARK_DAY_SLOTS) {
    let place: PlaceResult | undefined;

    if (slot.time === "09:00" && morning) {
      place = morning;
    } else if (slot.time === "12:00") {
      place = pickNearestMeal(
        [...pools.lunches, ...pools.dinners],
        morning ?? dayReferencePoint(routed),
        isClassicLunchPlace,
        mealUsed,
      );
    } else if (slot.time === "14:00" && afternoon) {
      place = afternoon;
    } else if (slot.time === "16:00") {
      place = pickNearestMeal(
        pools.cafes,
        afternoon ?? morning ?? dayReferencePoint(routed),
        isClassicCafePlace,
        mealUsed,
      );
    } else if (slot.time === "18:00") {
      place = pickNearestMeal(
        pools.dinners.length ? pools.dinners : pools.lunches,
        afternoon ?? morning ?? dayReferencePoint(routed),
        isClassicDinnerPlace,
        mealUsed,
      );
    }

    if (!place?.name) continue;
    if (slot.kind === "attraction" && !isClassicLandmarkScenicCandidate(place)) continue;
    if (!canFillClassicLandmarkSlot(place, slot, classifyPlanPlaceKind)) continue;

    allocator.markUsed(place, destination, day);
    const cluster = resolveClassicLandmarkCluster(place, destination);
    if (cluster) logClusterAssign(day, cluster, place.name);
    logDayAssign(day, place.name, slot.time);
    if (slot.kind === "restaurant" || slot.kind === "cafe") {
      logAiMealInsert(day, slot.time, place.name);
    }

    entries.push({
      time: slot.time,
      label: resolveEntryLabel(slot, place),
      name: place.name,
      place,
    });
  }

  return { day, entries };
}

const MAX_CLASSIC_DEDUPE_REBUILD_ATTEMPTS = 1;

export function buildClassicLandmarkDayPlans(params: {
  places: PlaceResult[];
  days: number;
  destination: string;
  dedupeRebuildAttempt?: number;
}): ComposedDayPlan[] {
  const { places, days, destination } = params;
  const safeDays = Math.max(1, days);
  logGlobalDedupStart();

  const scenicPool = sortClassicLandmarkPlaces(filterPlacesForClassicLandmark(places));
  const pools = splitClassicPlacePools(places);
  pools.attractions = scenicPool;

  const clusterMap = buildClusterMap(pools.attractions, destination);
  const allocator = new ClassicLandmarkTripAllocator();
  let plans: ComposedDayPlan[] = [];

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const preferClusters = preferredClustersForDay(destination, dayIndex);
    const plan = buildSingleClassicDay({
      day: dayIndex + 1,
      dayIndex,
      destination,
      clusterMap,
      pools,
      allocator,
      preferClusters,
    });
    plans.push(plan);
  }

  plans = plans.map((plan) => {
    const validation = validateClassicLandmarkDay(plan, destination);
    if (validation.ok) return plan;
    if (plan.entries.length >= 1) {
      logAiPipeline(
        "[AI_DAY_VALIDATE_RELAXED]",
        `day=${plan.day}`,
        validation.reasons.join(",") || "partial_ok",
      );
      return plan;
    }

    logAiDayRebuild(plan.day, validation.reasons.join(","));
    const preferClusters = preferredClustersForDay(destination, plan.day - 1);
    const rebuildAllocator = new ClassicLandmarkTripAllocator();
    for (const other of plans) {
      if (other.day === plan.day) continue;
      for (const entry of other.entries) {
        rebuildAllocator.markUsed(entry.place, destination, other.day);
      }
    }
    const rebuilt = buildSingleClassicDay({
      day: plan.day,
      dayIndex: plan.day - 1,
      destination,
      clusterMap,
      pools,
      allocator: rebuildAllocator,
      preferClusters,
    });
    return rebuilt.entries.length >= plan.entries.length ? rebuilt : plan;
  });

  const tripValidation = validateClassicLandmarkTrip(plans, destination);
  if (!tripValidation.ok && tripValidation.duplicateDays.length > 0) {
    const attempt = params.dedupeRebuildAttempt ?? 0;
    if (attempt >= MAX_CLASSIC_DEDUPE_REBUILD_ATTEMPTS) {
      logAiPipeline(
        "[AI_DAY_REBUILD_ABORT]",
        "reason=max_dedupe_rebuild",
        `attempt=${attempt}`,
        `days=${tripValidation.duplicateDays.join(",")}`,
      );
      return plans;
    }
    for (const day of tripValidation.duplicateDays) {
      logRebuildDuplicateDay(day, tripValidation.reasons.join(","));
    }
    return rebuildClassicLandmarkDaysWithoutDuplicates({
      plans,
      pool: scenicPool,
      mealPool: places.filter(isClassicMealPoolPlace),
      destination,
      days: safeDays,
      dedupeRebuildAttempt: attempt + 1,
    });
  }

  return plans;
}

function rebuildClassicLandmarkDaysWithoutDuplicates(params: {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  mealPool: PlaceResult[];
  destination: string;
  days: number;
  dedupeRebuildAttempt: number;
}): ComposedDayPlan[] {
  const allPlaces = [...params.pool, ...params.mealPool];
  return buildClassicLandmarkDayPlans({
    places: allPlaces,
    days: params.days,
    destination: params.destination,
    dedupeRebuildAttempt: params.dedupeRebuildAttempt,
  });
}
