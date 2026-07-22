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
import {
  evaluateFoodPlace,
  FOOD_DISTRICT_CARD_TYPE,
  isFoodIntentText,
} from "@/lib/ai/chat-food-filter";
import { logShoppingCategoryRejected } from "@/lib/ai/shopping-query-queue";

const CAFE_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "tea_house",
]);

const CAFE_NAME_RE =
  /(?:咖啡|珈琲|カフェ|café|cafe|coffee|espresso|roaster|roastery|焙茶)/i;

/**
 * Shopping Type Alias Mapping — accept by alias / substring metadata,
 * not only exact Google type strings.
 */
const SHOPPING_TYPE_ALIASES = new Set([
  "shopping_mall",
  "shopping_center",
  "department_store",
  "store",
  "clothing_store",
  "shoe_store",
  "book_store",
  "jewelry_store",
  "electronics_store",
  "home_goods_store",
  "furniture_store",
  "gift_shop",
  "shopping_street",
  "outlet",
  "outlet_store",
  "outlet_mall",
  "commercial_complex",
  "retail",
  "retail_complex",
  "underground_mall",
  "fashion_building",
  "specialty_store_cluster",
  "market",
  "flea_market",
  "shopping_district",
]);

/** Non-retail *\_store types that must not count as shopping */
const NON_RETAIL_STORE_TYPES = new Set([
  "auto_parts_store",
  "bicycle_store",
  "car_dealer",
  "motorcycle_dealer",
  "hardware_store",
  "liquor_store",
  "pet_store",
  "drugstore",
  "pharmacy",
  "cell_phone_store",
  "warehouse_store",
]);

/** Supermarket / convenience — only when user explicitly asks */
const SUPERMARKET_TYPES = new Set([
  "supermarket",
  "grocery_store",
  "convenience_store",
]);

const SUPERMARKET_USER_RE = /超市|便利店|便利商店|grocery|supermarket|convenience\s*store/i;

/** Hard exclusions for Shopping Intent (scenic / dining / transit) */
const SHOPPING_FORBIDDEN_TYPES = new Set([
  "observation_deck",
  "park",
  "garden",
  "museum",
  "art_gallery",
  "cafe",
  "coffee_shop",
  "restaurant",
  "bakery",
  "bar",
  "night_club",
  "shrine",
  "hindu_temple",
  "buddhist_temple",
  "church",
  "place_of_worship",
  "zoo",
  "aquarium",
  "amusement_park",
  "theme_park",
  "natural_feature",
  "lodging",
  "hotel",
  "train_station",
  "subway_station",
  "transit_station",
  "parking",
  "parking_garage",
  "corporate_office",
  "office",
  "monument",
  "scenic_viewpoint",
]);

/**
 * Primary types that are usually non-shopping — still allow when shopping
 * alias / name evidence exists (e.g. 商店街 tagged tourist_attraction).
 */
const SHOPPING_SOFT_FORBIDDEN_PRIMARY = new Set([
  "tourist_attraction",
  "landmark",
  "point_of_interest",
  "establishment",
]);

/**
 * Strong shopping name / brand tokens on the place itself.
 * Do NOT treat mall/underground address co-location as entity evidence
 * (e.g. PRONTO inside Pole Town is still a cafe).
 */
const STRONG_SHOPPING_NAME_RE =
  /(?:商店街|百貨|百貨店|百貨公司|outlet|アウトレット|商場|購物中心|地下街|地下歩行|市集|市場|デパート|ショッピングモール|ショッピング|モール|複合商業|商業施設|ファッションビル|department\s*store|shopping\s*(?:mall|street|district|center)|underground\s*(?:mall|shopping)|retail\s*complex|parco|大丸|三越|高島屋|伊勢丹|松坂屋|東急|そごう|sogo|loft|plaza|\bmall\b|狸小路|ステラプレイス|sapporo\s*factory|grandberry|イオン|aeon|lalaport|ららぽーと|3coins|スリーコインズ|無印|muji|daiso|ダイソー|seria|ワッツ|francfranc|ハンズ|tokyu\s*hands)/i;

/** Mild shopping facility tokens — enough when primary is establishment/POI + shopping intent */
const MILD_SHOPPING_FACILITY_RE =
  /(?:モール|ショッピング|商場|百貨|商店街|地下街|商業施設|市場|plaza|mall|market|department|shopping)/i;

