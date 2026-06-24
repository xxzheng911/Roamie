import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  chatResponseModeForIntent,
  type NearbyPlaceIntent,
} from "@/lib/ai/chat-intent";
import { foodPreferenceSearchQuery } from "@/lib/ai/chat-dining-flow";
import {
  buildCampingRecommendationSummary,
  campingSearchAttempts,
  filterCampingPlaces,
} from "@/lib/ai/activity-camping";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/map-explore";
import {
  budgetPenaltyForPlace,
  buildBudgetRefinementSummary,
  lowBudgetSearchQuery,
  refinePlaceResultsForBudget,
} from "@/lib/ai/budget-refinement";
import {
  buildExclusionAcknowledgment,
  buildExclusionInsufficientSummary,
  filterPlacesByExclusion,
} from "@/lib/ai/recommendation-exclusion";
import {
  beginPlacesFlow,
  endPlacesFlow,
  placesStatsPayload,
} from "@/lib/places-api-stats";

export type PlaceSearchFn = (args: {
  data: {
    query: string;
    lat: number;
    lng: number;
    mode: "nearby" | "text" | "multi";
    includedTypes?: string[];
    locale?: Locale;
  };
}) => Promise<{ places?: PlaceResult[] }>;

const RECOMMENDATION_COUNT = 5;

function searchConfigForIntent(
  intent: NearbyPlaceIntent,
  foodPreference?: string,
  context?: CanonicalTravelContext,
): {
  query: string;
  mode: "nearby" | "text";
  includedTypes?: string[];
} {
  const moodBlob = `${context?.mood ?? ""} ${context?.setting ?? ""} ${context?.tripPurpose ?? ""}`;

  if (context?.budgetPreference === "low" || context?.tripPurpose === "refine_recommendations") {
    return lowBudgetSearchQuery(intent, moodBlob);
  }

  if (intent === "restaurant") {
    const cuisineQuery =
      foodPreference && foodPreference !== "any"
        ? foodPreferenceSearchQuery(foodPreference)
        : undefined;
    if (cuisineQuery) {
      return { query: cuisineQuery, mode: "text" };
    }
    return {
      query: "餐廳 聚餐",
      mode: "nearby",
      includedTypes: ["restaurant"],
    };
  }
  if (intent === "cafe") {
    return {
      query: /下雨|雨天|室內/.test(moodBlob) ? "室內 咖啡廳" : "咖啡廳",
      mode: "nearby",
      includedTypes: ["cafe", "coffee_shop"],
    };
  }
  if (intent === "camping") {
    return {
      query: "露營區 campground glamping",
      mode: "text",
      includedTypes: ["campground", "rv_park", "lodging"],
    };
  }
  if (/(下雨|雨天|室內)/.test(moodBlob)) {
    return {
      query: "室內 景點",
      mode: "nearby",
      includedTypes: ["museum", "shopping_mall", "cafe", "book_store", "tourist_attraction"],
    };
  }
  if (/(累|疲|放鬆|放空)/.test(moodBlob)) {
    return {
      query: "公園 散步",
      mode: "nearby",
      includedTypes: ["park", "tourist_attraction", "cafe"],
    };
  }
  return {
    query: "景點",
    mode: "nearby",
    includedTypes: ["tourist_attraction", "park", "museum"],
  };
}

function rankPlaces(
  places: PlaceResult[],
  lat: number,
  lng: number,
  context?: CanonicalTravelContext,
): PlaceResult[] {
  const preference = context?.budgetPreference;
  return [...places].sort((a, b) => {
    const distA =
      a.lat != null && a.lng != null ? distanceMeters(lat, lng, a.lat, a.lng) : Number.MAX_SAFE_INTEGER;
    const distB =
      b.lat != null && b.lng != null ? distanceMeters(lat, lng, b.lat, b.lng) : Number.MAX_SAFE_INTEGER;
    const scoreA =
      (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10) -
      distA / 50_000 +
      budgetPenaltyForPlace(a, preference) * -0.5;
    const scoreB =
      (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10) -
      distB / 50_000 +
      budgetPenaltyForPlace(b, preference) * -0.5;
    return scoreB - scoreA;
  });
}

