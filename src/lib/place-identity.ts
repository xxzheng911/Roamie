import { isDevVerboseLog } from "@/lib/dev-verbose-log";
import type { PlaceResult } from "@/lib/place-result";
import { isExplicitFoodMerchant } from "@/lib/place-category";

/** Roamie 推薦文案用：地點真實身分（優先於 UI 分類 chip） */
export type PlaceIdentity =
  | "shop"
  | "bookstore"
  | "breakfast_shop"
  | "cafe"
  | "bakery"
  | "dessert"
  | "restaurant"
  | "shopping_mall"
  | "department_store"
  | "tourist_attraction"
  | "museum"
  | "night_market"
  | "district"
  | "park"
  | "lodging"
  | "bar"
  | "food_stall"
  | "generic"
  | "unsupported";

export type PlaceIdentityInput = Pick<PlaceResult, "primaryType" | "name" | "address"> & {
  types?: string[] | null;
  primaryTypeDisplayName?: string | { text?: string; languageCode?: string } | null;
  type?: string;
  placeType?: string;
  category?: string;
  semanticCategory?: string;
  sourceCategory?: string;
  subtitle?: string;
};

/** 不生成文青旅遊文案，僅安全 fallback（不含零售購物類型） */
export const REASON_BLACKLIST_TYPES = [
  "car_repair",
  "car_dealer",
  "auto_parts_store",
  "motorcycle_dealer",
  "motorcycle_repair",
  "hardware_store",
  "warehouse_store",
  "wholesaler",
  "corporate_office",
  "office",
  "consultant",
  "insurance_agency",
  "real_estate_agency",
  "finance",
  "bank",
  "atm",
  "local_government_office",
  "city_hall",
  "lawyer",
  "accounting",
  "electrician",
  "plumber",
  "moving_company",
  "storage",
  "gas_station",
  "parking",
  "hospital",
  "doctor",
  "dentist",
  "pharmacy",
  "school",
  "university",
  "church",
  "funeral_home",
  "cemetery",
  "crematorium",
  "columbarium",
  "graveyard",
  "memorial_park",
  "mortuary",
] as const;

