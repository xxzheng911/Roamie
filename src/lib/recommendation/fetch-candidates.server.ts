import type { Locale } from "@/lib/i18n/types";
import { executeExploreSearch } from "@/lib/places.functions";
import type { PlaceResult } from "@/lib/place-result";
import { getCategoryDef, pickCategoriesForContext } from "@/lib/recommendation/categories";
import { placeResultToCandidate } from "@/lib/recommendation/place-mapping";
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

async function searchCategory(
  categoryId: RecommendationCategoryId,
  ctx: RecommendationContext,
): Promise<VerifiedPlaceCandidate[]> {
  const def = getCategoryDef(categoryId);
  if (!def) return [];

  const { places, error } = await executeExploreSearch({
    lat: ctx.location.lat,
    lng: ctx.location.lng,
    query: def.query,
    mode: def.mode,
    includedTypes: def.includedTypes,
    nearbyGroups: def.nearbyGroups,
    locale: ctx.locale,
  });

  if (error) {
    console.warn("[Roamie Rec] category search failed", categoryId, error);
    return [];
  }

  return mergeByPlaceId(places)
    .slice(0, PER_CATEGORY_LIMIT)
    .map((p) => placeResultToCandidate(p, categoryId))
    .filter((c): c is VerifiedPlaceCandidate => c != null);
}

/**
 * Google Places 先取得真實候選地點（含 place_id、座標、評分、照片）
 */
export async function fetchVerifiedCandidates(
  ctx: RecommendationContext,
): Promise<VerifiedPlaceCandidate[]> {
  const categories = pickCategoriesForContext({
    weather: ctx.weather,
    mood: ctx.mood,
    max: 6,
    constraints: ctx.constraints,
  });

  const excludeNames = new Set(
    [
      ...(ctx.recentRecommendationNames ?? []),
      ...(ctx.rejectedPlaceNames ?? []),
      ...(ctx.selectedPlaceNames ?? []),
    ].map((n) => n.trim().toLowerCase()),
  );

  const settled = await Promise.all(
    categories.map(async (cat) => {
      const items = await searchCategory(cat.id as RecommendationCategoryId, ctx);
      return items.filter((c) => !excludeNames.has(c.name.trim().toLowerCase()));
    }),
  );

  const merged = new Map<string, VerifiedPlaceCandidate>();
  for (const group of settled) {
    for (const c of group) {
      if (!merged.has(c.googlePlaceId)) merged.set(c.googlePlaceId, c);
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
