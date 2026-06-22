import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";

export type TicketAffiliatePlaceInput = {
  name?: string | null;
  title?: string | null;
  placeName?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  placeType?: string | null;
  category?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
};

export type TicketAffiliateTripContext = {
  destinationLabel?: string;
  destinationCountry?: string;
  travelDate?: string;
  tripCtx?: TripAffiliateContext;
};

export type TicketAffiliateDecision = {
  show: boolean;
  reason: string;
  searchKeyword: string;
};

/** 熱門景點 / 地標 / 體驗型 Google types（全球通用） */
const HOT_LANDMARK_TYPES = new Set([
  "tourist_attraction",
  "landmark",
  "natural_feature",
  "museum",
  "art_gallery",
  "aquarium",
  "zoo",
  "amusement_park",
  "theme_park",
  "observation_deck",
  "cable_car",
  "hot_spring",
  "spa",
  "public_bath",
  "monument",
  "historical_landmark",
  "historical_place",
  "performing_arts_theater",
  "planetarium",
  "cultural_landmark",
  "national_park",
  "state_park",
]);

/** 無票券意圖、應一律排除的類型 */
const NEVER_TICKET_TYPES = new Set([
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "wine_bar",
  "pub",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "food",
  "fast_food_restaurant",
  "ice_cream_shop",
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "guest_house",
  "bed_and_breakfast",
  "shopping_mall",
  "department_store",
  "store",
  "clothing_store",
  "convenience_store",
  "supermarket",
  "grocery_store",
  "drugstore",
  "pharmacy",
  "book_store",
  "bookstore",
  "library",
  "hardware_store",
  "home_goods_store",
  "electronics_store",
  "furniture_store",
  "train_station",
  "subway_station",
  "bus_station",
  "transit_station",
  "airport",
  "light_rail_station",
  "parking",
  "gas_station",
  "hospital",
  "doctor",
  "dentist",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "local_government_office",
  "police",
  "fire_station",
  "car_repair",
  "car_dealer",
  "real_estate_agency",
  "residential",
  "apartment_building",
  "housing_complex",
]);

const TICKET_EXPERIENCE_KEYWORD_RE =
  /disney|迪士尼|universal|usj|環球影城|环球影城|warner\s*bros|harry\s*potter|哈利波特|teamlab|skytree|sky\s*tree|晴空塔|tokyo\s*tower|東京鐵塔|东京铁塔|taipei\s*101|台北101|observatory|展望台|lookout|viewpoint|museum|博物館|博物馆|gallery|美術館|美术馆|aquarium|水族館|水族馆|zoo|動物園|动物园|cable\s*car|纜車|缆车|gondola|ropeway|hot\s*spring|溫泉|温泉|onsen|day\s*tour|一日遊|一日游|theme\s*park|樂園|乐园|amusement|studio|影城|palace|宮殿|宫殿|castle|城堡|temple|shrine|神社|寺廟|寺庙|monastery|cathedral|mosque|synagogue|pagoda|island|島|岛|lake|湖|mountain|山|tower|鐵塔|铁塔|landmark|heritage|ruins|fortress|citadel|memorial|monument|national\s*park|state\s*park|botanical\s*garden|safari|water\s*park|observation\s*deck|skydeck|planetarium|aquarium|zoo|gallery|louvre|羅浮宮|罗浮宫|eiffel|艾菲爾|埃菲尔|arc\s*de\s*triomphe|凱旋門|凯旋门|stonehenge|巨石陣|巨石阵|colosseum|鬥獸場|斗兽场|sagrada|聖家堂|圣家堂|acropolis|衛城|卫城|petra|pyramid|金字塔|burj|marina\s*bay|merlion|sentosa|環球|环球|ocean\s*park|海洋公園|海洋公园|legoland|seaworld|uss|環球影城|環球影視/i;

