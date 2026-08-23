import type { PlaceOpenStatus } from "@/lib/filter-available-places";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { isLodgingPlace } from "@/lib/lodging-place-filter";
import { isLowValueCityExplorePlace } from "@/lib/explore-city-tourist-filter";
import { recommendationTypeMetadataFromItem } from "@/lib/ai/recommendation-place-type-metadata";

export type RecommendablePlaceContext =
  | "home_nearby"
  | "explore_map"
  | "explore_map_city"
  | "ai_recommend"
  | "plan_trip"
  | "chat_destination_recommend"
  | "chat_nearby"
  | "nearby_home";

export type RecommendablePlaceInput = {
  id?: string | null;
  placeId?: string | null;
  name?: string | null;
  businessStatus?: string | null;
  openStatus?: PlaceOpenStatus | null;
  openNow?: boolean | null;
  rating?: number | null;
  userRatingCount?: number | null;
  primaryType?: string | null;
  types?: string[] | null;
  categoryId?: string | null;
  isSavedFavorite?: boolean;
  explicitConvenienceSearch?: boolean;
};

export type RecommendablePlaceResult = {
  ok: boolean;
  reason?: string;
};

const CLOSED_NAME_RE =
  /永久停業|永久歇業|已歇業|已停業|停業中|closed permanently|permanently closed|closed down|已關閉|廢業|不再營業|結束營業/i;

const NIGHT_MARKET_NAME_RE =
  /夜市|市集|商圈|觀光商場|傳統市場|菜市場|night\s*market|bazaar|flea\s*market/i;

const ADDRESS_LIKE_NAME_RE =
  /^[\d\s\-]+(?:號|弄|巷|街|路|段)?$|^\d+$|^台灣\d|^Taiwan,?\s*\d/i;

const FOOD_TYPE_RE =
  /^(restaurant|food|meal_takeaway|meal_delivery|food_store|fast_food_restaurant|cafe|coffee_shop|bakery|ice_cream_shop|bar|pub|night_club)$/;

const TRAVEL_FRIENDLY_NAME_RE =
  /咖啡|餐廳|餐館|食堂|小吃|甜點|蛋糕|烘焙|書店|書局|文創|藝廊|展覽|酒吧|居酒|拉麵|壽司|火鍋|燒肉|早午餐|brunch|cafe|bistro|gallery|museum|park|夜市|市集|商圈/i;

const EXCLUDED_NAME_RE =
  /汽車|機車|摩托|濾網|零件|專賣|維修|保修|五金|補習|診所|醫院|牙科|停車場|加油站|有限公司|股份有限|企業社|工廠|倉儲|物流|補習班|幼兒園|托育|教堂|寺廟|墓園|當鋪|典當/i;

const TRAVEL_FRIENDLY_TYPES = new Set([
  "cafe",
  "coffee_shop",
  "bakery",
  "restaurant",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "food_store",
  "fast_food_restaurant",
  "ice_cream_shop",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "shopping_mall",
  "department_store",
  "market",
  "flea_market",
  "bar",
  "wine_bar",
  "night_club",
  "pub",
  "performing_arts_theater",
  "movie_theater",
  "book_store",
  "bookstore",
  "plaza",
  "town_square",
]);

const SCHOOL_OFFICE_TYPES = new Set([
  "school",
  "secondary_school",
  "primary_school",
  "university",
  "preschool",
  "corporate_office",
  "office",
]);

const NON_RECOMMENDABLE_TYPES = new Set([
  "route",
  "street_address",
  "intersection",
  "premise",
  "subpremise",
  "political",
  "locality",
  "administrative_area",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "neighborhood",
  "sublocality",
  "postal_code",
  "plus_code",
  "parking",
  "gas_station",
  "atm",
  "bank",
  "real_estate_agency",
  "insurance_agency",
  "storage",
  "car_repair",
  "car_dealer",
]);

const PURE_GEOGRAPHIC_TYPES = new Set([
  "route",
  "street_address",
  "intersection",
  "political",
  "locality",
  "administrative_area",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "neighborhood",
  "sublocality",
  "postal_code",
  "plus_code",
]);

const MAP_MARKER_NAME_RE =
  /路口$|街口$|巷口$|交叉口|(?:夜市|商圈|市場|車道|停車場)入口|入口廣場|地圖標記/i;

