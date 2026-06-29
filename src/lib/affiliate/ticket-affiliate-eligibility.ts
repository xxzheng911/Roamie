import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import {
  isAttractionAffiliateCategory,
  isExcludedAffiliateCategory,
  mapPlaceLabelToGoogleType,
} from "@/lib/affiliate/place-type-category-map";

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

const POI_MIN_RATING = 4.0;
const POI_MIN_REVIEWS = 200;

/** 熱門景點白名單（子字串比對，支援日韓港台新泰等） */
const FAMOUS_LANDMARK_KEYWORDS = [
  "富士山",
  "mount fuji",
  "河口湖",
  "kawaguchiko",
  "哈利波特",
  "harry potter",
  "warner bros",
  "東京迪士尼",
  "tokyo disney",
  "迪士尼",
  "disneyland",
  "disney sea",
  "disneysea",
  "晴空塔",
  "skytree",
  "sky tree",
  "東京鐵塔",
  "东京铁塔",
  "tokyo tower",
  "淺草寺",
  "浅草寺",
  "sensoji",
  "senso-ji",
  "雷門",
  "雷门",
  "kaminarimon",
  "kaminari mon",
  "上野動物園",
  "上野动物园",
  "ueno zoo",
  "teamlab",
  "team lab",
  "澀谷sky",
  "涩谷sky",
  "shibuya sky",
  "大阪環球",
  "大阪环球",
  "universal studios japan",
  "usj",
  "環球影城",
  "环球影城",
  "清水寺",
  "kiyomizu",
  "伏見稻荷",
  "伏见稻荷",
  "fushimi inari",
  "道頓堀",
  "道顿堀",
  "dotonbori",
  "奈良公園",
  "奈良公园",
  "nara park",
  "上野公園",
  "上野公园",
  "ueno park",
  "箱根",
  "hakone",
  "鎌倉",
  "镰仓",
  "kamakura",
  "日光",
  "nikko",
  "六本木之丘",
  "roppongi hills",
  "豪德寺",
  "gotokuji",
  "首爾塔",
  "首尔塔",
  "n seoul tower",
  "namsan tower",
  "景福宮",
  "景福宫",
  "gyeongbokgung",
  "樂天世界",
  "乐天世界",
  "lotte world",
  "海雲台",
  "海云台",
  "haeundae",
  "南怡島",
  "南怡岛",
  "nami island",
  "naminara",
  "愛寶樂園",
  "爱宝乐园",
  "everland",
  "香港迪士尼",
  "hong kong disneyland",
  "維多利亞港",
  "维多利亚港",
  "victoria harbour",
  "victoria harbor",
  "太平山",
  "peak tram",
  "海洋公園",
  "海洋公园",
  "ocean park",
  "新加坡環球",
  "新加坡环球",
  "universal studios singapore",
  "濱海灣花園",
  "滨海湾花园",
  "gardens by the bay",
  "merlion",
  "魚尾獅",
  "鱼尾狮",
  "sentosa",
  "聖淘沙",
  "圣淘沙",
  "大皇宮",
  "大皇宫",
  "grand palace",
  "臥佛寺",
  "卧佛寺",
  "wat pho",
  "鄭王廟",
  "郑王庙",
  "wat arun",
  "台北101",
  "taipei 101",
  "九份",
  "jiufen",
  "jioufen",
  "日月潭",
  "sun moon lake",
  "阿里山",
  "alishan",
  "太魯閣",
  "太鲁阁",
  "taroko",
  "清境",
  "cingjing",
  "墾丁",
  "kenting",
  "故宮",
  "national palace museum",
  "eiffel",
  "艾菲爾",
  "埃菲尔",
  "louvre",
  "羅浮宮",
  "罗浮宫",
  "colosseum",
  "鬥獸場",
  "斗兽场",
  "sagrada",
  "聖家堂",
  "圣家堂",
  "burj khalifa",
  "哈利法塔",
  "marina bay sands",
  "legoland",
  "seaworld",
  "yosemite",
  "yellowstone",
  "grand canyon",
];

const STRONG_ATTRACTION_TYPES = new Set([
  "amusement_park",
  "theme_park",
  "museum",
  "aquarium",
  "zoo",
  "art_gallery",
  "observation_deck",
  "landmark",
  "historical_landmark",
  "historical_place",
  "cultural_landmark",
  "cultural_center",
  "monument",
  "planetarium",
  "performing_arts_theater",
  "exhibition",
  "experience",
]);

