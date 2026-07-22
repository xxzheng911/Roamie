import type { PlaceResult } from "@/lib/place-result";
import type { DestinationPlaceSearchProfile } from "@/lib/ai/landmark-place-strategy";
import {
  isExcludedInternalFacilityType,
  isInternalSubPlaceOfLandmark,
} from "@/lib/ai/landmark-place-strategy";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import {
  logChatPlacesFilterFallbackCount,
  logChatPlacesFilterRelaxedCount,
  logChatPlacesFilterStrictCount,
  logChatPlacesFinalCount,
  logChatPlacesRawCount,
} from "@/lib/ai/chat-place-flow-log";
import type { ChatPlaceCategoryIntent } from "@/lib/ai/chat-place-category-types";
import {
  filterPlacesByCafeGuard,
  filterPlacesByShoppingGuard,
  isCafePlace,
  isShoppingPlace,
} from "@/lib/ai/chat-category-place-guard";

export const CHAT_DESTINATION_MIN_COUNT = 3;
export const CHAT_DESTINATION_TARGET_COUNT = 6;
export const CHAT_PLANNING_RECOMMENDATION_TARGET_COUNT = 24;

const SCHOOL_OFFICE_TYPES = new Set([
  "school",
  "secondary_school",
  "primary_school",
  "university",
  "preschool",
  "corporate_office",
  "office",
  "accounting",
  "lawyer",
  "real_estate_agency",
  "insurance_agency",
  "car_repair",
  "car_dealer",
  "storage",
  "parking",
  "gas_station",
  "atm",
  "bank",
]);

const TRAVEL_RELATED_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "market",
  "shopping_mall",
  "department_store",
  "night_club",
  "bar",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "food",
  "performing_arts_theater",
  "movie_theater",
  "zoo",
  "aquarium",
  "amusement_park",
  "theme_park",
  "historical_landmark",
  "historical_place",
  "monument",
  "cultural_landmark",
  "temple",
  "hindu_temple",
  "buddhist_temple",
  "church",
  "plaza",
  "town_square",
  "observation_deck",
  "natural_feature",
  "point_of_interest",
]);

const TRAVEL_NAME_RE =
  /景點|博物|美術|夜市|商圈|公園|廣場|老街|步道|觀景|紀念|古蹟|寺|廟|海灘|溫泉|瀑布|碼頭|部落|文化|展覽|market|museum|park|temple|observatory|night\s*market|attraction/i;

const INTERNAL_SERVICE_NAME_RE =
  /服務中心|遊客中心|售票|停車場|廁所|入口|出口|服務台|諮詢|寄物|賣店$|紀念品店|gift\s*shop|restroom|ticket\s*office|information\s*center/i;

function placeTypes(place: PlaceResult): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

function isSchoolOrOffice(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.some((t) => SCHOOL_OFFICE_TYPES.has(t))) return true;
  const name = (place.name ?? "").trim();
  return /(小學|國中|高中|職校|補習|幼兒園|大學|学院|學院|公司|企業|工廠)/.test(name);
}

function isTravelRelatedType(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.some((t) => TRAVEL_RELATED_TYPES.has(t))) return true;
  const name = (place.name ?? "").trim();
  return TRAVEL_NAME_RE.test(name);
}

function isPermanentlyClosed(place: PlaceResult): boolean {
  const biz = (place.businessStatus ?? "").trim().toUpperCase();
  // Only permanent closure is a hard exclude. Temporary / today-closed must not
  // drop places when the trip is on a future date.
  return biz === "CLOSED_PERMANENTLY";
}

function userRequiresOpenNow(userText?: string): boolean {
  if (!userText?.trim()) return false;
  return /(現在能去|目前營業|現在開|正在營業|現在開門|open\s*now)/i.test(userText.trim());
}