type Labels = [string, string, string, string];
type SemanticRule = { identity: PlaceIdentity; rank: number; labels?: Labels };
const SEMANTIC_TYPES: Record<string, SemanticRule> = {
  lodging: { identity: "lodging", rank: 30 },
  hotel: { identity: "lodging", rank: 80, labels: ["飯店", "hotel", "ホテル", "호텔"] },
  resort_hotel: {
    identity: "lodging",
    rank: 90,
    labels: ["度假飯店", "resort hotel", "リゾートホテル", "리조트 호텔"],
  },
  extended_stay_hotel: {
    identity: "lodging",
    rank: 90,
    labels: ["長住型飯店", "extended stay hotel", "長期滞在型ホテル", "장기 숙박 호텔"],
  },
  hostel: { identity: "lodging", rank: 80, labels: ["青年旅館", "hostel", "ホステル", "호스텔"] },
  motel: { identity: "lodging", rank: 80, labels: ["汽車旅館", "motel", "モーテル", "모텔"] },
  bed_and_breakfast: {
    identity: "lodging",
    rank: 80,
    labels: ["民宿", "bed and breakfast", "民宿", "민박"],
  },
  guest_house: {
    identity: "lodging",
    rank: 80,
    labels: ["旅館", "guest house", "ゲストハウス", "게스트하우스"],
  },
  brunch_restaurant: {
    identity: "restaurant",
    rank: 90,
    labels: ["早午餐店", "brunch restaurant", "ブランチ店", "브런치 식당"],
  },
  cafe: { identity: "cafe", rank: 90 },
  coffee_shop: { identity: "cafe", rank: 90 },
  cat_cafe: { identity: "cafe", rank: 90 },
  dog_cafe: { identity: "cafe", rank: 90 },
  cake_shop: {
    identity: "dessert",
    rank: 90,
    labels: ["蛋糕店", "cake shop", "ケーキ店", "케이크 가게"],
  },
  bakery: { identity: "bakery", rank: 80 },
  pastry_shop: { identity: "bakery", rank: 80 },
  dessert_shop: { identity: "dessert", rank: 80 },
  dessert_restaurant: { identity: "dessert", rank: 80 },
  confectionery: { identity: "dessert", rank: 80 },
  candy_store: { identity: "dessert", rank: 80 },
  ice_cream_shop: { identity: "dessert", rank: 80 },
  hot_pot_restaurant: {
    identity: "restaurant",
    rank: 100,
    labels: ["火鍋店", "hot pot restaurant", "火鍋店", "훠궈 식당"],
  },
  barbecue_restaurant: {
    identity: "restaurant",
    rank: 100,
    labels: ["燒肉餐廳", "barbecue restaurant", "焼肉店", "구이 식당"],
  },
  italian_restaurant: {
    identity: "restaurant",
    rank: 100,
    labels: ["義大利料理餐廳", "Italian restaurant", "イタリア料理店", "이탈리아 식당"],
  },
  ramen_restaurant: {
    identity: "restaurant",
    rank: 100,
    labels: ["拉麵店", "ramen restaurant", "ラーメン店", "라멘 가게"],
  },
  restaurant: { identity: "restaurant", rank: 30 },
  meal_takeaway: { identity: "restaurant", rank: 30 },
  meal_delivery: { identity: "restaurant", rank: 30 },
  breakfast_restaurant: { identity: "breakfast_shop", rank: 90 },
  food_stall: { identity: "food_stall", rank: 90 },
  street_food: { identity: "food_stall", rank: 90 },
  snack_bar: { identity: "food_stall", rank: 90 },
  food_truck: { identity: "food_stall", rank: 90 },
  vendor: { identity: "food_stall", rank: 90 },
  bar: { identity: "bar", rank: 80 },
  wine_bar: { identity: "bar", rank: 80 },
  cocktail_bar: { identity: "bar", rank: 80 },
  night_club: { identity: "bar", rank: 80 },
  pub: { identity: "bar", rank: 80 },
  book_store: { identity: "bookstore", rank: 90 },
  bookstore: { identity: "bookstore", rank: 90 },
  library: { identity: "bookstore", rank: 90 },
  museum: { identity: "museum", rank: 90 },
  art_museum: { identity: "museum", rank: 90 },
  history_museum: { identity: "museum", rank: 90 },
  art_gallery: { identity: "museum", rank: 80 },
  planetarium: { identity: "museum", rank: 90 },
  observation_deck: {
    identity: "tourist_attraction",
    rank: 90,
    labels: ["展望台", "observation deck", "展望台", "전망대"],
  },
  buddhist_temple: {
    identity: "tourist_attraction",
    rank: 90,
    labels: ["佛教寺廟", "Buddhist temple", "仏教寺院", "불교 사찰"],
  },
  hindu_temple: {
    identity: "tourist_attraction",
    rank: 90,
    labels: ["印度教寺廟", "Hindu temple", "ヒンドゥー寺院", "힌두교 사원"],
  },
  temple: { identity: "tourist_attraction", rank: 90, labels: ["寺廟", "temple", "寺院", "사원"] },
  shopping_mall: { identity: "shopping_mall", rank: 80 },
  shopping_center: { identity: "shopping_mall", rank: 80 },
  department_store: { identity: "department_store", rank: 90 },
  park: { identity: "park", rank: 80 },
  city_park: { identity: "park", rank: 80 },
  national_park: { identity: "park", rank: 80 },
  state_park: { identity: "park", rank: 80 },
  botanical_garden: { identity: "park", rank: 80 },
  hiking_area: { identity: "park", rank: 80 },
  tourist_attraction: { identity: "tourist_attraction", rank: 30 },
  historical_landmark: { identity: "tourist_attraction", rank: 50 },
  monument: { identity: "tourist_attraction", rank: 50 },
  cultural_center: { identity: "tourist_attraction", rank: 50 },
  night_market: { identity: "night_market", rank: 80 },
  district: { identity: "district", rank: 40 },
  market: { identity: "district", rank: 40 },
  flea_market: { identity: "district", rank: 40 },
  gift_shop: { identity: "shop", rank: 40 },
  store: { identity: "shop", rank: 10 },
  food_store: { identity: "shop", rank: 15 },
  food: { identity: "restaurant", rank: 5, labels: ["餐飲店", "food venue", "飲食店", "음식점"] },
};
const CATEGORY_ALIASES: Record<string, string> = {
  酒吧: "bar",
  飯店: "hotel",
  ホテル: "hotel",
  バー: "bar",
  旅館: "lodging",
  咖啡: "cafe",
  咖啡廳: "cafe",
  咖啡館: "cafe",
  烘焙: "bakery",
  烘焙店: "bakery",
  蛋糕店: "cake_shop",
  蛋糕專賣店: "cake_shop",
  甜點: "dessert_shop",
  甜點店: "dessert_shop",
  餐廳: "restaurant",
  美食: "restaurant",
  商店: "store",
  禮品店: "gift_shop",
  景點: "tourist_attraction",
  展望台: "observation_deck",
  博物館: "museum",
  公園: "park",
  寺廟: "temple",
  購物中心: "shopping_mall",
  商圈: "district",
};
function normalizeType(type: string): string {
  return type.trim().toLowerCase().replace(/\s+/g, "_");
}
export function collectPlaceTypes(place: PlaceIdentityInput): string[] {
  return [
    ...new Set(
      [...(place.types ?? []), place.primaryType ?? ""]
        .filter((t) => typeof t === "string")
        .map(normalizeType)
        .filter(Boolean),
    ),
  ].sort();
}
function placeBlob(place: PlaceIdentityInput): string {
  return place.name ?? "";
}
function ruleFor(type: string): SemanticRule | undefined {
  return (
    SEMANTIC_TYPES[type] ??
    (type.endsWith("_restaurant")
      ? { identity: "restaurant", rank: 50 }
      : type.endsWith("_store")
        ? { identity: "shop", rank: 20 }
        : undefined)
  );
}
type CandidateEvidence = {
  semanticType: string;
  source: string[];
  specificity: "generic" | "specific";
  role: "business_identity" | "meal_service_attribute";
  confidence: "primary" | "display" | "category" | "supporting" | "base";
  compatibilityEvidence: string[];
};
export type PlaceIdentityDecision = {
  identity: PlaceIdentity;
  selectedSemanticType: string;
  candidateSemanticTypes: string[];
  candidates: CandidateEvidence[];
  selectionSource: string;
  selectionReason: string;
  fallbackReason: string;
};
const MEAL_TYPES = new Set(["breakfast_restaurant", "brunch_restaurant"]);
/** Broad identities may be refined only within their compatible semantic family. */
function refines(type: string, broad: string): boolean {
  if (type === broad || MEAL_TYPES.has(type)) return false;
  const identity = ruleFor(type)?.identity;
  if (
    ["bakery", "confectionery", "candy_store", "dessert_shop", "food_store"].includes(broad) &&
    type === "cake_shop"
  )
    return true;
  if (broad === "lodging") return identity === "lodging";
  if (broad === "hotel") return ["resort_hotel", "extended_stay_hotel"].includes(type);
  if (["store", "food_store", "gift_shop"].includes(broad))
    return (
      ["bakery", "dessert", "shop", "bookstore"].includes(identity ?? "") &&
      (ruleFor(type)?.rank ?? 0) > (ruleFor(broad)?.rank ?? 0)
    );
  if (["food", "restaurant", "meal_delivery", "meal_takeaway"].includes(broad))
    return (
      ["restaurant", "cafe", "bakery", "dessert", "bar", "food_stall"].includes(identity ?? "") &&
      (ruleFor(type)?.rank ?? 0) > (ruleFor(broad)?.rank ?? 0)
    );
  if (broad === "tourist_attraction")
    return (
      ["tourist_attraction", "museum", "park"].includes(identity ?? "") &&
      (ruleFor(type)?.rank ?? 0) > 30
    );
  return false;
}
function semanticValue(value?: string | null): string {
  return value ? (CATEGORY_ALIASES[value] ?? normalizeType(value)) : "";
}
/** Authority resolves competing specific identities; specificity only refines broad evidence. */
export function classifyPlaceIdentity(place: PlaceIdentityInput): PlaceIdentityDecision {
  const types = collectPlaceTypes(place);
  const primary = semanticValue(place.primaryType);
  const display = semanticValue(
    typeof place.primaryTypeDisplayName === "string"
      ? place.primaryTypeDisplayName
      : place.primaryTypeDisplayName?.text,
  );
  const name = [place.name, place.subtitle].filter(Boolean).join(" ");
  const food = types.some((t) =>
    ["food", "store", "food_store", "restaurant", "cafe", "bakery"].includes(t),
  );
  const restaurant = types.some((t) => t === "restaurant" || t.endsWith("_restaurant"));
  const attraction = types.includes("tourist_attraction");
  const hints: Array<[boolean, string]> = [
    [restaurant && /火鍋|鍋物|\bhot pot\b/i.test(name), "hot_pot_restaurant"],
    [restaurant && /燒肉|焼肉|yakiniku/i.test(name), "barbecue_restaurant"],
    [restaurant && /義大利|義式|義大利麵|\bpasta\b/i.test(name), "italian_restaurant"],
    [restaurant && /拉麵|\bramen\b/i.test(name), "ramen_restaurant"],
    [food && /烘焙|麵包|\bbakery\b/i.test(name), "bakery"],
    [food && /咖啡|\b(?:cafe\b|café(?:$|\s))/i.test(name), "cafe"],
    [food && /蛋糕|\bcake\b/i.test(name), "cake_shop"],
    [food && /甜點|\bdessert\b/i.test(name), "dessert_shop"],
    [attraction && /展望台|觀景台|觀景臺/.test(name), "observation_deck"],
    [attraction && /寺|廟/.test(name), "temple"],
    [
      types.some((t) => ["market", "food", "tourist_attraction"].includes(t)) && /夜市/.test(name),
      "night_market",
    ],
    [
      types.some((t) => ruleFor(t)?.identity === "bar") && /\b(bar|pub|lounge)\b|酒吧/i.test(name),
      "bar",
    ],
    [
      types.some((t) => ruleFor(t)?.identity === "lodging") && /\bhotel\b|飯店|ホテル/i.test(name),
      "hotel",
    ],
  ];

  const known = types.map(semanticValue).filter((t) => ruleFor(t));
  const compatible = (t: string) =>
    !known.some((k) => (ruleFor(k)?.rank ?? 0) > 15) || known.some((k) => k === t || refines(t, k));
  const categories = [
    place.sourceCategory,
    place.semanticCategory,
    place.category,
    place.type,
    place.placeType,
  ]
    .map(semanticValue)
    .filter((t) => ruleFor(t) && compatible(t));
  const supportedHints = hints
    .filter(
      ([matches, type]) =>
        matches &&
        compatible(type) &&
        (known.includes(type) ||
          known.every((k) => (ruleFor(k)?.rank ?? 0) <= 30 || refines(type, k))),
    )
    .map(([, type]) => type);
  const all = [
    ...new Set([
      ...known,
      ...(ruleFor(primary) ? [primary] : []),
      ...(ruleFor(display) ? [display] : []),
      ...categories,
      ...supportedHints,
    ]),
  ].sort();
  const candidates: CandidateEvidence[] = all.map((type) => {
    const sources = [
      type === primary && "provider_primary_type",
      type === display && "provider_display_name",
      type === categories[0] && "normalized_category",
      supportedHints.includes(type) && "compatible_name_hint",
      known.includes(type) && "provider_types",
    ].filter(Boolean) as string[];
    return {
      semanticType: type,
      source: sources,
      specificity: (ruleFor(type)?.rank ?? 0) <= 30 ? "generic" : "specific",
      role: MEAL_TYPES.has(type) ? "meal_service_attribute" : "business_identity",
      confidence:
        type === primary
          ? "primary"
          : type === display
            ? "display"
            : categories.includes(type)
              ? "category"
              : supportedHints.includes(type)
                ? "supporting"
                : "base",
      compatibilityEvidence: [
        ...types.filter((t) => t === type || refines(type, t)),
        ...(supportedHints.includes(type) ? ["compatible_name_or_subtitle"] : []),
      ],
    };
  });
  const result = (
    type: string,
    source: string,
    explanation: string,
    fallbackReason = "",
  ): PlaceIdentityDecision => ({
    identity: ruleFor(type)?.identity ?? (type === "unsupported" ? "unsupported" : "generic"),
    selectedSemanticType: type,
    candidateSemanticTypes: all,
    candidates,
    selectionSource: source,
    selectionReason: explanation,
    fallbackReason,
  });
  if (
    !known.some((t) => (ruleFor(t)?.rank ?? 0) > 15) &&
    types.some((t) => (REASON_BLACKLIST_TYPES as readonly string[]).includes(t))
  )
    return result(
      "unsupported",
      "provider_type",
      "Unsupported provider business",
      "unsupported_business_type",
    );
  let eligible = all;
  // Broad primary evidence constrains subsequent disambiguation to compatible refinements.
  for (const [type, source] of [
    [primary, "provider_primary_type"],
    [display, "provider_display_name"],
    [categories[0], "normalized_category"],
  ]) {
    if (!type || !eligible.includes(type)) continue;
    const refinements = eligible.filter((other) => refines(other, type));
    const specificPrimary = ruleFor(type)!.rank > 30 && !["gift_shop", "hotel"].includes(type);
    if (specificPrimary || !refinements.length) {
      if (ruleFor(type)!.rank <= 15 && eligible.some((t) => ruleFor(t)!.rank > 15)) continue;
      return result(type, source, "Highest available explicit identity authority");
    }
    eligible = refinements;
  }
  const hint = supportedHints.find(
    (t) => eligible.includes(t) && !eligible.some((other) => refines(other, t)),
  );
  if (hint)
    return result(hint, "compatible_name_hint", "Provider-compatible name/subtitle disambiguation");
  let pool = eligible.filter((t) => !eligible.some((other) => refines(other, t)));
  if (pool.some((t) => !MEAL_TYPES.has(t) && (ruleFor(t)?.rank ?? 0) > 15))
    pool = pool.filter((t) => !MEAL_TYPES.has(t));
  // Specificity removes generic evidence only. Unresolved peers use a stable lexical tie, not enum ranks.
  if (pool.some((t) => (ruleFor(t)?.rank ?? 0) > 30))
    pool = pool.filter((t) => (ruleFor(t)?.rank ?? 0) > 30);
  if (pool.length)
    return result(
      pool[0],
      "provider_types",
      "Compatible refinement; meal attributes secondary; unresolved peers use stable lexical order",
      pool.length > 1 ? "ambiguous_specific_candidates" : "",
    );
  return result(
    "generic",
    "fallback",
    "No supported identity",
    "no_recognized_compatible_identity_evidence",
  );
}
export function resolvePlaceIdentity(place: PlaceIdentityInput): PlaceIdentity {
  return classifyPlaceIdentity(place).identity;
}