const CONDITIONAL_ATTRACTION_TYPES = new Set([
  "tourist_attraction",
  "place_of_worship",
  "church",
  "park",
  "natural_feature",
  "stadium",
  "district",
  "market",
]);

const FOOD_RETAIL_LODGING_TYPES = new Set([
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "bakery",
  "meal_takeaway",
  "meal_delivery",
  "food",
  "fast_food_restaurant",
  "ice_cream_shop",
  "store",
  "clothing_store",
  "convenience_store",
  "supermarket",
  "grocery_store",
  "shopping_mall",
  "department_store",
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "guest_house",
  "bed_and_breakfast",
]);

const HARD_EXCLUDED_TYPES = new Set([
  ...FOOD_RETAIL_LODGING_TYPES,
  "transit_station",
  "train_station",
  "subway_station",
  "bus_station",
  "light_rail_station",
  "airport",
  "parking",
  "gas_station",
  "pharmacy",
  "drugstore",
  "library",
  "school",
  "hospital",
  "residential",
  "cemetery",
  "funeral_home",
  "locality",
  "political",
  "route",
]);

const EXCLUDE_NAME_RE =
  /餐廳|餐厅|美食|咖啡廳|咖啡厅|咖啡|cafe|coffee|restaurant|bistro|diner|brunch|甜點|甜点|dessert|bakery|bar(?!\s*celona)|pub|lounge|居酒屋|hotel|hostel|motel|lodging|inn(?!\s*isfree)|便利商店|超商|convenience\s*store|7[\-\s]?eleven|family\s*mart|lawson|parking|停車|pharmacy|drugstore|bookstore|書店|书店|supermarket|grocery|材料行|hardware|拉麵|拉面|ramen|寿司|壽司|sushi|燒肉|烧肉|yakiniku|食堂|grill|eatery|dining|food\s*hall|kitchen/i;

const GENERIC_LOCAL_PARK_RE =
  /河濱|河滨|河堤|綠地|绿地|散步|步道|親水|亲水|社區公園|社区公园|鄰里公園|邻里公园|小型公園|小型公园|local\s*park|neighborhood\s*park|riverside\s*park|linear\s*park|dog\s*park|playground/i;

const TOURISM_KEYWORD_RE =
  /tower|palace|castle|temple|shrine|museum|aquarium|zoo|theme\s*park|observatory|skydeck|landmark|observation|disney|universal|legoland|planetarium|gallery|observatory|纜車|缆车|gondola|展望|skytree|sky\s*tree|環球|环球|樂園|乐园|博物|美術|美术|水族|動物园|動物園|寺|神社|神宮|大社|城|故宫|故宮|塔|historical|heritage|monument|memorial|fortress|citadel|ruins|archaeological/i;

const TOURIST_MARKET_RE =
  /夜市|night\s*market|傳統市場|传统市场|觀光市場|观光市场|觀光市集|观光市集|跳蚤|flea\s*market|tsukiji\s*market|築地場外|筑地场外|outer\s*market/i;

const DAY_TOUR_DESTINATION_RE =
  /富士山|河口湖|箱根|鎌倉|镰仓|日光|奈良|阿里山|日月潭|太魯閣|太鲁阁|九份|清境|南怡島|南怡岛|海雲台|海云台|大叻|峴港|岘港|巴拿山|普吉|普吉島|普吉岛|峇里|巴厘|巴厘岛|大峽谷|大峡谷|fuji|kawaguchiko|hakone|kamakura|nikko|nara|alishan|sun\s*moon\s*lake|jiufen|jioufen|qingjing|cingjing|naminara|nami\s*island|haeundae|dalat|danang|ba\s*na\s*hills|phuket|bali|grand\s*canyon|taroko|yosemite|yellowstone|banff|machu\s*picchu|angkor|petra|santorini|capri|pompeii|versailles|neuschwanstein|matterhorn|hawaii|maui|niagara|whistler|queenstown|milford|fiordland/i;

function placeDisplayName(place: TicketAffiliatePlaceInput): string {
  return (place.placeName || place.name || place.title || "").trim();
}

