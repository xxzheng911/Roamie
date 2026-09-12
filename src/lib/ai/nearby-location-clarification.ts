import { userExplicitlyWantsNearbyPlaces, type NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import { parsePlaceRecommendationIntent } from "@/lib/ai/place-recommendation-intent/parse";
import type { TripLocation } from "@/lib/location/types";

export const NEARBY_LOCATION_CLARIFICATION_COPY = "你是指哪個地區的呢？";
export const NEARBY_CLARIFICATION_CONTRACT_VERSION = "nearby-clarification-v2";

export type NearbySemanticFamily = "nightlife" | "cafe" | "food" | "attraction";

export type PendingNearbyLocationRequest = {
  intent: NearbyPlaceIntent;
  category: "restaurant" | "cafe" | "attraction";
  originalUserText: string;
  originalQuery: string;
  nearbyIntent: NearbyPlaceIntent;
  requestedScope: "nearby";
  originalAuthority: "nearby";
  originalSearchMode: "location_clarification";
  queryCategory: string;
  rawExplicitKeyword?: string;
  canonicalKeyword?: string;
  semanticFamily?: NearbySemanticFamily;
  subtype?: string;
  mealSlot?: "breakfast" | "lunch" | "dinner" | "late_night";
  createdAt: string;
};

export type ChatRouteAuthority = "nearby" | "destination_category" | "shortcut" | "other";

/**
 * Selects the single recommendation dispatcher for a chat turn.
 * Explicit Nearby wording and a pending Nearby location answer outrank the
 * destination-category route. A genuine destination-category request still
 * owns the turn when no Nearby scope was explicitly requested.
 */
export function resolveChatRouteAuthority(params: {
  structuredShortcut?: boolean;
  explicitNearbyRequest?: boolean;
  pendingNearbyLocationRequest?: boolean;
  resolvedNearbyIntent?: NearbyPlaceIntent | null;
  categoryPlaceQuery?: boolean;
}): ChatRouteAuthority {
  if (params.structuredShortcut) return "shortcut";
  if (params.pendingNearbyLocationRequest || params.explicitNearbyRequest) return "nearby";
  if (params.categoryPlaceQuery) return "destination_category";
  if (params.resolvedNearbyIntent) return "nearby";
  return "other";
}

/**
 * A resolved Nearby authority owns dispatch for the turn. The legacy fetch
 * eligibility remains authoritative for every non-Nearby route.
 */
export function shouldAllowNearbyDispatch(params: {
  selectedAuthority: ChatRouteAuthority;
  nearbyIntent?: NearbyPlaceIntent | null;
  legacyShouldFetch: boolean;
}): boolean {
  if (params.selectedAuthority === "nearby" && params.nearbyIntent != null) return true;
  return params.legacyShouldFetch;
}

export function createPendingNearbyLocationRequest(
  intent: NearbyPlaceIntent,
  originalUserText: string,
): PendingNearbyLocationRequest {
  const originalQuery = originalUserText.trim();
  const explicitNearby = resolveExplicitNearbyIntent(originalQuery);
  const authoritativeIntent = explicitNearby?.intent ?? intent;
  const semantics = resolveNearbyClarificationSemantics(originalQuery, authoritativeIntent);
  const rawExplicitKeyword = explicitNearby?.rawKeyword;
  const canonicalKeyword = explicitNearby?.canonicalKeyword;
  return {
    intent: authoritativeIntent,
    category:
      authoritativeIntent === "cafe"
        ? "cafe"
        : authoritativeIntent === "restaurant"
          ? "restaurant"
          : "attraction",
    originalUserText: originalQuery,
    originalQuery,
    nearbyIntent: authoritativeIntent,
    requestedScope: "nearby",
    originalAuthority: "nearby",
    originalSearchMode: "location_clarification",
    queryCategory: canonicalKeyword ?? semantics.categoryLabel,
    rawExplicitKeyword: rawExplicitKeyword ?? semantics.categoryLabel,
    canonicalKeyword: canonicalKeyword ?? semantics.categoryLabel,
    semanticFamily:
      explicitNearby?.semanticFamily ?? nearbySemanticFamilyForKeyword(semantics.categoryLabel),
    subtype: semantics.subtype,
    mealSlot: semantics.mealSlot,
    createdAt: new Date().toISOString(),
  };
}

export function extractExplicitNearbyKeyword(text: string): string | null {
  const normalized = text.trim().replace(/[？?!！。]+$/g, "");
  const marker = normalized.match(/(?:附近|這附近|这附近|我附近)/);
  if (!marker?.index && marker?.index !== 0) return null;
  const keyword = normalized
    .slice(marker.index + marker[0].length)
    .replace(/^(?:有沒有|有没有|有什麼|有什么|想找|找|的)\s*/, "")
    .replace(/\s*(?:推薦|推荐|呢|嗎|吗)$/i, "")
    .trim();
  return keyword &&
    !/^(?:適合去哪裡|适合去哪里|哪裡可以去|哪里可以去|有什麼地方|有什么地方|推薦一下|推荐一下|有什麼|有什么|走走|地方|地點|地点|景點|景点|還有|还有|還有嗎|还有吗|其他|別的|别的)$/.test(
      keyword,
    )
    ? keyword
    : null;
}

export function canonicalizeExplicitNearbyKeyword(keyword: string): string {
  const value = keyword.trim();
  if (/餐酒|bistro/i.test(value)) return "餐酒館";
  if (/居酒|izakaya/i.test(value)) return "居酒屋";
  if (/早餐|breakfast/i.test(value)) return "早餐店";
  if (/咖啡|coffee|cafe/i.test(value)) return "咖啡廳";
  if (/素食|蔬食|vegan|vegetarian/i.test(value)) return "素食餐廳";
  if (/酒吧|pub|bar/i.test(value)) return "酒吧";
  return value;
}

export function resolveExplicitNearbyIntent(text: string): {
  rawKeyword: string;
  canonicalKeyword: string;
  intent: NearbyPlaceIntent;
  semanticFamily: NearbySemanticFamily;
} | null {
  if (!userExplicitlyWantsNearbyPlaces(text)) return null;
  const rawKeyword = extractExplicitNearbyKeyword(text);
  if (!rawKeyword) return null;
  const canonicalKeyword = canonicalizeExplicitNearbyKeyword(rawKeyword);
  const intent: NearbyPlaceIntent = /咖啡|coffee|cafe/i.test(canonicalKeyword)
    ? "cafe"
    : /餐|食|酒|bar|pub|早餐|宵夜|拉麵|燒肉|火鍋|素食|蔬食/i.test(canonicalKeyword)
      ? "restaurant"
      : "attraction";
  return {
    rawKeyword,
    canonicalKeyword,
    intent,
    semanticFamily: nearbySemanticFamilyForKeyword(canonicalKeyword),
  };
}

export function nearbySemanticFamilyForKeyword(keyword: string): NearbySemanticFamily {
  if (/酒吧|居酒屋|餐酒館|pub|cocktail\s*bar|wine\s*bar|gastropub|izakaya|\bbar\b/i.test(keyword)) {
    return "nightlife";
  }
  if (/咖啡|coffee|cafe/i.test(keyword)) return "cafe";
  if (/餐|食|早餐|宵夜|拉麵|燒肉|火鍋|素食|蔬食/i.test(keyword)) return "food";
  return "attraction";
}

export function resolveNearbyClarificationSemantics(
  originalQuery: string,
  intent: NearbyPlaceIntent,
): {
  categoryLabel: string;
  subtype?: string;
  mealSlot?: "breakfast" | "lunch" | "dinner" | "late_night";
} {
  const parsed = parsePlaceRecommendationIntent(originalQuery);
  if (parsed?.mealSlot === "breakfast") {
    return { categoryLabel: "早餐店", subtype: "breakfast", mealSlot: "breakfast" };
  }
  if (parsed?.subtypes.includes("izakaya") || /居酒屋/.test(originalQuery)) {
    return { categoryLabel: "居酒屋", subtype: "izakaya", mealSlot: parsed?.mealSlot };
  }
  if (intent === "cafe") return { categoryLabel: "咖啡廳" };
  if (intent === "restaurant") return { categoryLabel: "餐廳", mealSlot: parsed?.mealSlot };
  return { categoryLabel: "景點" };
}

export function buildNearbyLocationClarificationCopy(
  originalQuery: string,
  intent: NearbyPlaceIntent,
): { categoryLabel: string; renderedCopy: string } {
  const categoryLabel = resolveNearbyClarificationSemantics(originalQuery, intent).categoryLabel;
  return { categoryLabel, renderedCopy: NEARBY_LOCATION_CLARIFICATION_COPY };
}

export function normalizeNearbyClarificationQuery(rawQuery: string): string {
  return rawQuery
    .normalize("NFKC")
    .replace(/[,，、；;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsableNearbyClarificationLocation(
  location: TripLocation | null | undefined,
): location is TripLocation {
  const displayLabel =
    location?.displayLabel?.trim() ||
    location?.formattedName?.trim() ||
    location?.address?.trim() ||
    location?.city?.trim();
  return Boolean(
    hasUsableNearbyCoordinates(location) &&
    displayLabel &&
    !location?.placeId?.startsWith("approx:") &&
    !location?.placeId?.startsWith("scope:"),
  );
}

export function hasUsableNearbyCoordinates(
  location:
    | {
        lat?: number | null;
        lng?: number | null;
      }
    | null
    | undefined,
): boolean {
  const lat = location?.lat;
  const lng = location?.lng;
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
  );
}

export function shouldResolveNearbyCurrentLocation(params: {
  userText: string;
  structuredShortcut?: boolean;
}): boolean {
  return params.structuredShortcut === true || userExplicitlyWantsNearbyPlaces(params.userText);
}