const NIGHT_MARKET_TYPES = new Set([
  "market",
  "flea_market",
  "shopping_mall",
  "department_store",
  "plaza",
  "tourist_attraction",
]);

const GENERAL_MIN_RATING = 4.3;
const HOME_GENERAL_MIN_RATING = 4.0;
const FOOD_MIN_RATING = 4.5;
const GENERAL_MIN_REVIEWS = 30;
const FOOD_MIN_REVIEWS = 80;
const NIGHT_MARKET_MIN_REVIEWS = 50;
const CITY_GENERAL_MIN_RATING = 3.8;
const CITY_FOOD_MIN_RATING = 4.0;
const CITY_GENERAL_MIN_REVIEWS = 10;
const CITY_FOOD_MIN_REVIEWS = 20;
const CITY_LANDMARK_MIN_REVIEWS = 5;

function normalizeType(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase();
}

function normalizeBiz(status: string | null | undefined): string {
  return (status ?? "").trim().toUpperCase();
}

function allTypes(place: RecommendablePlaceInput): string[] {
  const out = new Set<string>();
  const primary = normalizeType(place.primaryType);
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = normalizeType(t);
    if (n) out.add(n);
  }
  return [...out];
}

function resolvePlaceId(place: RecommendablePlaceInput): string {
  return (place.placeId ?? place.id ?? "").trim();
}

export function resolveOpenNow(place: RecommendablePlaceInput): boolean | null {
  if (place.openNow === true) return true;
  if (place.openNow === false) return false;
  switch (place.openStatus) {
    case "open":
    case "closing_soon":
      return true;
    case "closed_now":
    case "permanently_closed":
    case "temporarily_closed":
      return false;
    default:
      return null;
  }
}

function isFoodPlace(place: RecommendablePlaceInput): boolean {
  if (place.categoryId === "food") return true;
  return allTypes(place).some((t) => FOOD_TYPE_RE.test(t));
}

function isSchoolOrOfficeType(place: RecommendablePlaceInput): boolean {
  const types = allTypes(place);
  if (types.some((t) => SCHOOL_OFFICE_TYPES.has(t))) return true;
  const name = (place.name ?? "").trim();
  return /(小學|國中|高中|職校|補習|幼兒園|大學|学院|學院|公司|企業|工廠)/.test(name);
}

function isNightMarketStyle(place: RecommendablePlaceInput): boolean {
  const name = (place.name ?? "").trim();
  if (NIGHT_MARKET_NAME_RE.test(name)) return true;
  return allTypes(place).some((t) => NIGHT_MARKET_TYPES.has(t));
}

function hasExplicitCategory(place: RecommendablePlaceInput): boolean {
  return allTypes(place).length > 0;
}

function isAddressLikeMarker(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return true;
  if (ADDRESS_LIKE_NAME_RE.test(n)) return true;
  if (MAP_MARKER_NAME_RE.test(n)) return true;
  return false;
}

function isCityPopularCandidate(place: RecommendablePlaceInput): boolean {
  const name = (place.name ?? "").trim();
  const reviewCount = place.userRatingCount ?? 0;
  if (reviewCount >= CITY_LANDMARK_MIN_REVIEWS) return true;
  if (TRAVEL_FRIENDLY_NAME_RE.test(name) || isNightMarketStyle(place)) return true;
  return allTypes(place).some((t) => TRAVEL_FRIENDLY_TYPES.has(t));
}

function isPureGeographicMarker(place: RecommendablePlaceInput): boolean {
  const types = allTypes(place);
  if (types.length === 0) return false;

  const hasBusinessType = types.some(
    (t) => TRAVEL_FRIENDLY_TYPES.has(t) || FOOD_TYPE_RE.test(t),
  );
  if (hasBusinessType) return false;

  // Bare point_of_interest / establishment (common Places payloads) are NOT
  // geographic markers — require at least one pure geo admin type.
  const hasPureGeo = types.some((t) => PURE_GEOGRAPHIC_TYPES.has(t));
  if (!hasPureGeo) return false;

  const onlyGeographic = types.every(
    (t) =>
      PURE_GEOGRAPHIC_TYPES.has(t) ||
      NON_RECOMMENDABLE_TYPES.has(t) ||
      t === "point_of_interest" ||
      t === "establishment",
  );
  if (!onlyGeographic) return false;

  const name = (place.name ?? "").trim();
  if (TRAVEL_FRIENDLY_NAME_RE.test(name) || isNightMarketStyle(place)) return false;
  return true;
}

