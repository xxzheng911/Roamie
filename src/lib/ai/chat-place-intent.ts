import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { buildCafeSearchAttempts } from "@/lib/ai/chat-cafe-search";
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

export type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
export {
  isDestinationCategoryPlaceRequest,
  isPlaceCategoryRecommendationRequest,
  resolveDestinationForCategorySearch,
} from "@/lib/ai/chat-category-destination";

export const CHAT_PLACE_CATEGORY_LABELS: Record<ChatPlaceCategoryIntent, string> = {
  cafe: "咖啡廳",
  restaurant: "餐廳",
  shopping: "商圈",
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
  restaurant: /(餐廳|美食|吃飯|用餐|想找餐廳|推薦餐廳|找餐廳|找美食|有推薦的餐廳)/,
  shopping: /(商圈|shopping|百貨|市集|購物|商場|mall|department\s*store)/i,
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
  return found;
}

export function shouldFetchDestinationCategoryPlaces(
  userText: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (!hasCategoryPlaceQuery(t)) return false;

  const destination = resolveDestinationForCategorySearch(ctx, session, t);
  if (!destination) return false;

  if (
    /\d+\s*天/.test(t) &&
    /(?:安排|規劃|规划|行程|幫我排|帮我排)/.test(t) &&
    !/(咖啡|餐廳|商圈|夜市|酒吧|室內|景點|美食)/.test(t)
  ) {
    return false;
  }

  const intents = parseChatPlaceIntents(t);
  if (intents.length) {
    logChatPlaceRecommendationTriggered(destination, intents[0]!);
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

export function mapCategoryIntentToNearbyIntent(
  intent: ChatPlaceCategoryIntent,
): "cafe" | "restaurant" | "attraction" {
  if (intent === "cafe") return "cafe";
  if (intent === "restaurant") return "restaurant";
  return "attraction";
}

export function buildChatPlaceSearchAttempts(
  intent: ChatPlaceCategoryIntent,
  destination: string,
): { primary: SearchAttempt[]; fallback: SearchAttempt[] } {
  if (intent === "cafe") {
    return buildCafeSearchAttempts(destination);
  }

  switch (intent) {
    case "restaurant":
      return {
        primary: [
          {
            query: `${destination} restaurant`,
            mode: "text",
            includedTypes: ["restaurant"],
          },
          {
            query: `${destination} 人氣餐廳`,
            mode: "text",
            includedTypes: ["restaurant"],
          },
        ],
        fallback: [
          {
            query: `${destination} food dining`,
            mode: "text",
            includedTypes: ["restaurant"],
          },
          {
            query: `${destination} local restaurants`,
            mode: "text",
            includedTypes: ["restaurant"],
          },
        ],
      };
    case "shopping":
      return {
        primary: [
          {
            query: `${destination} shopping district`,
            mode: "text",
            includedTypes: ["shopping_mall", "department_store", "tourist_attraction"],
          },
          {
            query: `${destination} 商圈`,
            mode: "text",
            includedTypes: ["shopping_mall", "department_store", "tourist_attraction"],
          },
        ],
        fallback: [
          {
            query: `${destination} department store`,
            mode: "text",
            includedTypes: ["department_store", "shopping_mall"],
          },
          {
            query: `${destination} 百貨`,
            mode: "text",
            includedTypes: ["department_store", "shopping_mall"],
          },
        ],
      };
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
  console.info("[CHAT_PLACE_INTENT]", `intents=${intents.join(",")}`, `text=${userText.trim().slice(0, 80)}`);
}

export function logChatPlaceContext(ctx: {
  destination: string;
  days?: number;
  travelDate?: string;
  preferences?: string[];
}): void {
  console.info(
    "[CHAT_PLACE_CONTEXT]",
    `destination=${ctx.destination}`,
    ctx.days != null ? `days=${ctx.days}` : "",
    ctx.travelDate ? `date=${ctx.travelDate}` : "",
    ctx.preferences?.length ? `prefs=${ctx.preferences.join(",")}` : "",
  );
}

export function logChatPlaceQuery(intent: ChatPlaceCategoryIntent, query: string, fallback: boolean): void {
  console.info(
    "[CHAT_PLACE_QUERY]",
    `intent=${intent}`,
    `query=${query}`,
    `fallback=${fallback}`,
  );
}

export function logChatPlaceResults(intent: ChatPlaceCategoryIntent, count: number): void {
  console.info("[CHAT_PLACE_RESULTS]", `intent=${intent}`, `count=${count}`);
}

export function logChatPlaceFallback(intent: ChatPlaceCategoryIntent, query: string): void {
  console.info("[CHAT_PLACE_FALLBACK]", `intent=${intent}`, `query=${query}`);
}

export function logChatPlaceCardsRendered(count: number, intents: ChatPlaceCategoryIntent[]): void {
  console.info("[CHAT_PLACE_CARDS_RENDERED]", `count=${count}`, `intents=${intents.join(",")}`);
}
