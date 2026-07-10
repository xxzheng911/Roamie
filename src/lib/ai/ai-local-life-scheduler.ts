import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/map-explore";
import type { ComposedDayPlan, DayPlanEntry, DayPlanSlot } from "@/lib/ai/ai-day-plan-source";
import { classifyPlanPlaceKind, resolveEntryLabel } from "@/lib/ai/ai-day-plan-source";
import {
  isBarBistroPlace,
  isCafePlace,
  isCultureCreativeAreaPlace,
  isExplicitCafePlace,
  isNightMarketPlace,
  isProperRestaurantPlace,
  dedupeEntryTimes,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  buildLocalLifeCityFallbackPlaces,
  buildLocalLifeCandidatePools,
  filterPlacesForLocalLife,
  isLocalLifeDistrictCandidate,
  LOCAL_LIFE_DAY_SLOTS,
  LOCAL_LIFE_MIN_ITEMS_PER_DAY,
  logAiAreaKeyAssigned,
  logAiDayRebuildForDuplicate,
  logAiDuplicateAreaDrop,
  logAiTripDedupPass,
  logAiTripDedupStart,
  normalizeAreaKey,
  normalizeLocalLifePlaceName,
  preferredAreaKeysForDay,
  type LocalLifeCandidatePools,
} from "@/lib/ai/ai-local-life-rules";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  filterPoolForScheduling,
  resolveTripPlaceId,
  seedTripAllocatorFromPlans,
  TripPlaceAllocator,
  validateTripPlaceUniqueness,
  type TripPlaceUniquenessValidation,
} from "@/lib/ai/ai-trip-place-allocator";

const MEAL_SLOT_RE = /早餐|午餐|晚餐/;

function poolForSlot(pools: LocalLifeCandidatePools, slot: DayPlanSlot): PlaceResult[] {
  if (/早餐/.test(slot.label)) return pools.lunchPool.length ? pools.lunchPool : pools.breakfastPool;
  if (/午餐/.test(slot.label)) return pools.lunchPool.length ? pools.lunchPool : pools.breakfastPool;
  if (/咖啡/.test(slot.label)) return pools.cafePool;
  if (/晚餐/.test(slot.label)) return pools.dinnerPool.length ? pools.dinnerPool : pools.lunchPool;
  if (/酒吧/.test(slot.label)) {
    return pools.eveningPool.length ? pools.eveningPool : pools.attractionPool;
  }
  return pools.attractionPool.length ? pools.attractionPool : pools.all;
}

function isLocalLifeMealSlot(slot: DayPlanSlot): boolean {
  return /早餐|午餐|晚餐/.test(slot.label);
}

function isLocalLifeCoffeeSlot(slot: DayPlanSlot): boolean {
  return /咖啡/.test(slot.label);
}

function matchesLocalLifeSlot(slot: DayPlanSlot, place: PlaceResult): boolean {
  const kind = classifyPlanPlaceKind(place);

  if (/早餐/.test(slot.label)) {
    return isProperRestaurantPlace(place) && !isBarBistroPlace(place) && !isNightMarketPlace(place);
  }
  if (/午餐/.test(slot.label)) {
    return isProperRestaurantPlace(place) && !isBarBistroPlace(place);
  }
  if (/咖啡/.test(slot.label)) {
    return (isExplicitCafePlace(place) || isCafePlace(place)) && !isCultureCreativeAreaPlace(place);
  }
  if (/晚餐/.test(slot.label)) {
    return (
      (isProperRestaurantPlace(place) || isNightMarketPlace(place)) &&
      !isBarBistroPlace(place)
    );
  }
  if (/酒吧/.test(slot.label)) {
    return isBarBistroPlace(place);
  }
  if (slot.label === "景點") {
    return (
      isLocalLifeDistrictCandidate(place) ||
      kind === "attraction" ||
      kind === "shopping" ||
      kind === "market" ||
      kind === "culture" ||
      kind === "nature"
    );
  }
  return false;
}