/** 大地標內部小點 / 城市內非主要地標的子點 */
export function isSubPlaceOfDestination(
  place: PlaceResult,
  destination: string,
  profile?: DestinationPlaceSearchProfile,
): boolean {
  const name = (place.name ?? "").trim();
  if (!name) return true;

  const parent = profile?.parentLandmark ?? (profile?.kind === "landmark" ? destination : undefined);
  if (parent && isInternalSubPlaceOfLandmark(name, parent)) return true;
  if (isExcludedInternalFacilityType(place)) return true;
  if (INTERNAL_SERVICE_NAME_RE.test(name)) return true;

  const destNorm = normalizePlaceName(destination);
  const nameNorm = normalizePlaceName(name);
  if (!destNorm || !nameNorm.includes(destNorm)) return false;

  const types = placeTypes(place);
  const isMajor =
    types.some((t) =>
      ["tourist_attraction", "museum", "art_gallery", "shopping_mall", "park", "market"].includes(t),
    ) || TRAVEL_NAME_RE.test(name);

  if (isMajor) return false;

  const isMinorCommercial =
    types.some((t) =>
      ["store", "restaurant", "cafe", "coffee_shop", "food", "point_of_interest", "establishment"].includes(
        t,
      ),
    ) || /(店|餐|咖啡|小吃|賣|攤)/.test(name);

  return isMinorCommercial;
}

function passesStrictTier(place: PlaceResult): boolean {
  if (isSchoolOrOffice(place)) return false;
  if (isPermanentlyClosed(place)) return false;
  if (!isTravelRelatedType(place)) return false;

  const rating = place.rating;
  const reviews = place.userRatingCount ?? 0;
  if (rating == null || rating < 4.2) return false;
  if (reviews < 100) return false;
  return true;
}

function passesRelaxedTier(place: PlaceResult): boolean {
  if (isSchoolOrOffice(place)) return false;
  if (isPermanentlyClosed(place)) return false;
  if (!isTravelRelatedType(place)) return false;

  const rating = place.rating;
  const reviews = place.userRatingCount ?? 0;
  if (rating != null && rating >= 4.0) return true;
  if (reviews >= 30) return true;
  return false;
}

function passesFallbackTier(place: PlaceResult): boolean {
  if (isSchoolOrOffice(place)) return false;
  if (isPermanentlyClosed(place)) return false;
  return isTravelRelatedType(place);
}

function shouldDropForOpenStatus(
  place: PlaceResult,
  requireOpenNow: boolean,
): boolean {
  if (!requireOpenNow) return false;
  if (place.openStatus === "closed_now" || place.openStatus === "permanently_closed") {
    return true;
  }
  return false;
}

function dedupeByPlaceId(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const place of places) {
    const id = (place.id ?? place.name ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(place);
  }
  return out;
}

function rankChatDestinationPlace(place: PlaceResult): number {
  let score = 0;
  const rating = place.rating ?? 0;
  const reviews = place.userRatingCount ?? 0;
  score += rating * 10;
  score += Math.min(reviews / 50, 20);
  if (TRAVEL_NAME_RE.test(place.name ?? "")) score += 5;
  for (const t of placeTypes(place)) {
    if (TRAVEL_RELATED_TYPES.has(t)) score += 3;
  }
  return score;
}

export function filterChatDestinationPlaces(
  places: PlaceResult[],
  opts: {
    destination: string;
    profile?: DestinationPlaceSearchProfile;
    requireOpenNow?: boolean;
    userText?: string;
  },
): PlaceResult[] {
  const requireOpenNow = opts.requireOpenNow ?? userRequiresOpenNow(opts.userText);
  const raw = dedupeByPlaceId(places);
  logChatPlacesRawCount(raw.length);

  const eligible = raw.filter((place) => {
    if (!place.name?.trim() || !place.id?.trim()) return false;
    if (isSubPlaceOfDestination(place, opts.destination, opts.profile)) return false;
    if (shouldDropForOpenStatus(place, requireOpenNow)) return false;
    return true;
  });

  const strict = eligible.filter(passesStrictTier);
  logChatPlacesFilterStrictCount(strict.length);

  let picked = strict;
  if (picked.length < CHAT_DESTINATION_MIN_COUNT) {
    const relaxed = eligible.filter(
      (p) => !strict.includes(p) && passesRelaxedTier(p),
    );
    logChatPlacesFilterRelaxedCount(relaxed.length);
    picked = [...strict, ...relaxed];
  }

  if (picked.length < CHAT_DESTINATION_MIN_COUNT) {
    const fallback = eligible.filter(
      (p) => !picked.includes(p) && passesFallbackTier(p),
    );
    logChatPlacesFilterFallbackCount(fallback.length);
    picked = [...picked, ...fallback];
  }

  const final = picked
    .sort((a, b) => rankChatDestinationPlace(b) - rankChatDestinationPlace(a))
    .slice(0, CHAT_DESTINATION_TARGET_COUNT);

  logChatPlacesFinalCount(final.length);
  return final;
}