function resolvePrimaryType(place: TicketAffiliatePlaceInput): string {
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) return primary;
  const first = (place.types ?? []).find((t) => t?.trim())?.trim().toLowerCase();
  return first ?? "";
}

function normalizeGoogleTypes(place: TicketAffiliatePlaceInput): string[] {
  const out = new Set<string>();

  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }

  const primary = resolvePrimaryType(place);
  if (primary) out.add(primary);

  const pt = (place.placeType ?? "").trim();
  if (pt) {
    if (pt.includes(",")) {
      for (const part of pt.split(",")) {
        const mapped = mapPlaceLabelToGoogleType(part) ?? part.trim().toLowerCase();
        if (mapped) out.add(mapped);
      }
    } else {
      const mapped = mapPlaceLabelToGoogleType(pt) ?? pt.toLowerCase();
      if (mapped) out.add(mapped);
    }
  }

  const category = (place.category ?? "").trim();
  if (category) {
    const mapped = mapPlaceLabelToGoogleType(category);
    if (mapped) out.add(mapped);
  }

  return [...out];
}

function normalizeSearchText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
}

export function isFamousLandmarkName(name: string): boolean {
  const normalized = normalizeSearchText(name);
  if (!normalized) return false;
  return FAMOUS_LANDMARK_KEYWORDS.some((kw) => normalized.includes(normalizeSearchText(kw)));
}

function hasTourismKeyword(name: string): boolean {
  return TOURISM_KEYWORD_RE.test(name);
}

function hasTouristMarketKeyword(name: string): boolean {
  return TOURIST_MARKET_RE.test(name);
}

function hasStrongAttractionType(types: string[]): boolean {
  return types.some((t) => STRONG_ATTRACTION_TYPES.has(t));
}

function hasConditionalAttractionType(types: string[]): boolean {
  return types.some((t) => CONDITIONAL_ATTRACTION_TYPES.has(t));
}

function hasFoodRetailLodgingType(types: string[]): boolean {
  return types.some((t) => FOOD_RETAIL_LODGING_TYPES.has(t));
}

function hasHardExcludedType(types: string[]): boolean {
  return types.some((t) => HARD_EXCLUDED_TYPES.has(t));
}

function isFoodRetailLodgingDominant(
  place: TicketAffiliatePlaceInput,
  types: string[],
): boolean {
  const name = placeDisplayName(place);
  const primary = resolvePrimaryType(place);
  const category = place.category?.trim() ?? "";
  const placeType = place.placeType?.trim() ?? "";

  if (EXCLUDE_NAME_RE.test(name)) return true;
  if (isExcludedAffiliateCategory(category) || isExcludedAffiliateCategory(placeType)) {
    return true;
  }

  if (primary && FOOD_RETAIL_LODGING_TYPES.has(primary)) return true;

  const hasFood = hasFoodRetailLodgingType(types);
  if (!hasFood) return false;

  if (
    primary &&
    (STRONG_ATTRACTION_TYPES.has(primary) ||
      primary === "tourist_attraction" ||
      primary === "place_of_worship")
  ) {
    return false;
  }

  return true;
}

function tripDestination(tripContext?: TicketAffiliateTripContext): string {
  return (
    tripContext?.destinationLabel?.trim() ||
    tripContext?.tripCtx?.destinationLabel?.trim() ||
    ""
  );
}

function joinSearchKeyword(destination: string, keyword: string): string {
  const dest = destination.trim();
  const text = keyword.trim();
  if (!text) return dest;
  if (!dest) return text;
  if (normalizeSearchText(text).includes(normalizeSearchText(dest))) return text;
  return `${dest} ${text}`;
}