/** Address-only location hints — never sufficient alone for shopping accept */
const ADDRESS_LOCATION_HINT_RE =
  /(?:地下街|underground|ポールタウン|pole\s*town|apia|apia\b|ショッピングモール|shopping\s*mall|駅ビル|station\s*building)/i;

/** Dining / lodging primaries that must not pass via co-located store tags */
const SHOPPING_DINING_HARD_PRIMARY = new Set([
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "bakery",
  "meal_takeaway",
  "food",
  "night_club",
]);

/** Scenic / non-shopping names — reject unless strong shopping type also present */
const SHOPPING_FORBIDDEN_NAME_RE =
  /(?:展望|觀景台|観景|公園|花園|博物|美術館|神社|寺廟|寺$|神宮|飯店|ホテル|hotel|車站|駅$|停車場|オフィス|事務所|咖啡|珈琲|カフェ|café|\bcafe\b|observation|museum|shrine|temple|\bpark\b|\bgarden\b|sky\b|skytree|晴空塔|東京塔|tokyo\s*tower|入口拱門|拱門|arch\b|viewpoint|御苑|皇居|都廳|庁舍)/i;

/** Export alias set for verify / docs */
export const SHOPPING_TYPE_ALIAS_LIST = [...SHOPPING_TYPE_ALIASES];

/**
 * Map a Google place type string to a shopping alias, or null if not shopping.
 */
export function resolveShoppingTypeAlias(type: string): string | null {
  const t = type.trim().toLowerCase().replace(/\s+/g, "_");
  if (!t) return null;
  if (SUPERMARKET_TYPES.has(t) || NON_RETAIL_STORE_TYPES.has(t)) return null;
  if (SHOPPING_TYPE_ALIASES.has(t)) return t;

  if (t.includes("shopping_mall") || t.includes("shopping_center")) return "shopping_mall";
  if (t.includes("department_store")) return "department_store";
  if (t.includes("outlet")) return "outlet_mall";
  if (t.includes("underground") && (t.includes("mall") || t.includes("shop"))) {
    return "underground_mall";
  }
  if (t.includes("commercial") || t.includes("retail_complex")) return "commercial_complex";
  if (t.includes("fashion")) return "fashion_building";
  if (t.includes("home_goods")) return "home_goods_store";
  if (t.includes("clothing")) return "clothing_store";
  if (t.includes("gift")) return "gift_shop";
  if (t.includes("shopping_street") || t.includes("shopping_district")) {
    return "shopping_street";
  }
  if (t === "retail" || t.endsWith("_retail")) return "retail";
  // Bare / specialty store — accept as shopping retail (not auto/hardware/etc.)
  if (t === "store" || (t.endsWith("_store") && !NON_RETAIL_STORE_TYPES.has(t))) {
    return t === "store" ? "store" : t;
  }
  return null;
}

/** Aliases strong enough to override scenic / forbidden names */
const STRONG_SHOPPING_ALIASES = new Set([
  "shopping_mall",
  "shopping_center",
  "department_store",
  "outlet",
  "outlet_store",
  "outlet_mall",
  "commercial_complex",
  "retail_complex",
  "underground_mall",
  "fashion_building",
  "shopping_street",
  "shopping_district",
  "specialty_store_cluster",
  "market",
  "flea_market",
]);

function shoppingAliasesFor(types: string[]): string[] {
  const out: string[] = [];
  for (const t of types) {
    const alias = resolveShoppingTypeAlias(t);
    if (alias) out.push(alias);
  }
  return out;
}

function hasShoppingTypeAlias(types: string[]): boolean {
  return shoppingAliasesFor(types).length > 0;
}

function hasStrongShoppingAlias(types: string[]): boolean {
  return shoppingAliasesFor(types).some((a) => STRONG_SHOPPING_ALIASES.has(a));
}

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

function placeTypeList(place: {
  primaryType?: string | null;
  types?: string[] | null;
  type?: string | null;
}): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? place.type ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

export type ShoppingPlaceLike = {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  type?: string | null;
  types?: string[] | null;
};

function rejectShopping(
  place: ShoppingPlaceLike,
  reason: string,
): false {
  const primary = (place.primaryType ?? place.type ?? "").trim().toLowerCase();
  const name = (place.name ?? "").trim() || "unknown";
  logShoppingCategoryRejected({
    name,
    primaryType: primary,
    normalizedCategory: "not_shopping",
    reason,
  });
  logChatWrongCategoryRejected(name, reason);
  return false;
}