const TOUR_DESTINATION_RE =
  /富士山|河口湖|箱根|鎌倉|镰仓|日光|奈良|阿里山|日月潭|太魯閣|太鲁阁|九份|清境|南怡島|南怡岛|海雲台|海云台|大叻|峴港|岘港|巴拿山|普吉|普吉島|普吉岛|峇里|巴厘|巴厘岛|大峽谷|大峡谷|藍山|蓝山|巨石陣|巨石阵|羅浮宮|罗浮宫|凱旋門|凯旋门|艾菲爾|埃菲尔|fuji|kawaguchiko|hakone|kamakura|nikko|nara|alishan|sun\s*moon\s*lake|jiufen|jioufen|qingjing|cingjing|naminara|nami\s*island|haeundae|dalat|danang|ba\s*na\s*hills|phuket|bali|grand\s*canyon|blue\s*mountains|stonehenge|louvre|eiffel|arc\s*de\s*triomphe|taroko|ueno|gyoen|yosemite|yellowstone|banff|machu\s*picchu|angkor|petra|santorini|capri|pompeii|versailles|neuschwanstein|matterhorn|jurassic\s*coast|great\s*barrier|uluru|sigiriya|bromo|komodo|el\s*nido|palawan|boracay|jeju|seoraksan|gyeongju|hawaii|maui|niagara|banff|whistler|queenstown|milford|fiordland/i;

const POPULAR_PARK_RE =
  /national\s*park|state\s*park|國家公園|国立公園|國立公園|上野|御苑|gyoen|ueno|shinjuku\s*gyoen|新宿御苑|yoyogi|代代木|central\s*park|hyde\s*park|royal\s*botanic|kew\s*gardens|botanic\s*garden|太魯閣|taroko|grand\s*canyon|yosemite|yellowstone|banff|kruger|serengeti|fiordland|glacier\s*national|zion|bryce|acadia|sequoia|redwood|joshua\s*tree|death\s*valley|everglades|rocky\s*mountain/i;

const EXCLUDE_DISTRICT_RE =
  /商店街|步行街|商业街|點心橫丁|仲見世|shopping\s*street|shopping\s*district|market\s*street|arcade|boutique\s*street|promenade(?!\s*de)|plaza(?!\s*hotel)|souq|souk|night\s*market|flea\s*market|farmers\s*market/i;

const EXCLUDE_FOOD_LODGING_RE =
  /餐廳|餐厅|美食|咖啡廳|咖啡厅|咖啡|cafe|coffee|restaurant|bistro|diner|brunch|bar(?!\s*celona)|pub|lounge|居酒屋|hotel|hostel|motel|lodging|inn(?!\s*isfree)|resort(?!\s*world)|bnb|便利商店|超商|convenience\s*store|7[\-\s]?eleven|family\s*mart|lawson|車站(?!\s*前)|station(?!\s*hill)|terminal(?!\s*21)|parking|停車|pharmacy|drugstore|bookstore|書店|书店|hardware|材料行|supermarket|grocery/i;

const POI_MIN_RATING = 4.2;
const POI_MIN_REVIEWS = 500;
const PARK_MIN_RATING = 4.0;
const PARK_MIN_REVIEWS = 20;

function normalizeTypes(place: TicketAffiliatePlaceInput): string[] {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  const pt = (place.placeType ?? "").trim().toLowerCase();
  if (pt) {
    if (pt.includes(",")) {
      for (const part of pt.split(",")) {
        const n = part.trim().toLowerCase();
        if (n) out.add(n);
      }
    } else {
      out.add(pt);
    }
  }
  return [...out];
}

function placeDisplayName(place: TicketAffiliatePlaceInput): string {
  return (place.placeName || place.name || place.title || "").trim();
}

function tripDestination(tripContext?: TicketAffiliateTripContext): string {
  return (
    tripContext?.destinationLabel?.trim() ||
    tripContext?.tripCtx?.destinationLabel?.trim() ||
    ""
  );
}

function hasZeroQuality(place: TicketAffiliatePlaceInput): boolean {
  const rating = place.rating;
  const reviews = place.userRatingCount;
  if (rating == null && reviews == null) return false;
  return (rating ?? 0) <= 0 || (reviews ?? 0) <= 0;
}

function isHighQualityPoi(place: TicketAffiliatePlaceInput, types: string[]): boolean {
  if (!types.includes("point_of_interest")) return false;
  return (place.rating ?? 0) >= POI_MIN_RATING && (place.userRatingCount ?? 0) >= POI_MIN_REVIEWS;
}

function isPopularParkOrGarden(
  place: TicketAffiliatePlaceInput,
  types: string[],
  name: string,
): boolean {
  const isParkLike = types.some((t) =>
    ["park", "botanical_garden", "national_park", "state_park"].includes(t),
  );
  if (!isParkLike && !POPULAR_PARK_RE.test(name)) return false;

  if (types.some((t) => ["national_park", "state_park"].includes(t))) return true;
  if (POPULAR_PARK_RE.test(name)) return true;
  if (TOUR_DESTINATION_RE.test(name)) return true;

  return (
    (place.rating ?? 0) >= PARK_MIN_RATING && (place.userRatingCount ?? 0) >= PARK_MIN_REVIEWS
  );
}