function passesTravelFriendlyGate(place: RecommendablePlaceInput): boolean {
  const name = (place.name ?? "").trim();
  const types = allTypes(place);
  if (name && EXCLUDED_NAME_RE.test(name)) return false;
  if (types.some((t) => TRAVEL_FRIENDLY_TYPES.has(t))) return true;
  if (types.some((t) => NIGHT_MARKET_TYPES.has(t))) return true;
  if (
    types.some((t) => t === "store" || t === "point_of_interest" || t === "establishment") &&
    TRAVEL_FRIENDLY_NAME_RE.test(name)
  ) {
    return true;
  }
  return TRAVEL_FRIENDLY_NAME_RE.test(name);
}

function minRatingFor(place: RecommendablePlaceInput, context: RecommendablePlaceContext): number {
  if (context === "explore_map_city") {
    return isFoodPlace(place) ? CITY_FOOD_MIN_RATING : CITY_GENERAL_MIN_RATING;
  }
  if (context === "home_nearby") {
    return isFoodPlace(place) ? FOOD_MIN_RATING : HOME_GENERAL_MIN_RATING;
  }
  return isFoodPlace(place) ? FOOD_MIN_RATING : GENERAL_MIN_RATING;
}

function minReviewsFor(place: RecommendablePlaceInput, context: RecommendablePlaceContext): number {
  if (context === "explore_map_city") {
    if (isFoodPlace(place)) return CITY_FOOD_MIN_REVIEWS;
    const types = allTypes(place);
    if (
      types.some((t) =>
        ["tourist_attraction", "museum", "park", "historical_landmark", "monument"].includes(t),
      )
    ) {
      return CITY_LANDMARK_MIN_REVIEWS;
    }
    if (isNightMarketStyle(place)) return CITY_LANDMARK_MIN_REVIEWS;
    return CITY_GENERAL_MIN_REVIEWS;
  }
  if (isFoodPlace(place)) return FOOD_MIN_REVIEWS;
  if (isNightMarketStyle(place)) return NIGHT_MARKET_MIN_REVIEWS;
  return GENERAL_MIN_REVIEWS;
}

const loggedFilterDropKeys = new Set<string>();

export function logPlaceRecommendFilterDrop(
  place: RecommendablePlaceInput,
  dropReason: string,
  context?: RecommendablePlaceContext,
): void {
  const dropKey = `${resolvePlaceId(place) || place.name}:${dropReason}:${context ?? ""}`;
  if (loggedFilterDropKeys.has(dropKey)) return;
  loggedFilterDropKeys.add(dropKey);
  console.info("[PLACE_RECOMMEND_FILTER_DROP]", {
    name: place.name ?? "",
    placeId: resolvePlaceId(place) || null,
    businessStatus: place.businessStatus ?? null,
    openNow: resolveOpenNow(place),
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    types: allTypes(place),
    dropReason,
    context: context ?? null,
  });
  if (context === "explore_map" || context === "explore_map_city") {
    console.info(`[EXPLORE_FILTER_DROP] name=${place.name ?? ""} reason=${dropReason}`);
  }
}

