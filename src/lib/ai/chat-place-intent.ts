import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { buildCafeSearchAttempts } from "@/lib/ai/chat-cafe-search";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  hasCategoryPlaceQuery,
  type ChatPlaceCategoryIntent,
} from "@/lib/ai/chat-place-category-types";
import {
  isDestinationCategoryPlaceRequest,
  resolveDestinationForCategorySearch,
} from "@/lib/ai/chat-category-destination";
import {
  logChatPlaceRecommendationTriggered,
  logChatWrongFallbackBlocked,
} from "@/lib/ai/chat-place-flow-log";
import { buildInitialShoppingSearchAttempts } from "@/lib/ai/shopping-query-queue";
import {
  parsePlaceRecommendationIntent,
  placeIntentToCategoryIntent,
  buildPlaceRecommendationQueries,
} from "@/lib/ai/place-recommendation-intent";
import { resolveRegionPrimaryCity } from "@/lib/ai/shopping-search-scope";
import {
  evaluateDestinationScopeGate,
  logDestinationScopeBlocked,
  logUnexpectedPlacesCall,
} from "@/lib/ai/destination-scope";
import {
  isCountryCityInquiryText,
  isFutureTripPlanningStatement,
} from "@/lib/ai/trip-planning-context";
import {
  extractProvisionalDestinationAreaCandidate,
  resolveDestinationAreaScope,
} from "@/lib/ai/destination-travel-profile";

export type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
export {
  isDestinationCategoryPlaceRequest,
  isPlaceCategoryRecommendationRequest,
  resolveDestinationForCategorySearch,
} from "@/lib/ai/chat-category-destination";

export const CHAT_PLACE_CATEGORY_LABELS: Record<ChatPlaceCategoryIntent, string> = {
  cafe: "咖啡廳",
  restaurant: "餐廳",
  shopping: "購物／商圈",
  attraction: "景點",
  night_market: "夜市",
  bar: "酒吧",
  indoor: "室內景點",
};

const CATEGORY_ORDER: ChatPlaceCategoryIntent[] = [
  "cafe",
  "restaurant",
  "shopping",
  "night_market",
  "bar",
  "indoor",
  "attraction",
];

const CATEGORY_PATTERNS: Record<ChatPlaceCategoryIntent, RegExp> = {
  cafe: /(咖啡廳|咖啡店|咖啡|café|cafe)/i,
  restaurant: /(餐廳|美食|吃飯|用餐|吃的地方|想吃|吃什麼|找吃的|想找餐廳|推薦餐廳|找餐廳|找美食|有推薦的餐廳|推薦.{0,6}吃)/,
  shopping:
    /(商圈|shopping|百貨|市集|購物|商場|mall|department\s*store|outlet|アウトレット|逛街|購物行程|購物中心|商店街)/i,
  attraction: /(景點|必去|必去景點|附近景點|去哪玩|推薦景點|好玩的|附近.*逛|美術館|博物館|museum|tourist)/i,
  night_market: /(夜市|market)/i,
  bar: /(酒吧|居酒屋|宵夜|夜生活)/,
  indoor: /(室內景點|雨天備案|下雨天|雨天|室內)/,
};

/** @deprecated 使用 hasCategoryPlaceQuery */
export function hasChatPlaceCategoryQuery(text: string): boolean {
  return hasCategoryPlaceQuery(text);
}

export function parseChatPlaceIntents(text: string): ChatPlaceCategoryIntent[] {
  const t = text.trim();
  if (!t) return [];

  const found: ChatPlaceCategoryIntent[] = [];
  for (const intent of CATEGORY_ORDER) {
    if (CATEGORY_PATTERNS[intent].test(t)) {
      found.push(intent);
    }
  }

  // Cuisine / feature NL (e.g.「有拉麵店推薦嗎」) without category keyword
  if (!found.length) {
    const parsed = parsePlaceRecommendationIntent(t);
    if (parsed) {
      found.push(placeIntentToCategoryIntent(parsed.primaryType));
    }
  }

  return found;
}

