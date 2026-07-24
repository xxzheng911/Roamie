import type { PlaceResult } from "@/lib/place-result";
import { normalizeCorePlaceName, normalizePlaceName } from "@/lib/place-planning-memory";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { ComposedDayPlan } from "@/lib/ai/ai-day-plan-source";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";

export type PlaceGeocodeStatus = "ok" | "empty";

export type HardRulePlaceKind =
  | "attraction"
  | "restaurant"
  | "shopping"
  | "cafe"
  | "night_market";

const FALLBACK_ID_PREFIXES = [
  "synthetic:",
  "landmark-cache:",
  "local-life-fallback:",
  "slow-nature-fallback:",
  "classic-fallback:",
] as const;

function isFallbackPlanningId(id: string): boolean {
  return FALLBACK_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export type PlaceCardLike = {
  googlePlaceId?: string | null;
  placeId?: string | null;
  cid?: string | null;
  name?: string | null;
  address?: string | null;
};

/** 地點卡 global dedupe：place id → cid → normalizedName+address */
export function resolvePlaceCardDedupeKey(item: PlaceCardLike): string {
  const placeId = (
    item.googlePlaceId ??
    item.placeId ??
    ""
  ).trim();
  if (placeId && !isFallbackPlanningId(placeId)) return `id:${placeId}`;

  const cid = (item.cid ?? "").trim();
  if (cid) return `cid:${cid}`;

  const name = normalizeCorePlaceName(item.name ?? "");
  const address = normalizePlaceName(item.address ?? "");
  if (name && address) return `na:${name}|${address}`;
  if (name) return `n:${name}`;
  return "";
}

export function dedupePlaceCardsForRender<T extends PlaceCardLike>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = resolvePlaceCardDedupeKey(item);
    if (!key) {
      out.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  if (out.length < items.length) {
    logAiPipeline(
      "[AI_PLACE_CARDS_DEDUPED]",
      `before=${items.length}`,
      `after=${out.length}`,
    );
  }
  return out;
}

export function dedupeRecommendationItems(items: RoamieRecommendationItem[]): RoamieRecommendationItem[] {
  return dedupePlaceCardsForRender(items);
}

/** Step7：Google Place ID 優先；fallback 則用核心名稱去重（象山/象山步道視為同一） */
export function resolveTripPlaceId(place: PlaceResult): string {
  return resolveCanonicalPlaceIdentity(place).identityKey;
}

export function resolvePlaceGeocodeStatus(place: PlaceResult): PlaceGeocodeStatus {
  if (place.lat != null && place.lng != null) return "ok";
  return "empty";
}

export function isGeocodeEmptyPlace(place: PlaceResult): boolean {
  return resolvePlaceGeocodeStatus(place) === "empty";
}

export function logAiPlaceSelected(day: number, placeId: string): void {
  logAiPipeline("[AI_PLACE_SELECTED]", `day=${day}`, `placeId=${placeId}`);
}

export function logAiPlaceRejectDuplicate(day: number, placeId: string, reason: string): void {
  logAiPipeline("[AI_PLACE_REJECT_DUPLICATE]", `day=${day}`, `placeId=${placeId}`, `reason=${reason}`);
}

export function logAiDayUniqueCount(day: number, count: number): void {
  logAiPipeline("[AI_DAY_UNIQUE_COUNT]", `day=${day}`, `count=${count}`);
}

export function logAiGlobalUsedPlaces(count: number): void {
  logAiPipeline("[AI_GLOBAL_USED_PLACES]", `count=${count}`);
}

export function logAiGeocodeEmptyDrop(placeId: string, name: string): void {
  logAiPipeline("[AI_GEOCODE_EMPTY_DROP]", `placeId=${placeId}`, `name=${name}`);
}

export function filterPoolForScheduling(
  pool: PlaceResult[],
  usedPlaceIds: Set<string>,
): PlaceResult[] {
  return pool.filter((place) => {
    const id = resolveTripPlaceId(place);
    if (!id || usedPlaceIds.has(id)) return false;
    if (isGeocodeEmptyPlace(place)) {
      logAiGeocodeEmptyDrop(id, place.name ?? "");
      return false;
    }
    return true;
  });
}

export function resolveHardRuleKind(place: PlaceResult): HardRulePlaceKind | null {
  const blob = [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/夜市|night market|night_market/.test(blob)) return "night_market";
  if (/咖啡|cafe|coffee|coffee_shop/.test(blob)) return "cafe";
  if (/餐|restaurant|food|小吃|bistro|dining/.test(blob)) return "restaurant";
  if (/商圈|shopping|mall|market|老街|街區/.test(blob)) return "shopping";
  if (
    /museum|attraction|park|景|公園|文化|文創|gallery|heritage|natural/.test(blob) ||
    (place.types ?? []).some((t) =>
      /tourist_attraction|museum|park|art_gallery|natural_feature/.test(t),
    )
  ) {
    return "attraction";
  }
  return "attraction";
}

export type TripPlaceUniquenessValidation = {
  ok: boolean;
  reasons: string[];
  failedDays: number[];
  duplicatePlaceIds: string[];
};

export function validateTripPlaceUniqueness(
  plans: ComposedDayPlan[],
  requestedDays: number,
): TripPlaceUniquenessValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();
  const duplicatePlaceIds = new Set<string>();
  const seenIds = new Map<string, number>();
  const seenNames = new Map<string, number>();
  const seenHardRule = new Map<string, { day: number; name: string }>();

  for (const plan of plans) {
    if (plan.day < 1 || plan.day > requestedDays) continue;
    const dayIds = new Set<string>();

    for (const entry of plan.entries) {
      const id = resolveTripPlaceId(entry.place);
      const norm = normalizeCorePlaceName(entry.name);
      if (!id) continue;

      dayIds.add(id);

      if (seenIds.has(id)) {
        reasons.push(`duplicate_place_id:${id}`);
        duplicatePlaceIds.add(id);
        failedDays.add(plan.day);
        failedDays.add(seenIds.get(id)!);
      } else {
        seenIds.set(id, plan.day);
      }

      if (norm) {
        if (seenNames.has(norm)) {
          reasons.push(`duplicate_normalized_name:${norm}`);
          failedDays.add(plan.day);
          failedDays.add(seenNames.get(norm)!);
        } else {
          seenNames.set(norm, plan.day);
        }
      }

      const hardKind = resolveHardRuleKind(entry.place);
      if (hardKind) {
        const key = `${hardKind}:${id}`;
        const prev = seenHardRule.get(key);
        if (prev) {
          reasons.push(`duplicate_${hardKind}:${entry.name}`);
          duplicatePlaceIds.add(id);
          failedDays.add(plan.day);
          failedDays.add(prev.day);
        } else {
          seenHardRule.set(key, { day: plan.day, name: entry.name });
        }
      }
    }

    logAiDayUniqueCount(plan.day, dayIds.size);
  }

  logAiGlobalUsedPlaces(seenIds.size);

  return {
    ok: reasons.length === 0,
    reasons,
    failedDays: [...failedDays],
    duplicatePlaceIds: [...duplicatePlaceIds],
  };
}