export function isRecommendablePlace(
  place: RecommendablePlaceInput,
  context: RecommendablePlaceContext = "explore_map",
  options?: {
    logDrop?: boolean;
    homeOpenTier?: "open_confirmed" | "unknown_fallback";
    /** 首頁 relaxed：僅要求 OPERATIONAL 真實地點，不要求評分／評論 */
    homeNearbyTier?: "operational_only";
    /** 探索地圖：display 不要求評分／營業狀態未知；fallback 更寬鬆 */
    exploreMapTier?: "strict" | "display" | "fallback";
    /** Chat 目的地推薦：僅在使用者要求「現在能去」時排除 closed_now */
    requireOpenNow?: boolean;
    /** 住宿導購或使用者明確找住宿時允許飯店 */
    allowLodging?: boolean;
  },
): RecommendablePlaceResult {
  const name = (place.name ?? "").trim();
  const placeId = resolvePlaceId(place);
  const openNow = resolveOpenNow(place);
  const biz = normalizeBiz(place.businessStatus);

  const fail = (reason: string): RecommendablePlaceResult => {
    if (options?.logDrop !== false) {
      logPlaceRecommendFilterDrop(place, reason, context);
    }
    return { ok: false, reason };
  };

  const cityMode = context === "explore_map_city";
  const exploreRelaxed =
    (context === "explore_map" || context === "explore_map_city") &&
    (options?.exploreMapTier === "display" || options?.exploreMapTier === "fallback");

  if (place.isSavedFavorite && context !== "home_nearby") {
    if (!name) return fail("missing_name");
    if (biz === "CLOSED_PERMANENTLY") return fail("closed_business");
    if (biz === "CLOSED_TEMPORARILY" && options?.requireOpenNow !== false) {
      return fail("closed_business");
    }
    if (openNow === false && options?.requireOpenNow !== false) return fail("closed_now");
    return { ok: true };
  }

  if (!placeId || placeId === "Unknown") return fail("missing_place_id");
  if (!name || name === "Unknown") return fail("missing_name");
  if (isBurialOrFuneralPlace(place)) return fail("burial_or_funeral");
  if (!options?.allowLodging && isLodgingPlace(place)) return fail("lodging");

  const moodRecommendContexts = new Set<RecommendablePlaceContext>([
    "ai_recommend",
    "chat_destination_recommend",
    "nearby_home",
  ]);
  if (moodRecommendContexts.has(context) && !place.isSavedFavorite) {
    const rating = place.rating ?? 0;
    const reviews = place.userRatingCount ?? 0;
    if (rating <= 0 || reviews < 10) return fail("insufficient_reviews");
  }

  if (cityMode && isLowValueCityExplorePlace(place)) return fail("low_value_city_marker");
  if (CLOSED_NAME_RE.test(name)) return fail("closed_name");

  if (isPureGeographicMarker(place)) {
    if (exploreRelaxed && passesTravelFriendlyGate(place)) {
      /* allow landmarks with travel-friendly signals */
    } else if (!cityMode || !isCityPopularCandidate(place)) {
      return fail("geographic_marker");
    }
  }
  if (
    isAddressLikeMarker(name) &&
    !isNightMarketStyle(place) &&
    !cityMode &&
    !exploreRelaxed
  ) {
    return fail("address_like_marker");
  }

  if (biz === "CLOSED_PERMANENTLY") return fail("closed_permanently");
  if (
    biz === "CLOSED_TEMPORARILY" &&
    !(context === "ai_recommend" && options?.requireOpenNow === false)
  ) {
    return fail("closed_temporarily");
  }
  if (
    biz &&
    biz !== "OPERATIONAL" &&
    !(context === "ai_recommend" && options?.requireOpenNow === false && biz === "CLOSED_TEMPORARILY")
  ) {
    return fail("non_operational");
  }

  if (!hasExplicitCategory(place) && !cityMode && !exploreRelaxed) return fail("missing_category");

  for (const t of allTypes(place)) {
    if (NON_RECOMMENDABLE_TYPES.has(t)) return fail(`excluded_type:${t}`);
    if (t === "convenience_store" && !place.explicitConvenienceSearch) {
      return fail("convenience_store");
    }
  }

  if (!passesTravelFriendlyGate(place) && !cityMode && !exploreRelaxed) {
    return fail("not_travel_friendly");
  }

  if (context === "home_nearby" && options?.homeNearbyTier === "operational_only") {
    if (openNow === false) return fail("closed_now");
    return { ok: true };
  }

  if (context === "chat_destination_recommend") {
    if (isSchoolOrOfficeType(place)) return fail("school_or_office");
    if (openNow === false && options?.requireOpenNow) return fail("closed_now");
    return { ok: true };
  }

  if (context === "chat_nearby") {
    if (biz === "CLOSED_PERMANENTLY") return fail("closed_permanently");
    if (!placeId || placeId === "Unknown") return fail("missing_place_id");
    if (!name || name === "Unknown") return fail("missing_name");
    if (isBurialOrFuneralPlace(place)) return fail("burial_or_funeral");
    return { ok: true };
  }

  if (exploreRelaxed) {
    if (openNow === false) return fail("closed_now");
    return { ok: true };
  }

  const minRating = minRatingFor(place, context);
  const minReviews = minReviewsFor(place, context);
  const rating = place.rating;
  const reviewCount = place.userRatingCount ?? 0;

  if (rating == null) return fail("missing_rating");
  if (reviewCount < minReviews) return fail("insufficient_reviews");
  if (rating < minRating) return fail("low_rating");

  // General chat recommendations may surface otherwise eligible places even
  // when current opening state is closed or unknown. Permanent closure was
  // rejected above; time-sensitive callers opt back into the strict checks.
  if (context === "ai_recommend" && options?.requireOpenNow === false) {
    return { ok: true };
  }

  if (
    openNow === false &&
    !(context === "ai_recommend" && options?.requireOpenNow === false)
  ) {
    return fail("closed_now");
  }

  if (context === "home_nearby") {
    if (options?.homeOpenTier === "unknown_fallback") {
      if (openNow === false) return fail("closed_now");
      if (openNow !== null) return fail("not_unknown_open");
      return { ok: true };
    }
    if (openNow !== true) return fail("open_not_confirmed");
    return { ok: true };
  }

  if (openNow == null) {
    const allowUnknownOpen =
      cityMode ||
      (isNightMarketStyle(place) &&
        (context === "home_nearby" || context === "explore_map"));
    if (!allowUnknownOpen) return fail("open_unknown");
    if (!cityMode && reviewCount < NIGHT_MARKET_MIN_REVIEWS) return fail("night_market_low_reviews");
  }

  return { ok: true };
}