function formatPlaceList(picks: PlaceResult[]): string {
  return picks
    .slice(0, RECOMMENDATION_COUNT)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");
}

function weatherLead(ctx: CanonicalTravelContext): string {
  const condition = ctx.weather?.condition?.trim();
  if (!condition) return "";
  if (/雨|陰|多雲/.test(condition)) return `今天天氣${condition}，`;
  return "我看現在天氣不錯，";
}

function buildSummary(
  intent: NearbyPlaceIntent,
  picks: PlaceResult[],
  ctx: CanonicalTravelContext,
  excludedCategories?: string[],
): string {
  if (ctx.budgetPreference === "low" || ctx.tripPurpose === "refine_recommendations") {
    return buildBudgetRefinementSummary(ctx, picks);
  }

  const list = formatPlaceList(picks);
  const weather = weatherLead(ctx);
  const exclusionAck = buildExclusionAcknowledgment(excludedCategories);

  if (intent === "cafe") {
    const lead = exclusionAck ?? "看起來你想找個地方放鬆一下 ☕";
    return [
      lead,
      "",
      "附近有幾間我覺得不錯的選擇：",
      "",
      list,
      "",
      "如果你偏好：",
      "- 安靜讀書",
      "- 有插座",
      "- 甜點好吃",
      "- 適合久坐",
      "",
      "我可以再幫你縮小範圍。",
    ].join("\n");
  }

  if (intent === "restaurant") {
    const lead =
      exclusionAck ?? "依你現在的需求，附近這幾間餐廳值得先看看：";
    return [
      lead,
      "",
      list,
      "",
      "如果想換個菜系或預算，跟我說一聲就好。",
    ].join("\n");
  }

  if (intent === "camping") {
    return buildCampingRecommendationSummary(picks, ctx);
  }

  const mood = ctx.mood;
  if (!mood) {
    return [
      "附近這幾個地方可以先看看：",
      "",
      list,
      "",
      "選一個最有感覺的，或跟我說想調整什麼。",
    ].join("\n");
  }
  if (/(下雨|雨天)/.test(mood) || ctx.setting === "室內") {
    return [
      "下雨天也想出門走走對吧？",
      "",
      `${weather}附近這幾個地方比較適合待在室內：`,
      "",
      list,
      "",
      "偏好咖啡廳、書店還是展覽？我可以再幫你縮小範圍。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (/(累|疲|放鬆|放空)/.test(mood)) {
    return [
      "今天想放空一下對吧？",
      "",
      `${weather}附近有幾個適合慢慢走的地方：`,
      "",
      list,
      "",
      "偏好咖啡廳、散步還是海景？跟我說一下，我可以再幫你縮小範圍。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `依「${mood}」的心情，附近這幾個地方可以先看看：`,
    "",
    list,
    "",
    "選一個最有感覺的，或跟我說想調整什麼。",
  ].join("\n");
}

type SearchAttempt = {
  query: string;
  mode: "nearby" | "text";
  includedTypes?: string[];
};

/** 餐廳搜尋 fallback：菜系 text → 通用 text → nearby */
export function restaurantSearchFallbackQueries(foodPreference?: string): SearchAttempt[] {
  const attempts: SearchAttempt[] = [];
  const cuisineQuery =
    foodPreference && foodPreference !== "any"
      ? foodPreferenceSearchQuery(foodPreference)
      : undefined;

  if (cuisineQuery) {
    attempts.push({ query: cuisineQuery, mode: "text" });
    if (foodPreference === "italian") {
      attempts.push({ query: "Italian restaurant", mode: "text" });
      attempts.push({ query: "義大利餐廳", mode: "text" });
    }
  }

  attempts.push({ query: "餐廳", mode: "text" });
  attempts.push({ query: "餐廳 聚餐", mode: "nearby", includedTypes: ["restaurant"] });
  return attempts;
}

async function runPlaceSearch(
  searchPlaces: PlaceSearchFn,
  lat: number,
  lng: number,
  locale: Locale,
  attempt: SearchAttempt,
): Promise<PlaceResult[]> {
  console.info(
    `[CHAT_PLACES_REQUEST] mode=${attempt.mode} query=${attempt.query || "(nearby)"}`,
  );
  const result = await searchPlaces({
    data: {
      query: attempt.query,
      lat,
      lng,
      mode: attempt.mode,
      includedTypes: attempt.includedTypes,
      locale,
      ...placesStatsPayload({
        placesCaller: "chat.runPlaceSearch",
        placesScreen: "chat",
      }),
    },
  });
  return result.places ?? [];
}

export async function fetchNearbyPlacesForIntent(
  intent: NearbyPlaceIntent,
  lat: number,
  lng: number,
  locale: Locale,
  searchPlaces: PlaceSearchFn,
  foodPreference?: string,
  context?: CanonicalTravelContext,
): Promise<PlaceResult[]> {
  const excluded = context?.excludedCategories ?? [];
  const attempts: SearchAttempt[] =
    intent === "restaurant"
      ? restaurantSearchFallbackQueries(foodPreference)
      : intent === "camping"
        ? campingSearchAttempts()
        : [searchConfigForIntent(intent, foodPreference, context)];

  let ranked: PlaceResult[] = [];
  for (const attempt of attempts) {
    const places = await runPlaceSearch(searchPlaces, lat, lng, locale, attempt);
    ranked = rankPlaces(places, lat, lng, context);
    ranked = filterPlacesByExclusion(ranked, excluded);
    if (intent === "camping") {
      ranked = filterCampingPlaces(ranked);
    }
    if (ranked.length > 0) break;
  }

  if (context?.budgetPreference === "low") {
    ranked = refinePlaceResultsForBudget(ranked, "low");
  }

  console.info(`[CHAT_PLACES_SUCCESS] count=${ranked.length} excluded=${excluded.length}`);
  return ranked;
}

export async function buildNearbyPlaceRecommendation(params: {
  intent: NearbyPlaceIntent;
  lat: number;
  lng: number;
  locale: Locale;
  context: CanonicalTravelContext;
  searchPlaces: PlaceSearchFn;
  foodPreference?: string;
  excludedCategories?: string[];
}): Promise<{ summary: string; payload: RoamiePayloadV2; recommendations: RoamieRecommendationItem[] }> {
  const flow = beginPlacesFlow("chat_once");
  try {
    const { intent, lat, lng, locale, context, searchPlaces, foodPreference, excludedCategories } =
      params;
    const excluded =
      excludedCategories ??
      context.excludedCategories ??
      [];
    const contextWithExclusion: CanonicalTravelContext = {
      ...context,
      excludedCategories: excluded,
    };
    const places = await fetchNearbyPlacesForIntent(
      intent,
      lat,
      lng,
      locale,
      searchPlaces,
      foodPreference,
      contextWithExclusion,
    );
    const picks = places.slice(0, RECOMMENDATION_COUNT);

    if (!picks.length) {
      if (excluded.length) {
        const summary = buildExclusionInsufficientSummary(
          excluded,
          intent === "cafe"
            ? "cafe"
            : intent === "restaurant"
              ? "restaurant"
              : intent === "camping"
                ? "attraction"
                : "attraction",
        );
        return { summary, payload: {
          version: 2,
          title: "Roamie 推薦",
          summary,
          moodTag: context.mood ?? "",
          recommendations: [],
          itinerary: [],
          generatedAt: new Date().toISOString(),
        }, recommendations: [] };
      }
      throw new Error("places_empty");
    }

    const recommendations: RoamieRecommendationItem[] = picks.map((p) => {
      const distM =
        p.lat != null && p.lng != null ? distanceMeters(lat, lng, p.lat, p.lng) : undefined;
      return mapPlaceResultToChatItem(p, {
        mood: context.mood,
        locale,
        distanceMeters: distM,
      });
    });

    const summary = buildSummary(intent, picks, context, excluded);
    const mode = chatResponseModeForIntent(intent);
    console.info(`[CHAT_RESPONSE] mode=${mode}`);

    const payload: RoamiePayloadV2 = {
      version: 2,
      title: "Roamie 推薦",
      summary,
      moodTag: context.mood ?? "",
      recommendations,
      itinerary: [],
      generatedAt: new Date().toISOString(),
    };

    return { summary, payload, recommendations };
  } finally {
    endPlacesFlow(flow);
  }
}