export function shouldFetchDestinationCategoryPlaces(
  userText: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (isFutureTripPlanningStatement(t) || isCountryCityInquiryText(t)) return false;
  if (!hasCategoryPlaceQuery(t)) return false;

  const destination = resolveDestinationForCategorySearch(ctx, session, t);
  const pendingGeographic = destination
    ? null
    : extractProvisionalDestinationAreaCandidate(t);
  if (!destination && !pendingGeographic) return false;

  if (
    /\d+\s*天/.test(t) &&
    /(?:安排|規劃|规划|行程|幫我排|帮我排)/.test(t) &&
    !/(咖啡|餐廳|商圈|夜市|酒吧|室內|景點|美食)/.test(t)
  ) {
    return false;
  }

  if (destination) {
    const scopeGate = evaluateDestinationScopeGate({
      destination,
      destinationType: ctx.destinationType,
      countryCode: ctx.destinationCountry,
      requestedIntent: "place_recommendation",
    });
    if (scopeGate.placesCallBlocked) {
      logDestinationScopeBlocked(scopeGate);
      logUnexpectedPlacesCall({
        trigger: "shouldFetchDestinationCategoryPlaces",
        intent: "place_recommendation",
        destinationType: scopeGate.destinationType,
        scopePrecision: scopeGate.scopePrecision,
        callPath: "chat-place-intent.shouldFetchDestinationCategoryPlaces",
      });
      return false;
    }
  }

  const intents = parseChatPlaceIntents(t);
  if (intents.length) {
    logChatPlaceRecommendationTriggered(
      destination ?? `pending:${pendingGeographic!.rawLabel}`,
      intents[0]!,
    );
  }

  return true;
}

/** 阻擋類別地點查詢 fallback 到行程規劃／偏好詢問 */
export function shouldBlockPlanningFallbackForCategoryQuery(
  userText: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  if (!isDestinationCategoryPlaceRequest(userText, ctx, session)) return false;
  logChatWrongFallbackBlocked("category_place_query");
  return true;
}

/**
 * Map category → nearby GPS intent.
 * Shopping is not a nearby GPS mode; callers must persist `activeCategoryIntent`
 * separately so「還有嗎」does not collapse shopping → attraction.
 */
export function mapCategoryIntentToNearbyIntent(
  intent: ChatPlaceCategoryIntent,
): "cafe" | "restaurant" | "attraction" {
  if (intent === "cafe") return "cafe";
  if (intent === "restaurant") return "restaurant";
  // Keep shopping/night_market/bar out of attraction-only nearby when possible —
  // activeCategoryIntent on session is the source of truth for continue.
  return "attraction";
}

export function buildChatPlaceSearchAttempts(
  intent: ChatPlaceCategoryIntent,
  destination: string,
  userText = "",
): { primary: SearchAttempt[]; fallback: SearchAttempt[] } {
  const areaScope = resolveDestinationAreaScope(destination);
  if (areaScope) {
    const areaAttempts = buildChatPlaceSearchAttemptsForScope(
      intent,
      areaScope.displayLabel,
      userText,
    );
    const cityAttempts = buildChatPlaceSearchAttemptsForScope(
      intent,
      areaScope.parentCity,
      userText,
    );
    return {
      primary: areaAttempts.primary,
      fallback: [...areaAttempts.fallback, ...cityAttempts.primary, ...cityAttempts.fallback],
    };
  }
  return buildChatPlaceSearchAttemptsForScope(intent, destination, userText);
}