export function filterRecommendablePlaces<T extends RecommendablePlaceInput>(
  places: T[],
  context: RecommendablePlaceContext,
  options?: { logDrop?: boolean },
): T[] {
  const kept: T[] = [];
  for (const place of places) {
    const result = isRecommendablePlace(place, context, options);
    if (result.ok) kept.push(place);
  }
  return kept;
}

export function placeResultToRecommendableInput(
  place: {
    id: string;
    name: string;
    businessStatus: string | null;
    openStatus: PlaceOpenStatus;
    rating: number | null;
    userRatingCount: number | null;
    primaryType: string | null;
    types?: string[] | null;
  },
  extra?: Pick<RecommendablePlaceInput, "categoryId" | "isSavedFavorite" | "explicitConvenienceSearch">,
): RecommendablePlaceInput {
  return {
    id: place.id,
    placeId: place.id,
    name: place.name,
    businessStatus: place.businessStatus,
    openStatus: place.openStatus,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    primaryType: place.primaryType,
    types: place.types,
    ...extra,
  };
}

export function recommendationToRecommendableInput(
  rec: {
    name: string;
    type?: string;
    primaryType?: string;
    types?: string[] | null;
    googlePlaceId?: string;
    placeId?: string;
    id?: string;
    rating?: number | null;
    userRatingCount?: number | null;
    businessStatus?: string | null;
    openStatusLabel?: string;
  },
  availability?: {
    businessStatus?: string | null;
    openStatus?: PlaceOpenStatus;
  },
): RecommendablePlaceInput {
  let openStatus = availability?.openStatus ?? null;
  if (!openStatus && rec.openStatusLabel?.includes("營業中")) openStatus = "open";
  if (!openStatus && rec.openStatusLabel?.includes("未營業")) openStatus = "closed_now";

  const typeMetadata = recommendationTypeMetadataFromItem({
    primaryType: rec.primaryType,
    types: rec.types,
    type: rec.type,
  });

  return {
    id: rec.googlePlaceId ?? rec.placeId ?? rec.id,
    placeId: rec.googlePlaceId ?? rec.placeId ?? rec.id,
    name: rec.name,
    businessStatus: availability?.businessStatus ?? rec.businessStatus ?? null,
    openStatus,
    rating: rec.rating ?? null,
    userRatingCount: rec.userRatingCount ?? null,
    primaryType: typeMetadata.primaryType,
    types: typeMetadata.types.length > 0 ? typeMetadata.types : null,
  };
}

export function itineraryToRecommendableInput(
  item: {
    placeName: string;
    title?: string;
    googlePlaceId?: string;
    placeType?: string;
    rating?: number | null;
    userRatingCount?: number | null;
  },
  availability?: {
    businessStatus?: string | null;
    openStatus?: PlaceOpenStatus;
  },
): RecommendablePlaceInput {
  return {
    id: item.googlePlaceId,
    placeId: item.googlePlaceId,
    name: item.placeName,
    businessStatus: availability?.businessStatus ?? null,
    openStatus: availability?.openStatus ?? null,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    primaryType: item.placeType ?? item.title ?? null,
    types: item.placeType ? [item.placeType] : item.title ? [item.title] : null,
  };
}