/**
 * Shopping Category Gate — accept shopping-purpose types/names via alias mapping.
 * Primary entity must be retail; address-in-mall / co-located store tags are not enough.
 */
export function isShoppingPlace(place: ShoppingPlaceLike, userText = ""): boolean {
  const types = placeTypeList(place);
  const primary = (place.primaryType ?? place.type ?? "").trim().toLowerCase();
  const name = (place.name ?? "").trim();
  const address = (place.address ?? "").trim();
  const nameBlob = name;
  const blob = `${name} ${address}`;
  const allowSupermarket = SUPERMARKET_USER_RE.test(userText);
  const shoppingType = hasShoppingTypeAlias(types);
  const primaryShoppingAlias = primary ? resolveShoppingTypeAlias(primary) : null;
  const strongNameOnPlace = STRONG_SHOPPING_NAME_RE.test(nameBlob);
  const strongName = strongNameOnPlace || STRONG_SHOPPING_NAME_RE.test(blob);
  const addressOnlyHint =
    ADDRESS_LOCATION_HINT_RE.test(address) && !strongNameOnPlace;
  const forbiddenName = SHOPPING_FORBIDDEN_NAME_RE.test(nameBlob);
  const hardForbiddenType = types.some((t) => SHOPPING_FORBIDDEN_TYPES.has(t));
  const hardForbiddenPrimary =
    Boolean(primary) &&
    SHOPPING_FORBIDDEN_TYPES.has(primary) &&
    !SHOPPING_SOFT_FORBIDDEN_PRIMARY.has(primary);
  const diningPrimary =
    Boolean(primary) && SHOPPING_DINING_HARD_PRIMARY.has(primary);
  const strongRetailEvidence =
    hasStrongShoppingAlias(types) ||
    (primaryShoppingAlias != null && STRONG_SHOPPING_ALIASES.has(primaryShoppingAlias));

  if (
    types.some((t) => SUPERMARKET_TYPES.has(t)) &&
    !shoppingType &&
    !allowSupermarket
  ) {
    return rejectShopping(place, "supermarket_without_request");
  }

  // Cafe / restaurant / bakery / bar: reject unless primary itself is retail
  // or types include a strong retail alias (not bare "store" co-location).
  if (diningPrimary) {
    if (primaryShoppingAlias && STRONG_SHOPPING_ALIASES.has(primaryShoppingAlias)) {
      // primary is somehow retail — allow
    } else if (!strongRetailEvidence) {
      return rejectShopping(place, `dining_primary:${primary}`);
    }
  }

  // Hotel / lodging primary — never accept via address-in-mall
  if (primary === "lodging" || primary === "hotel") {
    if (!strongRetailEvidence) {
      return rejectShopping(place, `forbidden_primary:${primary}`);
    }
  }

  // Pure scenic primary with no shopping alias or shopping name on the place
  if (hardForbiddenPrimary && !shoppingType && !strongNameOnPlace) {
    return rejectShopping(place, `forbidden_primary:${primary}`);
  }

  // Hard-forbidden types (park/restaurant/…) without shopping alias evidence
  if (hardForbiddenType && !shoppingType && !primaryShoppingAlias) {
    // tourist_attraction + shopping name (商店街 / 地下街) is OK
    if (!(strongNameOnPlace && SHOPPING_SOFT_FORBIDDEN_PRIMARY.has(primary))) {
      return rejectShopping(place, "forbidden_type");
    }
  }

  // Forbidden scenic names — only strong shopping aliases may override
  if (forbiddenName && !hasStrongShoppingAlias(types)) {
    return rejectShopping(place, "forbidden_name");
  }

  // Address-in-mall alone must not accept non-retail entities
  if (addressOnlyHint && !primaryShoppingAlias && !strongNameOnPlace && !strongRetailEvidence) {
    return rejectShopping(place, "address_location_only");
  }

  if (primaryShoppingAlias && STRONG_SHOPPING_ALIASES.has(primaryShoppingAlias)) {
    return true;
  }
  if (primaryShoppingAlias === "store" || primaryShoppingAlias === "clothing_store" ||
      primaryShoppingAlias === "shoe_store" || primaryShoppingAlias === "gift_shop" ||
      primaryShoppingAlias === "home_goods_store" || primaryShoppingAlias === "book_store" ||
      primaryShoppingAlias === "jewelry_store" || primaryShoppingAlias === "electronics_store" ||
      primaryShoppingAlias === "furniture_store" || primaryShoppingAlias === "retail") {
    return true;
  }

  // Non-dining: shopping type aliases OK
  if (!diningPrimary && (shoppingType || primaryShoppingAlias)) return true;

  if (allowSupermarket && types.some((t) => SUPERMARKET_TYPES.has(t))) return true;

  // Name-only path: shopping brands / mall / street tokens on the place name
  if (strongNameOnPlace && !forbiddenName) return true;

  // Shopping intent + generic Google types (establishment / POI / store):
  // accept when the place name/address supports a shopping facility.
  // Do NOT reject solely for weak Google typing when facility evidence exists.
  const weakGenericPrimary =
    !primary ||
    primary === "establishment" ||
    primary === "point_of_interest" ||
    primary === "store";
  const hasStoreType = types.some(
    (t) => t === "store" || resolveShoppingTypeAlias(t) === "store",
  );
  if (
    !diningPrimary &&
    !hardForbiddenPrimary &&
    !forbiddenName &&
    weakGenericPrimary &&
    (MILD_SHOPPING_FACILITY_RE.test(nameBlob) ||
      (hasStoreType && MILD_SHOPPING_FACILITY_RE.test(blob)) ||
      (hasStoreType && strongName))
  ) {
    return true;
  }

  // tourist_attraction + strong shopping name already handled above; avoid
  // accepting via address blob alone.
  if (strongName && !strongNameOnPlace && !strongRetailEvidence) {
    return rejectShopping(place, "address_shopping_hint_only");
  }

  return rejectShopping(place, "not_shopping");
}

