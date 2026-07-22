/**
 * Filter Candidate Pool for chat / combo recommendations — no Places.
 */
import type { PlaceResult } from "@/lib/place-result";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import { classifyPoolCategory } from "@/lib/ai/candidate-pool/classify";
import type { PoolCategory } from "@/lib/ai/candidate-pool/types";

const INTENT_TO_POOL: Record<ChatPlaceCategoryIntent, PoolCategory[]> = {
  cafe: ["cafe"],
  restaurant: ["food", "market"],
  shopping: ["shopping", "market"],
  attraction: ["attraction", "culture", "nature"],
  night_market: ["night", "market", "food"],
  bar: ["night"],
  indoor: ["culture", "shopping", "attraction"],
};

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Cuisine / keyword filter over pool text (烧肉 / 寿喜烧 / ramen …). */
export function filterPoolByCuisineKeyword(
  places: PlaceResult[],
  keyword: string,
): PlaceResult[] {
  const raw = keyword.trim().toLowerCase();
  if (!raw) return places;
  const aliases = expandCuisineAliases(raw);
  return places.filter((p) => {
    const b = placeBlob(p);
    return aliases.some((a) => b.includes(a));
  });
}

function expandCuisineAliases(keyword: string): string[] {
  const k = keyword.toLowerCase();
  const map: Record<string, string[]> = {
    烧肉: ["烧肉", "燒肉", "yakiniku", "bbq", "烤肉"],
    燒肉: ["烧肉", "燒肉", "yakiniku", "bbq", "烤肉"],
    yakiniku: ["烧肉", "燒肉", "yakiniku", "bbq"],
    寿喜烧: ["寿喜烧", "壽喜燒", "sukiyaki"],
    壽喜燒: ["寿喜烧", "壽喜燒", "sukiyaki"],
    sukiyaki: ["寿喜烧", "壽喜燒", "sukiyaki"],
    拉面: ["拉面", "拉麵", "ramen", "らーめん"],
    拉麵: ["拉面", "拉麵", "ramen", "らーめん"],
    ramen: ["拉面", "拉麵", "ramen"],
    寿司: ["寿司", "壽司", "sushi"],
    壽司: ["寿司", "壽司", "sushi"],
    sushi: ["寿司", "壽司", "sushi"],
    火锅: ["火锅", "火鍋", "hotpot", "hot pot"],
    火鍋: ["火锅", "火鍋", "hotpot", "hot pot"],
  };
  return map[k] ?? [k];
}

export function filterPoolByCategoryIntent(
  places: PlaceResult[],
  intent: ChatPlaceCategoryIntent | string | null | undefined,
): PlaceResult[] {
  if (!intent) return places;
  const cats = INTENT_TO_POOL[intent as ChatPlaceCategoryIntent];
  if (!cats?.length) {
    // Fallback: match primaryType / types loosely
    const needle = String(intent).toLowerCase();
    return places.filter((p) => placeBlob(p).includes(needle));
  }
  return places.filter((p) => cats.includes(classifyPoolCategory(p)));
}

export function filterCandidatePoolPlaces(params: {
  places: PlaceResult[];
  category?: ChatPlaceCategoryIntent | string | null;
  cuisineKeyword?: string | null;
  excludePlaceIds?: string[];
  limit?: number;
}): PlaceResult[] {
  let out = params.places;
  if (params.category) {
    out = filterPoolByCategoryIntent(out, params.category);
  }
  if (params.cuisineKeyword?.trim()) {
    const cuisineFiltered = filterPoolByCuisineKeyword(out, params.cuisineKeyword);
    // If cuisine is too specific and empty, keep category filter (don't zero out)
    if (cuisineFiltered.length) out = cuisineFiltered;
  }
  if (params.excludePlaceIds?.length) {
    const ex = new Set(params.excludePlaceIds);
    out = out.filter((p) => !p.id || !ex.has(p.id));
  }
  // Prefer higher rating / review count
  out = [...out].sort((a, b) => {
    const ra = a.rating ?? 0;
    const rb = b.rating ?? 0;
    if (rb !== ra) return rb - ra;
    return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
  });
  if (params.limit != null && params.limit > 0) {
    out = out.slice(0, params.limit);
  }
  return out;
}

/** Extract a cuisine keyword from user text when present. */
export function extractCuisineKeywordFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const patterns = [
    /燒肉|烧肉|yakiniku/i,
    /壽喜燒|寿喜烧|sukiyaki/i,
    /拉麵|拉面|ramen|ラーメン/i,
    /壽司|寿司|sushi/i,
    /火鍋|火锅|hot\s*pot/i,
    /居酒屋|izakaya/i,
    /牛排|steak/i,
    /義大利|意大利|pasta|pizza|披薩/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[0]) return m[0];
  }
  return null;
}