export function identityDisplayLabel(identity: PlaceIdentity, place?: PlaceIdentityInput): string {
  const blob = place ? placeBlob(place) : "";
  if (place) {
    if (identity === "food_stall" || identity === "restaurant") {
      if (/宵夜|深夜|夜食/i.test(blob)) return "宵夜";
    }
    if (identity === "bar" && isExplicitFoodMerchant(place)) {
      return /宵夜|深夜/i.test(blob) ? "宵夜" : "美食";
    }
  }

  const labels: Record<PlaceIdentity, string> = {
    lodging: "旅館",
    shop: "商店",
    bookstore: "書店",
    breakfast_shop: "早餐",
    cafe: "咖啡廳",
    bakery: "烘焙",
    dessert: "甜點",
    restaurant: "美食",
    shopping_mall: "購物中心",
    department_store: "商圈",
    tourist_attraction: "景點",
    museum: "博物館",
    night_market: "夜市",
    district: "商圈",
    park: "公園",
    bar: "酒吧",
    food_stall: "小吃",
    generic: "地點",
    unsupported: "地點",
  };
  return labels[identity];
}

const IDENTITY_REASON_LABELS: Record<PlaceIdentity, [string, string, string, string]> = {
  lodging: ["旅館", "lodging", "宿泊施設", "숙소"],
  shop: ["商店", "shop", "店舗", "상점"],
  cafe: ["咖啡廳", "café", "カフェ", "카페"],
  restaurant: ["餐廳", "restaurant", "飲食店", "식당"],
  bookstore: ["書店", "bookstore", "書店", "서점"],
  breakfast_shop: ["早餐店", "breakfast shop", "朝食店", "아침 식사점"],
  bakery: ["烘焙店", "bakery", "ベーカリー", "베이커리"],
  dessert: ["甜點店", "dessert shop", "スイーツ店", "디저트 가게"],
  shopping_mall: ["購物中心", "shopping center", "ショッピングセンター", "쇼핑센터"],
  department_store: ["百貨公司", "department store", "百貨店", "백화점"],
  tourist_attraction: ["景點", "attraction", "観光スポット", "관광 명소"],
  museum: ["博物館", "museum", "博物館", "박물관"],
  night_market: ["夜市", "night market", "夜市", "야시장"],
  district: ["商圈", "shopping district", "商店街", "상업 지구"],
  park: ["公園", "park", "公園", "공원"],
  bar: ["酒吧", "bar", "バー", "바"],
  food_stall: ["小吃店", "food stall", "軽食店", "간식 가게"],
  generic: ["地點", "place", "場所", "장소"],
  unsupported: ["地點", "place", "場所", "장소"],
};