/**
 * 多日行程規劃：只要求 name；不要求 photo / details / rating / placeId（會先 normalize）。
 */
export function filterChatPlanningPlaces(
  places: PlaceResult[],
  opts: {
    destination: string;
    profile?: DestinationPlaceSearchProfile;
    requireOpenNow?: boolean;
    userText?: string;
    targetCount?: number;
  },
): PlaceResult[] {
  const requireOpenNow = opts.requireOpenNow ?? userRequiresOpenNow(opts.userText);
  const raw = dedupeByPlaceId(places);
  logChatPlacesRawCount(raw.length);

  const eligible = raw.filter((place) => {
    if (!place.name?.trim()) return false;
    if (isSchoolOrOffice(place)) return false;
    if (isPermanentlyClosed(place)) return false;
    if (isSubPlaceOfDestination(place, opts.destination, opts.profile)) return false;
    if (shouldDropForOpenStatus(place, requireOpenNow)) return false;
    return true;
  });

  logChatPlacesFilterFallbackCount(eligible.length);

  const target = opts.targetCount ?? Math.max(CHAT_PLANNING_RECOMMENDATION_TARGET_COUNT, 15);
  const final = eligible
    .sort((a, b) => rankChatDestinationPlace(b) - rankChatDestinationPlace(a))
    .slice(0, target);

  logChatPlacesFinalCount(final.length);
  return final;
}

/** 類別推薦（咖啡廳／餐廳等）：不做 strict 評分門檻，避免過度刪除後 fallback 錯誤卡片 */
export function filterChatCategoryPlaces(
  places: PlaceResult[],
  opts: {
    intent: ChatPlaceCategoryIntent;
    destination: string;
    profile?: DestinationPlaceSearchProfile;
    requireOpenNow?: boolean;
    userText?: string;
  },
): PlaceResult[] {
  const requireOpenNow = opts.requireOpenNow ?? userRequiresOpenNow(opts.userText);
  const raw = dedupeByPlaceId(places);
  logChatPlacesRawCount(raw.length);

  let eligible = raw.filter((place) => {
    if (!place.name?.trim() || !place.id?.trim()) return false;
    if (isSubPlaceOfDestination(place, opts.destination, opts.profile)) return false;
    if (shouldDropForOpenStatus(place, requireOpenNow)) return false;
    if (isSchoolOrOffice(place)) return false;
    if (isPermanentlyClosed(place)) return false;
    return true;
  });

  if (opts.intent === "cafe") {
    eligible = filterPlacesByCafeGuard(eligible);
  } else if (opts.intent === "shopping") {
    eligible = filterPlacesByShoppingGuard(eligible, opts.userText);
  }

  const relaxed = eligible.filter(passesRelaxedTier);
  logChatPlacesFilterRelaxedCount(relaxed.length);

  let picked = relaxed.length > 0 ? relaxed : eligible.filter(passesFallbackTier);
  if (opts.intent === "cafe") {
    picked = picked.filter(isCafePlace);
  } else if (opts.intent === "shopping") {
    // Shopping: never fall back to attractions / observation decks
    picked = picked.filter((p) => isShoppingPlace(p, opts.userText));
  }

  // Shopping must oversample for reserve (display 4 + reserve ≥4). Do not cap at TARGET(6).
  const poolCap =
    opts.intent === "shopping"
      ? Math.max(CHAT_DESTINATION_TARGET_COUNT, 20)
      : CHAT_DESTINATION_TARGET_COUNT;
  const final = picked
    .sort((a, b) => rankChatDestinationPlace(b) - rankChatDestinationPlace(a))
    .slice(0, poolCap);

  logChatPlacesFinalCount(final.length);
  return final;
}
