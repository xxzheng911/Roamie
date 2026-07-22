/**
 * Build Places search attempts + cuisine/type relevance filters from ActiveRecommendationContext.
 */
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ActiveRecommendationContext } from "@/lib/ai/recommendation-refinement/types";
import {
  attractionTypeSearchTokens,
  cuisineSearchTokens,
  shoppingTypeSearchTokens,
} from "@/lib/ai/recommendation-refinement/parser";

const RESTAURANT_INCLUDED = ["restaurant", "japanese_restaurant", "food"];
const RESTAURANT_EXCLUDED_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "supermarket",
  "convenience_store",
  "lodging",
  "grocery_store",
  "food_court",
  "meal_takeaway",
]);

const CITY_EN: Record<string, string> = {
  札幌: "Sapporo",
  小樽: "Otaru",
  函館: "Hakodate",
  東京: "Tokyo",
  大阪: "Osaka",
  京都: "Kyoto",
  福岡: "Fukuoka",
  名古屋: "Nagoya",
  那霸: "Naha",
  台北: "Taipei",
  臺北: "Taipei",
  台中: "Taichung",
  高雄: "Kaohsiung",
  台南: "Tainan",
};

function searchCity(ctx: ActiveRecommendationContext): string {
  return (
    ctx.resolvedSearchCity?.trim() ||
    ctx.destinationName.trim() ||
    ctx.destinationDisplayName?.trim() ||
    ""
  );
}

function cityEnglish(city: string): string {
  return CITY_EN[city] ?? city;
}