export function buildChatPlaceSearchAttemptsForScope(
  intent: ChatPlaceCategoryIntent,
  destination: string,
  userText = "",
): { primary: SearchAttempt[]; fallback: SearchAttempt[] } {
  const parsed = userText.trim() ? parsePlaceRecommendationIntent(userText) : null;
  const searchCity = resolveRegionPrimaryCity(destination) ?? destination;

  // Prefer universal query builder when subtypes / features are present
  if (
    parsed &&
    (parsed.subtypes.length > 0 ||
      parsed.preferredFeatures.length > 0 ||
      parsed.indoorOnly ||
      (intent === "restaurant" && parsed.primaryType === "restaurant") ||
      (intent === "cafe" && parsed.primaryType === "cafe") ||
      (intent === "shopping" && parsed.primaryType === "shopping") ||
      (intent === "indoor" && (parsed.primaryType === "indoor" || parsed.indoorOnly)) ||
      (intent === "bar" && parsed.primaryType === "nightlife"))
  ) {
    const primaryType =
      intent === "bar"
        ? ("nightlife" as const)
        : intent === "night_market"
          ? ("attraction" as const)
          : intent === "indoor"
            ? ("indoor" as const)
            : intent === "cafe" ||
                intent === "restaurant" ||
                intent === "shopping" ||
                intent === "attraction"
              ? intent
              : parsed.primaryType;
    const built = buildPlaceRecommendationQueries({
      destination,
      resolvedSearchCity: searchCity,
      primaryType,
      subtypes: parsed.subtypes,
      preferredFeatures: parsed.preferredFeatures,
      excludedFeatures: parsed.excludedFeatures,
      mealSlot: parsed.mealSlot,
      budget: parsed.budget,
      atmosphere: parsed.atmosphere,
      indoorOnly: parsed.indoorOnly,
    });
    if (built.length) {
      const mid = Math.min(4, built.length);
      return {
        primary: built.slice(0, mid),
        fallback: built.slice(mid),
      };
    }
  }

  if (intent === "cafe") {
    return buildCafeSearchAttempts(destination);
  }

  switch (intent) {
    case "restaurant":
      return {
        primary: [
          {
            query: `${searchCity} restaurant`,
            mode: "text",
            includedTypes: ["restaurant", "food"],
          },
          {
            query: `${searchCity} 人氣餐廳`,
            mode: "text",
            includedTypes: ["restaurant", "food", "meal_takeaway"],
          },
          {
            query: `${searchCity} 美食 小吃`,
            mode: "text",
            includedTypes: ["restaurant", "food", "cafe", "bakery"],
          },
        ],
        fallback: [
          {
            query: `${searchCity} food dining`,
            mode: "text",
            includedTypes: ["restaurant", "food", "cafe"],
          },
          {
            query: `${searchCity} local restaurants`,
            mode: "text",
            includedTypes: ["restaurant", "meal_takeaway", "bakery"],
          },
        ],
      };
    case "shopping": {
      // Shopping Query Queue page 0 (+ page 1 as fallback) — see shopping-query-queue.ts
      const seeded = buildInitialShoppingSearchAttempts(destination, userText);
      return { primary: seeded.primary, fallback: seeded.fallback };
    }
    case "attraction":
      return {
        primary: [
          {
            query: `${destination} tourist attractions`,
            mode: "text",
            includedTypes: ["tourist_attraction"],
          },
          {
            query: `${destination} 必去景點`,
            mode: "text",
            includedTypes: ["tourist_attraction"],
          },
        ],
        fallback: [
          {
            query: `${destination} sightseeing`,
            mode: "text",
            includedTypes: ["tourist_attraction"],
          },
        ],
      };
    case "night_market":
      return {
        primary: [
          {
            query: `${destination} market`,
            mode: "text",
            includedTypes: ["tourist_attraction", "restaurant"],
          },
          {
            query: `${destination} 夜市 市集`,
            mode: "text",
            includedTypes: ["tourist_attraction", "restaurant"],
          },
        ],
        fallback: [
          {
            query: `${destination} night market`,
            mode: "text",
            includedTypes: ["tourist_attraction", "restaurant"],
          },
        ],
      };
    case "bar":
      return {
        primary: [
          {
            query: `${destination} 酒吧 居酒屋 宵夜`,
            mode: "text",
            includedTypes: ["bar", "restaurant"],
          },
        ],
        fallback: [
          {
            query: `${destination} bar`,
            mode: "text",
            includedTypes: ["bar", "restaurant"],
          },
        ],
      };
    case "indoor":
      return {
        primary: [
          {
            query: `${destination} indoor attractions`,
            mode: "text",
            includedTypes: ["museum", "art_gallery", "shopping_mall", "tourist_attraction"],
          },
          {
            query: `${destination} museum`,
            mode: "text",
            includedTypes: ["museum", "art_gallery"],
          },
          {
            query: `${destination} 美術館 博物館 室內景點`,
            mode: "text",
            includedTypes: ["museum", "art_gallery", "shopping_mall"],
          },
        ],
        fallback: [
          {
            query: `${destination} 雨天備案 室內`,
            mode: "text",
            includedTypes: ["museum", "shopping_mall", "tourist_attraction"],
          },
        ],
      };
    default:
      return { primary: [], fallback: [] };
  }
}

export function logChatPlaceIntent(intents: ChatPlaceCategoryIntent[], userText: string): void {
  logAiPipeline("[CHAT_PLACE_INTENT]", `intents=${intents.join(",")}`, `text=${userText.trim().slice(0, 80)}`);
}

export function logChatPlaceContext(ctx: {
  destination: string;
  days?: number;
  travelDate?: string;
  preferences?: string[];
}): void {
  logAiPipeline(
    "[CHAT_PLACE_CONTEXT]",
    `destination=${ctx.destination}`,
    ctx.days != null ? `days=${ctx.days}` : "",
    ctx.travelDate ? `date=${ctx.travelDate}` : "",
    ctx.preferences?.length ? `prefs=${ctx.preferences.join(",")}` : "",
  );
}

export function logChatPlaceQuery(intent: ChatPlaceCategoryIntent, query: string, fallback: boolean): void {
  logAiPipeline(
    "[CHAT_PLACE_QUERY]",
    `intent=${intent}`,
    `query=${query}`,
    `fallback=${fallback}`,
  );
}

export function logChatPlaceResults(intent: ChatPlaceCategoryIntent, count: number): void {
  logAiPipeline("[CHAT_PLACE_RESULTS]", `intent=${intent}`, `count=${count}`);
}

export function logChatPlaceFallback(intent: ChatPlaceCategoryIntent, query: string): void {
  logAiPipeline("[CHAT_PLACE_FALLBACK]", `intent=${intent}`, `query=${query}`);
}

export function logChatPlaceCardsRendered(count: number, intents: ChatPlaceCategoryIntent[]): void {
  logAiPipeline("[CHAT_PLACE_CARDS_RENDERED]", `count=${count}`, `intents=${intents.join(",")}`);
}