export function filterPlacesByShoppingGuard(
  places: PlaceResult[],
  userText = "",
): PlaceResult[] {
  return places.filter((place) => isShoppingPlace(place, userText));
}

export function passesShoppingRenderGuard(
  item: RoamieRecommendationItem,
  userText = "",
): boolean {
  if (isComboItineraryRecommendation(item)) {
    logChatWrongCategoryRejected(item.name ?? "unknown", "combo_itinerary");
    return false;
  }
  if (!isRealPlaceCard(item)) {
    logChatWrongCategoryRejected(item.name ?? "unknown", "missing_place_id");
    return false;
  }

  const ext = item as RoamieRecommendationItem & { types?: string[] | null };
  return isShoppingPlace(
    {
      name: item.placeName ?? item.name ?? "",
      address: item.address ?? "",
      primaryType: item.type,
      types: ext.types?.length ? ext.types : item.type ? [item.type] : [],
    },
    userText,
  );
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

export function passesRestaurantRenderGuard(
  item: RoamieRecommendationItem,
  userText = "",
): boolean {
  if (isComboItineraryRecommendation(item)) {
    logChatWrongCategoryRejected(item.name ?? "unknown", "combo_itinerary");
    return false;
  }
  if (!isRealPlaceCard(item)) {
    logChatWrongCategoryRejected(item.name ?? "unknown", "missing_place_id");
    return false;
  }

  const verdict = evaluateFoodPlace(
    {
      name: item.placeName ?? item.name,
      address: item.address,
      primaryType: item.type,
      types: item.type ? [item.type] : [],
    },
    userText,
  );

  if (verdict.isDistrict) {
    return item.type === FOOD_DISTRICT_CARD_TYPE;
  }

  if (!verdict.allowed) {
    logChatWrongCategoryRejected(item.name ?? "unknown", verdict.reason);
    return false;
  }
  return true;
}

export function filterRecommendationsForCategoryRender(
  items: RoamieRecommendationItem[],
  intent: ChatPlaceCategoryIntent,
  userText = "",
): RoamieRecommendationItem[] {
  logChatRenderMode("place_card_only");
  logChatRenderModeLocked("PLACE_CARDS_ONLY");
  logChatRenderPlaceCardOnly(intent);

  const filtered =
    intent === "cafe"
      ? items.filter(passesCafeRenderGuard)
      : intent === "shopping"
        ? items.filter((item) => passesShoppingRenderGuard(item, userText))
        : intent === "restaurant" || isFoodIntentText(userText)
          ? items.filter((item) => passesRestaurantRenderGuard(item, userText))
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