function relaxedLocalLifeSlotMatch(slot: DayPlanSlot, place: PlaceResult): boolean {
  if (matchesLocalLifeSlot(slot, place)) return true;
  if (/早餐|午餐|晚餐/.test(slot.label)) {
    return isProperRestaurantPlace(place) || isCafePlace(place) || isNightMarketPlace(place);
  }
  if (/咖啡/.test(slot.label)) return isCafePlace(place);
  if (/酒吧/.test(slot.label)) {
    return isBarBistroPlace(place) || isNightMarketPlace(place) || isLocalLifeDistrictCandidate(place);
  }
  if (slot.label === "景點") {
    const kind = classifyPlanPlaceKind(place);
    return kind !== "restaurant" && !isBarBistroPlace(place);
  }
  return false;
}

function hasCoords(place: PlaceResult): boolean {
  return place.lat != null && place.lng != null;
}

function placeDistanceM(a: PlaceResult, b: PlaceResult): number {
  if (!hasCoords(a) || !hasCoords(b)) return Number.POSITIVE_INFINITY;
  return distanceMeters({ lat: a.lat!, lng: a.lng! }, { lat: b.lat!, lng: b.lng! });
}

export class LocalLifeTripAllocator extends TripPlaceAllocator {
  readonly usedMealIds = new Set<string>();
  readonly usedMealNames = new Set<string>();
  readonly areaDayMap = new Map<string, number>();

  isMealUsed(place: PlaceResult, destination: string): boolean {
    const id = resolveTripPlaceId(place);
    const norm = normalizeLocalLifePlaceName(place.name ?? "", destination);
    if (id && this.usedMealIds.has(id)) return true;
    if (norm && this.usedMealNames.has(norm)) return true;
    return this.isUsed(place);
  }

  isPlaceUsed(place: PlaceResult, destination: string): boolean {
    const id = resolveTripPlaceId(place);
    const norm = normalizeLocalLifePlaceName(place.name ?? "", destination);
    if (id && this.usedPlaceIds.has(id)) return true;
    if (norm && this.usedPlaceNames.has(norm)) return true;
    return false;
  }

  isAreaUsedOnOtherDay(areaKey: string | null, day: number): boolean {
    if (!areaKey) return false;
    const prevDay = this.areaDayMap.get(areaKey);
    return prevDay != null && prevDay !== day;
  }

  markDistrictUsed(place: PlaceResult, destination: string, day: number): void {
    this.markUsed(place, day);
    const area = normalizeAreaKey(place, destination);
    if (area && !this.areaDayMap.has(area)) {
      this.areaDayMap.set(area, day);
      logAiAreaKeyAssigned(day, area, place.name ?? "");
    }
  }

  markMealUsed(place: PlaceResult, destination: string, day: number): void {
    const id = resolveTripPlaceId(place);
    const norm = normalizeLocalLifePlaceName(place.name ?? "", destination);
    if (id) this.usedMealIds.add(id);
    if (norm) this.usedMealNames.add(norm);
    this.markUsed(place, day);
  }
}

export type TripNoDuplicateValidation = TripPlaceUniquenessValidation;