export class TripPlaceAllocator {
  readonly usedPlaceIds = new Set<string>();
  readonly usedPlaceNames = new Set<string>();
  private readonly usedHardRuleKeys = new Set<string>();

  isUsed(place: PlaceResult): boolean {
    const id = resolveTripPlaceId(place);
    if (id && this.usedPlaceIds.has(id)) return true;
    const norm = normalizeCorePlaceName(place.name ?? "");
    if (norm && this.usedPlaceNames.has(norm)) return true;
    const hardKind = resolveHardRuleKind(place);
    if (hardKind && id) {
      if (this.usedHardRuleKeys.has(`${hardKind}:${id}`)) return true;
    }
    return false;
  }

  rejectIfUsed(place: PlaceResult, day: number, reason = "already_used"): boolean {
    if (!this.isUsed(place)) return false;
    logAiPlaceRejectDuplicate(day, resolveTripPlaceId(place), reason);
    return true;
  }

  markUsed(place: PlaceResult, day: number): void {
    const id = resolveTripPlaceId(place);
    if (!id) return;
    this.usedPlaceIds.add(id);
    const norm = normalizeCorePlaceName(place.name ?? "");
    if (norm) this.usedPlaceNames.add(norm);
    const hardKind = resolveHardRuleKind(place);
    if (hardKind) this.usedHardRuleKeys.add(`${hardKind}:${id}`);
    logAiPlaceSelected(day, id);
  }

  filterPool(pool: PlaceResult[]): PlaceResult[] {
    return filterPoolForScheduling(pool, this.usedPlaceIds);
  }
}

export function seedTripAllocatorFromPlans(
  allocator: TripPlaceAllocator,
  plans: ComposedDayPlan[],
  excludeDays: number[] = [],
): void {
  const excluded = new Set(excludeDays);
  for (const plan of plans) {
    if (excluded.has(plan.day)) continue;
    for (const entry of plan.entries) {
      allocator.markUsed(entry.place, plan.day);
    }
  }
}
