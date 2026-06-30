import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import {
  logChatCafeResultGuard,
  logChatCategoryLock,
  logChatIntentResolved,
  logChatRenderMode,
  logChatRenderModeLocked,
  logChatRenderPlaceCardOnly,
  logChatPlaceCategory,
  logChatPlaceCardRender,
  logChatWrongCategoryRejected,
} from "@/lib/ai/chat-place-flow-log";

const CAFE_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "tea_house",
]);

const CAFE_NAME_RE =
  /(?:咖啡|珈琲|カフェ|café|cafe|coffee|espresso|roaster|roastery|焙茶)/i;

const COMBO_ITINERARY_NAME_RE =
  /(?:＋|\+|一日遊|半日遊|二日遊|三日遊|day\s*trip|itinerary)/i;

const COMBO_ITINERARY_QUERY_RE =
  /(?:怎麼玩|怎麼安排|怎麼排|排行程|安排行程|幫我排|幫我安排|一日遊|幾天幾夜|day\s*trip|itinerary|行程路線|路線怎麼排)/i;

const CATEGORY_ONLY_INTENTS = new Set<ChatPlaceCategoryIntent>([
  "cafe",
  "restaurant",
  "shopping",
  "night_market",
  "bar",
]);

export function isComboItineraryQuery(userText: string): boolean {
  return COMBO_ITINERARY_QUERY_RE.test(userText.trim());
}

export function shouldUseNamedMustVisitFallback(intent: ChatPlaceCategoryIntent): boolean {
  return intent === "attraction" || intent === "indoor";
}

export function resolveCategorySearchIntent(
  userText: string,
  intents: ChatPlaceCategoryIntent[],
): ChatPlaceCategoryIntent {
  const locked = intents[0] ?? "attraction";
  logChatIntentResolved("PLACE_RECOMMENDATION", userText.trim().slice(0, 80));
  logChatCategoryLock(locked);
  logChatPlaceCategory(locked);
  return locked;
}

export function isCafePlace(place: PlaceResult): boolean {
  const types = [
    (place.primaryType ?? "").trim().toLowerCase(),
    ...(place.types ?? []).map((t) => t.trim().toLowerCase()),
  ].filter(Boolean);

  if (types.some((t) => CAFE_TYPES.has(t))) return true;

  const name = (place.name ?? "").trim();
  const address = (place.address ?? "").trim();
  return CAFE_NAME_RE.test(name) || CAFE_NAME_RE.test(address);
}

export function filterPlacesByCafeGuard(places: PlaceResult[]): PlaceResult[] {
  return places.filter((place) => {
    const ok = isCafePlace(place);
    logChatCafeResultGuard(place.name ?? "unknown", ok, ok ? "ok" : "not_cafe");
    if (!ok) {
      logChatWrongCategoryRejected(place.name ?? "unknown", "not_cafe");
    }
    return ok;
  });
}

export function isComboItineraryRecommendation(item: RoamieRecommendationItem): boolean {
  const name = (item.placeName ?? item.name ?? "").trim();
  if (COMBO_ITINERARY_NAME_RE.test(name)) return true;
  if (!item.googlePlaceId?.trim()) {
    const type = (item.type ?? "").trim();
    if (type === "景點" || COMBO_ITINERARY_NAME_RE.test(item.description ?? "")) {
      return true;
    }
  }
  return false;
}

function placeCardId(item: RoamieRecommendationItem): string {
  const ext = item as RoamieRecommendationItem & { placeId?: string };
  return (item.googlePlaceId ?? ext.placeId ?? "").trim();
}

export function isRealPlaceCard(item: RoamieRecommendationItem): boolean {
  return Boolean(placeCardId(item));
}

export function passesCafeRenderGuard(item: RoamieRecommendationItem): boolean {
  if (isComboItineraryRecommendation(item)) {
    logChatCafeResultGuard(item.name ?? "unknown", false, "combo_itinerary");
    logChatWrongCategoryRejected(item.name ?? "unknown", "combo_itinerary");
    return false;
  }

  if (!isRealPlaceCard(item)) {
    logChatCafeResultGuard(item.name ?? "unknown", false, "missing_place_id");
    logChatWrongCategoryRejected(item.name ?? "unknown", "missing_place_id");
    return false;
  }

  const primary = (item.type ?? "").trim().toLowerCase();
  if (primary === "restaurant" || primary === "tourist_attraction") {
    logChatCafeResultGuard(item.name ?? "unknown", false, "wrong_category");
    logChatWrongCategoryRejected(item.name ?? "unknown", "wrong_category");
    return false;
  }

  const blob = `${item.name ?? ""} ${item.placeName ?? ""} ${item.type ?? ""} ${item.address ?? ""} ${item.description ?? ""}`;
  const ok = CAFE_NAME_RE.test(blob) || CAFE_TYPES.has(primary) || Boolean(placeCardId(item));
  logChatCafeResultGuard(item.name ?? "unknown", ok, ok ? "ok" : "not_cafe");
  if (!ok) {
    logChatWrongCategoryRejected(item.name ?? "unknown", "not_cafe");
  }
  return ok;
}

export function filterRecommendationsForCategoryRender(
  items: RoamieRecommendationItem[],
  intent: ChatPlaceCategoryIntent,
): RoamieRecommendationItem[] {
  logChatRenderMode("place_card_only");
  logChatRenderModeLocked("PLACE_CARDS_ONLY");
  logChatRenderPlaceCardOnly(intent);

  const filtered =
    intent === "cafe"
      ? items.filter(passesCafeRenderGuard)
      : CATEGORY_ONLY_INTENTS.has(intent)
        ? items.filter((item) => {
            if (isComboItineraryRecommendation(item)) {
              logChatWrongCategoryRejected(item.name ?? "unknown", "combo_itinerary");
              return false;
            }
            if (!isRealPlaceCard(item)) {
              logChatWrongCategoryRejected(item.name ?? "unknown", "missing_place_id");
              return false;
            }
            return true;
          })
        : items.filter((item) => !isComboItineraryRecommendation(item) || isRealPlaceCard(item));

  logChatPlaceCardRender(filtered.length, intent);
  return filtered;
}

/** 避免 title / description / reason 重複顯示 */
export function dedupeRecommendationCopy(
  item: RoamieRecommendationItem,
): RoamieRecommendationItem {
  const title = (item.placeName ?? item.name ?? "").trim();
  const description = (item.description ?? "").trim();
  const reason = (item.reason ?? "").trim();

  let nextDescription = description;
  let nextReason = reason;

  if (nextDescription && nextDescription === title) {
    nextDescription = item.address?.trim() || "";
  }
  if (nextReason && (nextReason === title || nextReason === nextDescription)) {
    nextReason = "";
  }
  if (nextDescription && nextReason && nextDescription === nextReason) {
    nextReason = "";
  }

  return {
    ...item,
    description: nextDescription,
    reason: nextReason,
  };
}

export { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