/** More specific prose identity; UI category intent never supplies Place facts. */
export function recommendationPlaceType(
  place: PlaceIdentityInput,
  surface = "canonical_identity",
): [string, string, string, string] {
  const decision = classifyPlaceIdentity(place);
  const base = decision.identity;
  const specific = ruleFor(decision.selectedSemanticType)?.labels;
  if (specific) {
    emitPlaceIdentityTrace(place, decision, specific[0], surface);
    return specific;
  }
  if (base === "cafe" && /景觀咖啡/.test(place.name ?? ""))
    return ["景觀咖啡廳", "scenic café", "展望カフェ", "전망 카페"];
  const labels = IDENTITY_REASON_LABELS;
  emitPlaceIdentityTrace(place, decision, labels[base][0], surface);
  return labels[base];
}

/** Missing/generic enrichment cannot erase a known specific provider identity. */
export function mergePlaceIdentityFields(
  existing: Partial<PlaceResult>,
  enriched: Partial<PlaceResult>,
) {
  const incoming = collectPlaceTypes({
    name: enriched.name ?? "",
    primaryType: enriched.primaryType ?? null,
    address: null,
    types: enriched.types,
  });
  const hasSpecific = incoming.some(
    (t) =>
      (ruleFor(t)?.rank ?? 0) > 15 || (REASON_BLACKLIST_TYPES as readonly string[]).includes(t),
  );
  return {
    primaryType: hasSpecific
      ? (enriched.primaryType ?? existing.primaryType ?? null)
      : (existing.primaryType ?? enriched.primaryType ?? null),
    types: hasSpecific
      ? enriched.types?.length
        ? enriched.types
        : existing.types
      : [...new Set([...(existing.types ?? []), ...(enriched.types ?? [])])],
    primaryTypeDisplayName: enriched.primaryTypeDisplayName ?? existing.primaryTypeDisplayName,
    rawTypes: enriched.rawTypes ?? existing.rawTypes,
  };
}
export function buildPlaceIdentityTrace(
  place: PlaceIdentityInput & { id?: string; rawTypes?: string[] },
  surface = "canonical_identity",
) {
  const decision = classifyPlaceIdentity(place);
  return {
    placeId: place.id ?? "",
    placeName: place.name,
    surface,
    rawTypes: place.rawTypes ?? place.types ?? [],
    normalizedTypes: collectPlaceTypes(place),
    primaryType: place.primaryType,
    primaryTypeDisplayName: place.primaryTypeDisplayName ?? null,
    existingCategory:
      place.category ?? place.semanticCategory ?? place.type ?? place.placeType ?? null,
    sourceCategory: place.sourceCategory ?? null,
    nameEvidence: { name: place.name, subtitle: place.subtitle ?? null },
    providerDisplayEvidence: place.primaryTypeDisplayName ?? null,
    ...decision,
    finalIdentityLabel:
      ruleFor(decision.selectedSemanticType)?.labels?.[0] ??
      IDENTITY_REASON_LABELS[decision.identity][0],
  };
}
const identityTraces = new Map<string, string>();
function emitPlaceIdentityTrace(
  place: PlaceIdentityInput,
  decision: PlaceIdentityDecision,
  label: string,
  surface: string,
): void {
  const id = (place as Partial<PlaceResult>).id ?? "";
  let scoped = false;
  try {
    scoped =
      typeof localStorage !== "undefined" &&
      localStorage.getItem("roamie:identity-trace-place-id") === id;
  } catch {
    /* unavailable storage */
  }
  if (!scoped && !isDevVerboseLog()) return;
  const trace = {
    ...buildPlaceIdentityTrace(place, surface),
    ...decision,
    finalIdentityLabel: label,
  };
  const key = `${id}|${surface}`,
    serialized = JSON.stringify(trace);
  if (identityTraces.get(key) === serialized) return;
  if (identityTraces.size >= 120) identityTraces.delete(identityTraces.keys().next().value!);
  identityTraces.set(key, serialized);
  console.info("[PLACE_IDENTITY_TRACE]", trace);
}
