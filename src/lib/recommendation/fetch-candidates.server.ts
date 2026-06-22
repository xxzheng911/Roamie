import {
  isRecommendablePlace,
  placeResultToRecommendableInput,
} from "@/lib/is-recommendable-place";
import { executeExploreSearch } from "@/lib/places.functions";
import type { PlaceResult } from "@/lib/place-result";
import { getCategoryDef, pickCategoriesForContext } from "@/lib/recommendation/categories";
import { placeResultToCandidate } from "@/lib/recommendation/place-mapping";
import {
  AI_MIN_CANDIDATES_TARGET,
  AI_PRIMARY_CATEGORY_COUNT,
  buildAiCategoryCacheKey,
  countCategorySearchHttpCalls,
  getAiCategoryCache,
  logAiPlaceCacheHit,
  logAiPlaceCacheMiss,
  logAiPlaceSearch,
  setAiCategoryCache,
} from "@/lib/recommendation/ai-places-cache";
import { placesStatsPayload } from "@/lib/places-api-stats";
import type {
  RecommendationCategoryId,
  RecommendationContext,
  VerifiedPlaceCandidate,
} from "@/lib/recommendation/types";

const PER_CATEGORY_LIMIT = 4;
const MAX_TOTAL_CANDIDATES = 28;

function mergeByPlaceId(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const p of places) {
    if (!p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function filterExcluded(
  items: VerifiedPlaceCandidate[],
  excludeNames: Set<string>,
): VerifiedPlaceCandidate[] {
  return items.filter((c) => !excludeNames.has(c.name.trim().toLowerCase()));
}

function mergeCandidates(
  target: Map<string, VerifiedPlaceCandidate>,
  items: VerifiedPlaceCandidate[],
): void {
  for (const c of items) {
    if (!target.has(c.googlePlaceId)) target.set(c.googlePlaceId, c);
  }
}

async function searchCategory(
  categoryId: RecommendationCategoryId,
  ctx: RecommendationContext,
  phase: "primary" | "fallback",
): Promise<VerifiedPlaceCandidate[]> {
  const def = getCategoryDef(categoryId);
  if (!def) return [];

  const cacheKey = buildAiCategoryCacheKey({
    city: ctx.location.city,
    lat: ctx.location.lat,
    lng: ctx.location.lng,
    categoryId,
    weather: ctx.weather,
    time: ctx.time,
  });

  const cached = getAiCategoryCache(cacheKey);
  if (cached) {
    logAiPlaceCacheHit(cacheKey);
    return cached;
  }

  logAiPlaceCacheMiss(cacheKey);

  const httpCalls = countCategorySearchHttpCalls(def);
  logAiPlaceSearch({
    categoryId,
    mode: def.mode,
    nearby: httpCalls.nearby,
    text: httpCalls.text,
    phase,
  });

  const { places, error } = await executeExploreSearch({
    lat: ctx.location.lat,
    lng: ctx.location.lng,
    query: def.query,
    mode: def.mode,
    includedTypes: def.includedTypes,
    nearbyGroups: def.nearbyGroups,
    locale: ctx.locale,
    categoryId,
    ...placesStatsPayload({
      placesCaller: "fetchVerifiedCandidates.searchCategory",
      placesScreen: "ai_recommend",
      categoryId,
    }),
  });

  if (error) {
    console.warn("[Roamie Rec] category search failed", categoryId, error);
    setAiCategoryCache(cacheKey, []);
    return [];
  }

  const candidates = mergeByPlaceId(places)
    .filter((p) =>
      isRecommendablePlace(
        placeResultToRecommendableInput(p, { categoryId }),
        "ai_recommend",
      ).ok,
    )
    .slice(0, PER_CATEGORY_LIMIT)
    .map((p) => placeResultToCandidate(p, categoryId))
    .filter((c): c is VerifiedPlaceCandidate => c != null);

  setAiCategoryCache(cacheKey, candidates);
  return candidates;
}

async function searchCategoriesSequential(
  categoryIds: RecommendationCategoryId[],
  ctx: RecommendationContext,
  excludeNames: Set<string>,
  phase: "primary" | "fallback",
): Promise<VerifiedPlaceCandidate[]> {
  const out: VerifiedPlaceCandidate[] = [];
  for (const categoryId of categoryIds) {
    const items = filterExcluded(await searchCategory(categoryId, ctx, phase), excludeNames);
    out.push(...items);
  }
  return out;
}

/**
 * Google Places 先取得真實候選地點（含 place_id、座標、評分、照片）
 */
export async function fetchVerifiedCandidates(
  ctx: RecommendationContext,
): Promise<VerifiedPlaceCandidate[]> {
  const allCategories = pickCategoriesForContext({
    weather: ctx.weather,
    mood: ctx.mood,
    max: 6,
    constraints: ctx.constraints,
  });

  const primaryIds = allCategories
    .slice(0, AI_PRIMARY_CATEGORY_COUNT)
    .map((c) => c.id as RecommendationCategoryId);
  const fallbackIds = allCategories
    .slice(AI_PRIMARY_CATEGORY_COUNT)
    .map((c) => c.id as RecommendationCategoryId);

  const excludeNames = new Set(
    [
      ...(ctx.recentRecommendationNames ?? []),
      ...(ctx.rejectedPlaceNames ?? []),
      ...(ctx.selectedPlaceNames ?? []),
    ].map((n) => n.trim().toLowerCase()),
  );

  const merged = new Map<string, VerifiedPlaceCandidate>();

  const primaryItems = await searchCategoriesSequential(primaryIds, ctx, excludeNames, "primary");
  mergeCandidates(merged, primaryItems);

  if (merged.size < AI_MIN_CANDIDATES_TARGET && fallbackIds.length > 0) {
    for (const categoryId of fallbackIds) {
      if (merged.size >= AI_MIN_CANDIDATES_TARGET) break;
      const items = filterExcluded(
        await searchCategory(categoryId, ctx, "fallback"),
        excludeNames,
      );
      mergeCandidates(merged, items);
    }
  }

  const savedBoost = [...merged.values()].filter((c) =>
    ctx.savedPlaceNames?.some((s) => s.trim() === c.name.trim()),
  );

  const rest = [...merged.values()].filter(
    (c) => !savedBoost.some((b) => b.googlePlaceId === c.googlePlaceId),
  );

  return [...savedBoost, ...rest].slice(0, MAX_TOTAL_CANDIDATES);
}

export function candidatesToAiList(candidates: VerifiedPlaceCandidate[]): string {
  return candidates
    .map((c, i) => {
      const rating =
        c.rating != null ? `｜評分 ${c.rating}${c.userRatingCount ? `（${c.userRatingCount} 則）` : ""}` : "";
      const hours = [c.openStatusLabel, c.todayHoursLabel].filter(Boolean).join(" ");
      return `${i + 1}. ${c.name}｜place_id:${c.googlePlaceId}｜類型：${c.type}｜地址：${c.address}${rating}${hours ? `｜${hours}` : ""}｜座標：${c.lat}, ${c.lng}`;
    })
    .join("\n");
}