export function validateTripNoDuplicate(
  plans: ComposedDayPlan[],
  destination: string,
  requestedDays?: number,
): TripNoDuplicateValidation {
  const days = requestedDays ?? plans.length;
  const base = validateTripPlaceUniqueness(plans, days);
  const reasons = [...base.reasons];
  const failedDays = new Set(base.failedDays);
  const seenAreas = new Map<string, number>();

  for (const plan of plans) {
    for (const entry of plan.entries) {
      const area = normalizeAreaKey(entry.place, destination);
      if (!area) continue;
      if (seenAreas.has(area)) {
        reasons.push(`duplicate_area:${area}`);
        failedDays.add(plan.day);
        failedDays.add(seenAreas.get(area)!);
      } else {
        seenAreas.set(area, plan.day);
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    failedDays: [...failedDays],
    duplicatePlaceIds: base.duplicatePlaceIds,
  };
}

function scoreLocalLifePlace(place: PlaceResult): number {
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  return rating * 10 + Math.min(Math.log10(reviews + 1) * 15, 50);
}

function pickBestPlace(
  pool: PlaceResult[],
  filter: (p: PlaceResult) => boolean,
  allocator: LocalLifeTripAllocator,
  destination: string,
  day: number,
  preferAreas: string[],
  opts?: { meal?: boolean; near?: PlaceResult | null; district?: boolean },
): PlaceResult | undefined {
  const candidates = pool
    .filter((p) => {
      if (!p.name?.trim()) return false;
      if (!filter(p)) return false;
      const id = resolveTripPlaceId(p);
      if (!id) return false;
      if (allocator.usedPlaceIds.has(id)) {
        allocator.rejectIfUsed(p, day, "already_used");
        return false;
      }
      if (opts?.meal) {
        if (allocator.isMealUsed(p, destination)) {
          allocator.rejectIfUsed(p, day, "meal_used");
          return false;
        }
      } else if (allocator.isPlaceUsed(p, destination)) {
        allocator.rejectIfUsed(p, day, "place_used");
        return false;
      }
      if (opts?.district) {
        const area = normalizeAreaKey(p, destination);
        if (area && allocator.isAreaUsedOnOtherDay(area, day)) {
          logAiDuplicateAreaDrop(area, day);
          return false;
        }
      }
      return true;
    })
    .map((p) => {
      let score = scoreLocalLifePlace(p);
      const area = normalizeAreaKey(p, destination);
      if (area && preferAreas.includes(area)) score += 80;
      if (opts?.near && hasCoords(p) && hasCoords(opts.near)) {
        const d = placeDistanceM(p, opts.near);
        if (d < 5000) score += 40;
        else if (d < 12_000) score += 20;
      }
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.p;
}

function appendCityBackupPlaces(params: {
  pool: PlaceResult[];
  destination: string;
  lat: number;
  lng: number;
  allocator: LocalLifeTripAllocator;
  minCount: number;
}): PlaceResult[] {
  const existingNames = new Set(params.pool.map((p) => (p.name ?? "").trim()).filter(Boolean));
  for (const id of params.allocator.usedPlaceIds) {
    existingNames.add(id);
  }
  const backup = buildLocalLifeCityFallbackPlaces({
    destination: params.destination,
    lat: params.lat,
    lng: params.lng,
    minCount: params.minCount,
    existingNames,
  });
  const fresh = backup.filter((p) => {
    const id = resolveTripPlaceId(p);
    return id && !params.allocator.usedPlaceIds.has(id);
  });
  if (fresh.length) {
    logAiPipeline("[AI_LOCAL_LIFE_CITY_BACKUP]", `count=${fresh.length}`);
  }
  return [...params.pool, ...fresh];
}

function fillLocalLifeDayGaps(params: {
  day: number;
  dayIndex: number;
  destination: string;
  entries: DayPlanEntry[];
  pools: LocalLifeCandidatePools;
  pool: PlaceResult[];
  allocator: LocalLifeTripAllocator;
  lat?: number;
  lng?: number;
}): DayPlanEntry[] {
  const { day, dayIndex, destination, allocator, pools } = params;
  let pool = allocator.filterPool(params.pool);
  let result = dedupeEntryTimes([...params.entries]);
  const preferAreas = preferredAreaKeysForDay(destination, dayIndex);
  const usedTimes = () => new Set(result.map((e) => e.time));

  for (const slot of LOCAL_LIFE_DAY_SLOTS) {
    if (usedTimes().has(slot.time)) continue;

    const slotPool = poolForSlot(pools, slot);
    let picked =
      pickBestPlace(slotPool, (p) => matchesLocalLifeSlot(slot, p), allocator, destination, day, preferAreas, {
        meal: isLocalLifeMealSlot(slot),
        district: slot.label === "景點" || isLocalLifeCoffeeSlot(slot),
      }) ??
      pickBestPlace(pool, (p) => relaxedLocalLifeSlotMatch(slot, p), allocator, destination, day, preferAreas, {
        meal: isLocalLifeMealSlot(slot),
        district: slot.label === "景點" || isLocalLifeCoffeeSlot(slot),
      });

    if (!picked && params.lat != null && params.lng != null) {
      pool = appendCityBackupPlaces({
        pool,
        destination,
        lat: params.lat,
        lng: params.lng,
        allocator,
        minCount: LOCAL_LIFE_MIN_ITEMS_PER_DAY - result.length + 2,
      });
      pool = allocator.filterPool(pool);
      picked =
        pickBestPlace(pool, (p) => relaxedLocalLifeSlotMatch(slot, p), allocator, destination, day, preferAreas, {
          meal: isLocalLifeMealSlot(slot),
          district: slot.label === "景點" || isLocalLifeCoffeeSlot(slot),
        }) ?? undefined;
    }

    if (!picked?.name) continue;

    if (MEAL_SLOT_RE.test(slot.label)) {
      allocator.markMealUsed(picked, destination, day);
    } else {
      allocator.markDistrictUsed(picked, destination, day);
    }

    result.push({
      time: slot.time,
      label: resolveEntryLabel(slot, picked),
      name: picked.name,
      place: picked,
    });
    result = dedupeEntryTimes(result);
  }

  return result;
}

function buildSingleLocalLifeDay(params: {
  day: number;
  dayIndex: number;
  destination: string;
  pool: PlaceResult[];
  pools: LocalLifeCandidatePools;
  allocator: LocalLifeTripAllocator;
  lat?: number;
  lng?: number;
}): ComposedDayPlan {
  const { day, dayIndex, destination, allocator, pools } = params;
  const preferAreas = preferredAreaKeysForDay(destination, dayIndex);
  const pool = allocator.filterPool(params.pool);
  const entries: DayPlanEntry[] = [];

  for (const slot of LOCAL_LIFE_DAY_SLOTS) {
    const slotPool = poolForSlot(pools, slot);
    const isMeal = isLocalLifeMealSlot(slot);
    const isDistrict = slot.label === "景點" || isLocalLifeCoffeeSlot(slot);

    let place =
      pickBestPlace(slotPool, (p) => matchesLocalLifeSlot(slot, p), allocator, destination, day, preferAreas, {
        meal: isMeal,
        district: isDistrict,
      }) ??
      pickBestPlace(pool, (p) => relaxedLocalLifeSlotMatch(slot, p), allocator, destination, day, preferAreas, {
        meal: isMeal,
        district: isDistrict,
      });

    if (!place?.name) continue;

    if (isMeal) allocator.markMealUsed(place, destination, day);
    else allocator.markDistrictUsed(place, destination, day);

    entries.push({
      time: slot.time,
      label: resolveEntryLabel(slot, place),
      name: place.name,
      place,
    });
  }

  const filled = fillLocalLifeDayGaps({
    day,
    dayIndex,
    destination,
    entries,
    pools,
    pool,
    allocator,
    lat: params.lat,
    lng: params.lng,
  });

  return { day, entries: dedupeEntryTimes(filled) };
}

export function buildLocalLifeDayPlans(params: {
  places: PlaceResult[];
  days: number;
  destination: string;
  lat?: number;
  lng?: number;
  seedPlans?: ComposedDayPlan[];
  excludeSeedDays?: number[];
}): ComposedDayPlan[] {
  const { places, days, destination, lat, lng, seedPlans, excludeSeedDays } = params;
  const safeDays = Math.max(1, days);
  logAiTripDedupStart();

  const rawPool = filterPlacesForLocalLife(places);
  const candidatePools = buildLocalLifeCandidatePools(places);
  const buildAll = (): ComposedDayPlan[] => {
    const allocator = new LocalLifeTripAllocator();
    if (seedPlans?.length) {
      seedTripAllocatorFromPlans(allocator, seedPlans, excludeSeedDays ?? []);
    }
    const filteredPool = filterPoolForScheduling(rawPool, allocator.usedPlaceIds);
    const out: ComposedDayPlan[] = [];
    for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
      out.push(
        buildSingleLocalLifeDay({
          day: dayIndex + 1,
          dayIndex,
          destination,
          pool: filteredPool,
          pools: candidatePools,
          allocator,
          lat,
          lng,
        }),
      );
    }
    return out;
  };

  let plans = buildAll();
  let validation = validateTripNoDuplicate(plans, destination, safeDays);

  if (!validation.ok) {
    for (const day of validation.failedDays) {
      logAiDayRebuildForDuplicate(day, validation.reasons.join(","));
    }
    plans = buildAll();
    validation = validateTripNoDuplicate(plans, destination, safeDays);
  }

  if (validation.ok) {
    logAiTripDedupPass();
  } else {
    logAiPipeline("[AI_TRIP_DEDUP_FAIL]", `reasons=${validation.reasons.join(";")}`);
  }

  for (const plan of plans) {
    if (plan.entries.length < LOCAL_LIFE_MIN_ITEMS_PER_DAY) {
      logAiDayRebuildForDuplicate(plan.day, `sparse count=${plan.entries.length}`);
    }
  }

  return plans;
}

export function rebuildLocalLifeDayPlan(params: {
  day: number;
  currentPlans: ComposedDayPlan[];
  places: PlaceResult[];
  destination: string;
  days: number;
  lat?: number;
  lng?: number;
}): ComposedDayPlan {
  const { day, currentPlans, places, destination, lat, lng } = params;
  const pool = filterPlacesForLocalLife(places);
  const pools = buildLocalLifeCandidatePools(places);
  const allocator = new LocalLifeTripAllocator();
  seedTripAllocatorFromPlans(allocator, currentPlans, [day]);

  return buildSingleLocalLifeDay({
    day,
    dayIndex: day - 1,
    destination,
    pool: allocator.filterPool(pool),
    pools,
    allocator,
    lat,
    lng,
  });
}

export function rebuildLocalLifeIncompleteDays(params: {
  plans: ComposedDayPlan[];
  incompleteDays: number[];
  places: PlaceResult[];
  destination: string;
  days: number;
  lat?: number;
  lng?: number;
}): ComposedDayPlan[] {
  const { plans, incompleteDays, places, destination, days, lat, lng } = params;
  if (!incompleteDays.length) return plans;

  const pool = filterPlacesForLocalLife(places);
  const byDay = new Map(plans.map((plan) => [plan.day, { ...plan, entries: [...plan.entries] }]));

  for (const day of incompleteDays) {
    const existing = byDay.get(day);
    const count = existing?.entries.length ?? 0;
    logAiPipeline("[AI_INCOMPLETE_DAY_DETECTED]", `day=${day}`, `count=${count}`, "rebuild_start");
    logAiPipeline("[AI_REBUILD_INCOMPLETE_DAY]", `days=${day}`, "reason=local_life_sparse");

    const rebuilt = rebuildLocalLifeDayPlan({
      day,
      currentPlans: [...byDay.values()],
      places: pool,
      destination,
      days,
      lat,
      lng,
    });

    if (rebuilt.entries.length > count) {
      byDay.set(day, rebuilt);
    }
  }

  const result: ComposedDayPlan[] = [];
  for (let day = 1; day <= days; day += 1) {
    result.push(byDay.get(day) ?? { day, entries: [] });
  }
  return result;
}

export { seedTripAllocatorFromPlans };