function placeBlob(place: {
  name?: string | null;
  placeName?: string | null;
  description?: string | null;
  reason?: string | null;
  summary?: string | null;
  types?: string[] | null;
  primaryType?: string | null;
  type?: string | null;
}): string {
  return [
    place.name,
    place.placeName,
    place.description,
    place.reason,
    place.summary,
    place.primaryType,
    place.type,
    ...(place.types ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function placeTypes(place: {
  types?: string[] | null;
  primaryType?: string | null;
  type?: string | null;
}): string[] {
  const out = new Set<string>();
  for (const t of [place.primaryType, place.type, ...(place.types ?? [])]) {
    const n = String(t ?? "")
      .trim()
      .toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

/** Cuisine relevance: name / summary / types / description must match at least one token. */
export function placeMatchesCuisineRelevance(
  place: {
    name?: string | null;
    placeName?: string | null;
    description?: string | null;
    reason?: string | null;
    summary?: string | null;
    types?: string[] | null;
    primaryType?: string | null;
    type?: string | null;
  },
  cuisineIds: string[],
): boolean {
  if (!cuisineIds.length) return true;
  const blob = placeBlob(place);
  for (const id of cuisineIds) {
    const tokens = cuisineSearchTokens(id);
    if (tokens.some((tok) => blob.includes(tok.toLowerCase()))) return true;
    // id itself (sukiyaki, ramen…)
    if (blob.includes(id.toLowerCase())) return true;
  }
  return false;
}

/** Alias for Food Intent subtype matching (dish / cuisine). */
export function matchesFoodIntent(
  place: {
    name?: string | null;
    placeName?: string | null;
    description?: string | null;
    reason?: string | null;
    summary?: string | null;
    types?: string[] | null;
    primaryType?: string | null;
    type?: string | null;
  },
  intent: { dishType?: string; cuisineType?: string; subtypes?: string[] },
): boolean {
  const ids = [
    ...(intent.subtypes ?? []),
    intent.dishType,
    intent.cuisineType,
  ].filter((x): x is string => Boolean(x));
  if (!ids.length) return isAcceptableRestaurantPlace(place);
  return placeMatchesCuisineRelevance(place, ids);
}

export function isAcceptableRestaurantPlace(place: {
  types?: string[] | null;
  primaryType?: string | null;
  type?: string | null;
  businessStatus?: string | null;
}): boolean {
  const types = placeTypes(place);
  if (types.some((t) => RESTAURANT_EXCLUDED_TYPES.has(t)) && !types.some((t) => t.includes("restaurant"))) {
    return false;
  }
  const status = String(place.businessStatus ?? "").toUpperCase();
  if (status === "CLOSED_PERMANENTLY" || status === "PERMANENTLY_CLOSED") return false;
  return true;
}

export function placeMatchesExcludedKeywords(
  place: {
    name?: string | null;
    placeName?: string | null;
    description?: string | null;
    reason?: string | null;
    summary?: string | null;
    types?: string[] | null;
  },
  excluded: string[] | undefined,
): boolean {
  if (!excluded?.length) return false;
  const blob = placeBlob(place);
  return excluded.some((kw) => blob.includes(kw.toLowerCase()));
}

export function filterPlacesByRecommendationContext(
  places: PlaceResult[],
  ctx: ActiveRecommendationContext,
): {
  accepted: PlaceResult[];
  categoryAccepted: number;
  subcategoryAccepted: number;
  duplicateRejected: number;
  locationRejected: number;
  qualityRejected: number;
} {
  const excludeIds = new Set(ctx.previousPlaceIds.map((id) => id.trim()).filter(Boolean));
  const excludeKeys = new Set(ctx.previousCanonicalKeys.map((k) => k.trim().toLowerCase()).filter(Boolean));

  let categoryAccepted = 0;
  let subcategoryAccepted = 0;
  let duplicateRejected = 0;
  let locationRejected = 0;
  let qualityRejected = 0;
  const accepted: PlaceResult[] = [];

  for (const place of places) {
    const id = (place.id ?? "").trim();
    const nameKey = `n:${(place.name ?? "").trim().toLowerCase()}`;
    if ((id && excludeIds.has(id)) || excludeKeys.has(nameKey) || (id && excludeKeys.has(`id:${id}`))) {
      duplicateRejected += 1;
      continue;
    }

    if (ctx.intent === "restaurant") {
      if (!isAcceptableRestaurantPlace(place)) {
        qualityRejected += 1;
        continue;
      }
      categoryAccepted += 1;
      if (ctx.cuisine?.length && !placeMatchesCuisineRelevance(place, ctx.cuisine)) {
        qualityRejected += 1;
        continue;
      }
      if (ctx.cuisine?.length) subcategoryAccepted += 1;
    } else {
      categoryAccepted += 1;
      subcategoryAccepted += 1;
    }

    if (placeMatchesExcludedKeywords(place, ctx.excludedKeywords)) {
      qualityRejected += 1;
      continue;
    }

    if (ctx.highRatingPreferred && (place.rating == null || place.rating < 4.0)) {
      // Soft: keep but deprioritize later — still accept if pool would empty
    }

    accepted.push(place);
  }

  // Soft high-rating: prefer >= 4.0 when enough remain
  if (ctx.highRatingPreferred) {
    const high = accepted.filter((p) => (p.rating ?? 0) >= 4.0);
    if (high.length >= 2) {
      return {
        accepted: high,
        categoryAccepted,
        subcategoryAccepted,
        duplicateRejected,
        locationRejected,
        qualityRejected,
      };
    }
  }

  return {
    accepted,
    categoryAccepted,
    subcategoryAccepted,
    duplicateRejected,
    locationRejected,
    qualityRejected,
  };
}

export function filterRecommendationsByExcludedKeywords(
  items: RoamieRecommendationItem[],
  excluded: string[] | undefined,
): RoamieRecommendationItem[] {
  if (!excluded?.length) return items;
  return items.filter((item) => !placeMatchesExcludedKeywords(item, excluded));
}

export function buildRefinementSearchAttempts(
  ctx: ActiveRecommendationContext,
): SearchAttempt[] {
  const city = searchCity(ctx);
  const cityEn = cityEnglish(city);
  const attempts: SearchAttempt[] = [];

  if (ctx.intent === "restaurant") {
    const cuisines = ctx.cuisine?.length ? ctx.cuisine : [];
    if (cuisines.length) {
      for (const id of cuisines) {
        const tokens = cuisineSearchTokens(id);
        for (const tok of tokens.slice(0, 3)) {
          attempts.push({
            query: `${city} ${tok}`,
            mode: "text",
            includedTypes: RESTAURANT_INCLUDED,
          });
        }
        attempts.push({
          query: `${cityEn} ${id} restaurant`,
          mode: "text",
          includedTypes: RESTAURANT_INCLUDED,
        });
      }
    } else {
      attempts.push({
        query: `${city} restaurant`,
        mode: "text",
        includedTypes: RESTAURANT_INCLUDED,
      });
      attempts.push({
        query: `${city} 人氣餐廳`,
        mode: "text",
        includedTypes: RESTAURANT_INCLUDED,
      });
    }
    if (ctx.budget?.level === "cheap") {
      attempts.push({
        query: `${city} 平價 ${(cuisines[0] ? cuisineSearchTokens(cuisines[0])[0] : "餐廳")}`,
        mode: "text",
        includedTypes: RESTAURANT_INCLUDED,
      });
    }
    if (ctx.mealSlot === "dinner") {
      attempts.push({
        query: `${city} 晚餐 ${(cuisines[0] ? cuisineSearchTokens(cuisines[0])[0] : "餐廳")}`,
        mode: "text",
        includedTypes: RESTAURANT_INCLUDED,
      });
    }
  } else if (ctx.intent === "shopping") {
    const types = ctx.shoppingTypes?.length ? ctx.shoppingTypes : ["shopping_street"];
    for (const id of types) {
      for (const tok of shoppingTypeSearchTokens(id).slice(0, 2)) {
        attempts.push({
          query: `${city} ${tok}`,
          mode: "text",
          includedTypes: ["shopping_mall", "department_store", "clothing_store", "store"],
        });
      }
    }
  } else if (ctx.intent === "cafe") {
    const extras = (ctx.atmosphere ?? []).slice(0, 2);
    attempts.push({
      query: `${city} cafe`,
      mode: "text",
      includedTypes: ["cafe", "coffee_shop"],
    });
    attempts.push({
      query: `${city} 咖啡廳`,
      mode: "text",
      includedTypes: ["cafe", "coffee_shop"],
    });
    if (extras.includes("quiet") || ctx.quietOnly) {
      attempts.push({
        query: `${city} 安靜 咖啡廳`,
        mode: "text",
        includedTypes: ["cafe", "coffee_shop"],
      });
    }
    if (extras.includes("outlet") || extras.includes("power_outlet") || ctx.preferredKeywords?.includes("outlet") || ctx.preferredKeywords?.includes("power_outlet")) {
      attempts.push({
        query: `${city} 咖啡廳 插座`,
        mode: "text",
        includedTypes: ["cafe", "coffee_shop"],
      });
      attempts.push({
        query: `${cityEn} cafe power outlet`,
        mode: "text",
        includedTypes: ["cafe", "coffee_shop"],
      });
    }
    if (extras.includes("sofa") || ctx.preferredKeywords?.includes("sofa")) {
      attempts.push({
        query: `${city} 沙發 咖啡廳`,
        mode: "text",
        includedTypes: ["cafe", "coffee_shop"],
      });
      attempts.push({
        query: `${cityEn} cafe sofa seating`,
        mode: "text",
        includedTypes: ["cafe", "coffee_shop"],
      });
    }
  } else if (ctx.intent === "attraction" || ctx.intent === "indoor") {
    const types = ctx.attractionTypes?.length
      ? ctx.attractionTypes
      : ctx.indoorOnly
        ? ["indoor"]
        : ["culture"];
    for (const id of types) {
      for (const tok of attractionTypeSearchTokens(id).slice(0, 2)) {
        attempts.push({
          query: `${city} ${tok}`,
          mode: "text",
          includedTypes: ["tourist_attraction", "museum"],
        });
      }
    }
    if (ctx.indoorOnly || types.includes("rainy_day") || types.includes("indoor")) {
      attempts.push({
        query: `${city} 室內景點`,
        mode: "text",
        includedTypes: ["museum", "art_gallery", "tourist_attraction"],
      });
    }
  } else if (ctx.intent === "nightlife") {
    attempts.push({
      query: `${city} bar`,
      mode: "text",
      includedTypes: ["bar", "night_club"],
    });
    attempts.push({
      query: `${city} 酒吧`,
      mode: "text",
      includedTypes: ["bar"],
    });
    if (ctx.quietOnly || ctx.atmosphere?.includes("quiet")) {
      attempts.push({
        query: `${city} 安靜 酒吧`,
        mode: "text",
        includedTypes: ["bar"],
      });
    }
  } else {
    attempts.push({
      query: `${city} 推薦`,
      mode: "text",
    });
  }

  // Dedupe by query
  const seen = new Set<string>();
  return attempts.filter((a) => {
    const key = a.query.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function logRefinementSearchStart(
  ctx: ActiveRecommendationContext,
  queries: string[],
): void {
  console.info(
    "[RECOMMENDATION_REFINEMENT_SEARCH_START]",
    `intent=${ctx.intent}`,
    `queries=${queries.join(" | ")}`,
    `destination=${ctx.destinationDisplayName ?? ctx.destinationName}`,
    `excludedPlaceIds=${ctx.previousPlaceIds.length}`,
    `excludedCanonicalKeys=${ctx.previousCanonicalKeys.length}`,
  );
}

export function logRefinementSearchResult(stats: {
  rawCount: number;
  categoryAccepted: number;
  subcategoryAccepted: number;
  duplicateRejected: number;
  locationRejected: number;
  qualityRejected: number;
  finalCount: number;
}): void {
  console.info(
    "[RECOMMENDATION_REFINEMENT_SEARCH_RESULT]",
    `rawCount=${stats.rawCount}`,
    `categoryAccepted=${stats.categoryAccepted}`,
    `subcategoryAccepted=${stats.subcategoryAccepted}`,
    `duplicateRejected=${stats.duplicateRejected}`,
    `locationRejected=${stats.locationRejected}`,
    `qualityRejected=${stats.qualityRejected}`,
    `finalCount=${stats.finalCount}`,
  );
}