function cleanPlaceNameForSearch(name: string): string {
  return name
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\d+[\-‐‑–—]?\d*\s*(丁目|chōme|chome).*/i, "")
    .replace(/[,，|｜].*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function resolveSearchKeywordCore(name: string): string {
  const cleaned = cleanPlaceNameForSearch(name);
  const normalized = normalizeSearchText(cleaned);

  if (/淺草|浅草|asakusa/.test(normalized) && /雷門|雷门|kaminari/.test(normalized)) {
    return "淺草 雷門";
  }
  if (/淺草寺|sensoji|senso-ji/.test(normalized)) {
    return "淺草寺";
  }
  if (/富士山|mount\s*fuji|\bfuji\b/.test(normalized) && !/河口湖|kawaguchiko/.test(normalized)) {
    return "富士山 河口湖";
  }
  if (/河口湖|kawaguchiko/.test(normalized)) {
    return "河口湖 富士山";
  }
  if (/team\s*lab|teamlab/.test(normalized)) {
    return "teamLab";
  }
  if (/澀谷sky|涩谷sky|shibuya\s*sky/.test(normalized)) {
    return "澀谷 Sky";
  }
  if (/哈利波特|harry\s*potter|warner\s*bros/.test(normalized)) {
    return "東京哈利波特影城";
  }

  return cleaned;
}

export function buildTicketAffiliateSearchKeyword(
  place: TicketAffiliatePlaceInput,
  tripContext?: TicketAffiliateTripContext,
): string {
  const name = placeDisplayName(place);
  const destination = tripDestination(tripContext);
  const keyword = resolveSearchKeywordCore(name);

  if (DAY_TOUR_DESTINATION_RE.test(keyword) && !/一日遊|一日游|day\s*tour/i.test(keyword)) {
    return joinSearchKeyword(destination, `${keyword} 一日遊`);
  }

  return joinSearchKeyword(destination, keyword);
}

function hasPopularitySignal(place: TicketAffiliatePlaceInput, types: string[]): boolean {
  const rating = place.rating;
  const reviews = place.userRatingCount;
  const strong = hasStrongAttractionType(types);

  if (rating == null || reviews == null) {
    return strong || isAttractionAffiliateCategory(place.category) || isAttractionAffiliateCategory(place.placeType);
  }

  if (strong) {
    return rating >= POI_MIN_RATING && reviews >= POI_MIN_REVIEWS;
  }

  return rating >= 4.2 && reviews >= 1000;
}

function isGenericLocalPark(name: string, types: string[]): boolean {
  if (isFamousLandmarkName(name)) return false;
  if (types.some((t) => ["national_park", "state_park"].includes(t))) return false;
  if (GENERIC_LOCAL_PARK_RE.test(name)) return true;
  if (!types.includes("park")) return false;
  return /公園|公园|\bpark\b|\bgarden\b/i.test(name);
}

export function shouldShowTicketAffiliate(
  place: TicketAffiliatePlaceInput,
  tripContext?: TicketAffiliateTripContext,
): TicketAffiliateDecision {
  const name = placeDisplayName(place);
  const types = normalizeGoogleTypes(place);
  const destination = tripDestination(tripContext);
  const searchKeyword = buildTicketAffiliateSearchKeyword(place, tripContext);
  const categoryLabel = place.category?.trim() || place.placeType?.trim() || "";

  const logDecision = (show: boolean, reason: string): TicketAffiliateDecision => {
    console.info(
      `[TICKET_AFFILIATE_DECISION] placeName=${name} types=${types.join(",")} category=${categoryLabel} destination=${destination} show=${String(show)} reason=${reason} searchKeyword=${searchKeyword}`,
    );
    return { show, reason, searchKeyword };
  };

  if (!name) {
    return logDecision(false, "missing_name");
  }

  if (isFoodRetailLodgingDominant(place, types)) {
    return logDecision(false, "excluded_food_retail_lodging");
  }

  if (isGenericLocalPark(name, types)) {
    return logDecision(false, "excluded_generic_park");
  }

  if (hasHardExcludedType(types) && !hasStrongAttractionType(types) && !hasConditionalAttractionType(types)) {
    return logDecision(false, "excluded_default_type");
  }

  if (isFamousLandmarkName(name)) {
    return logDecision(true, "famous_landmark_whitelist");
  }

  if (hasTourismKeyword(name)) {
    return logDecision(true, "tourism_keyword");
  }

  if (hasTouristMarketKeyword(name)) {
    return logDecision(true, "tourist_market_keyword");
  }

  if (isAttractionAffiliateCategory(categoryLabel)) {
    return logDecision(true, "attraction_category_label");
  }

  if (hasStrongAttractionType(types)) {
    return logDecision(true, "strong_attraction_type");
  }

  if (hasConditionalAttractionType(types) && hasPopularitySignal(place, types)) {
    return logDecision(true, "conditional_type_with_popularity");
  }

  if (types.includes("point_of_interest") && (hasTourismKeyword(name) || isFamousLandmarkName(name))) {
    return logDecision(true, "poi_with_tourism_keyword");
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