function isDayTourDestination(name: string): boolean {
  return TOUR_DESTINATION_RE.test(name);
}

function joinSearchKeyword(destination: string, keyword: string): string {
  const dest = destination.trim();
  const text = keyword.trim();
  if (!text) return dest;
  if (!dest) return text;
  if (text.includes(dest)) return text;
  return `${dest} ${text}`;
}

export function buildTicketAffiliateSearchKeyword(
  place: TicketAffiliatePlaceInput,
  tripContext?: TicketAffiliateTripContext,
): string {
  const name = placeDisplayName(place);
  const destination = tripDestination(tripContext);

  if (/富士山|mount\s*fuji|\bfuji\b/i.test(name) && !/河口湖|kawaguchiko|lake\s*kawaguchi/i.test(name)) {
    return joinSearchKeyword(destination, "富士山 河口湖 一日遊");
  }
  if (/河口湖|kawaguchiko|lake\s*kawaguchi/i.test(name)) {
    return joinSearchKeyword(destination, "河口湖 富士山 一日遊");
  }

  if (isDayTourDestination(name) && !/一日遊|一日游|day\s*tour/i.test(name)) {
    return joinSearchKeyword(destination, `${name} 一日遊`);
  }

  return joinSearchKeyword(destination, name);
}

function hasExcludedPrimaryType(types: string[]): boolean {
  if (types.length === 0) return false;
  const primary = types[0];
  return primary ? NEVER_TICKET_TYPES.has(primary) : false;
}

export function shouldShowTicketAffiliate(
  place: TicketAffiliatePlaceInput,
  tripContext?: TicketAffiliateTripContext,
): TicketAffiliateDecision {
  const name = placeDisplayName(place);
  const types = normalizeTypes(place);
  const destination = tripDestination(tripContext);
  const searchKeyword = buildTicketAffiliateSearchKeyword(place, tripContext);

  const logDecision = (show: boolean, reason: string): TicketAffiliateDecision => {
    console.info(
      `[TICKET_AFFILIATE_DECISION] placeName=${name} types=${types.join(",")} destination=${destination} show=${String(show)} reason=${reason} searchKeyword=${searchKeyword}`,
    );
    return { show, reason, searchKeyword };
  };

  if (!name) {
    return logDecision(false, "missing_name");
  }

  if (hasZeroQuality(place)) {
    return logDecision(false, "zero_rating_or_reviews");
  }

  if (TICKET_EXPERIENCE_KEYWORD_RE.test(name)) {
    return logDecision(true, "ticket_experience_keyword");
  }

  if (TOUR_DESTINATION_RE.test(name)) {
    return logDecision(true, "tour_destination_match");
  }

  if (EXCLUDE_FOOD_LODGING_RE.test(name)) {
    return logDecision(false, "excluded_food_lodging_retail_name");
  }

  if (EXCLUDE_DISTRICT_RE.test(name)) {
    return logDecision(false, "excluded_shopping_street");
  }

  if (hasExcludedPrimaryType(types)) {
    return logDecision(false, "excluded_primary_type");
  }

  if (types.some((t) => HOT_LANDMARK_TYPES.has(t))) {
    return logDecision(true, "hot_landmark_type");
  }

  if (isHighQualityPoi(place, types)) {
    return logDecision(true, "high_quality_poi");
  }

  if (isPopularParkOrGarden(place, types, name)) {
    return logDecision(true, "popular_park_or_nature");
  }

  if (types.some((t) => NEVER_TICKET_TYPES.has(t)) && !types.some((t) => HOT_LANDMARK_TYPES.has(t))) {
    return logDecision(false, "excluded_google_type");
  }

  return logDecision(false, "not_ticketable");
}

export function resolveTicketAffiliateTripContext(
  ctx?: TripAffiliateContext,
): TicketAffiliateTripContext | undefined {
  if (!ctx) return undefined;
  return {
    destinationLabel: ctx.destinationLabel,
    destinationCountry: ctx.destinationLocation?.country ?? "",
    travelDate: ctx.startDate,
    tripCtx: ctx,
  };
}
