import type { ChatShortcutScene } from "@/lib/ai/chat-intent";
import type { PlaceResult } from "@/lib/place-result";
import {
  isRecommendablePlace,
  recommendationToRecommendableInput,
} from "@/lib/is-recommendable-place";
import { isResidentialPlace } from "@/lib/ai/residential-place";

export type NearbyShortcutPlaceKind =
  | "park"
  | "garden"
  | "nature"
  | "walking"
  | "scenic"
  | "art_gallery"
  | "museum"
  | "cultural_center"
  | "observation"
  | "waterfront"
  | "temple"
  | "shrine"
  | "church"
  | "mosque"
  | "religious"
  | "cafe"
  | "coffee_shop"
  | "espresso_bar"
  | "roastery"
  | "tea_house"
  | "dessert_cafe"
  | "brunch_cafe"
  | "bakery"
  | "bookstore"
  | "library"
  | "shopping_mall"
  | "aquarium"
  | "indoor"
  | "trail"
  | "bridge"
  | "other";

type PlaceTypeMeta = {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  category?: string | null;
};

const RELAX_WEIGHTS: Record<NearbyShortcutPlaceKind, number> = {
  park: 100,
  garden: 95,
  nature: 90,
  walking: 85,
  scenic: 85,
  waterfront: 80,
  art_gallery: 80,
  museum: 75,
  cultural_center: 75,
  observation: 70,
  cafe: 0,
  coffee_shop: 0,
  espresso_bar: 0,
  roastery: 0,
  tea_house: 0,
  dessert_cafe: 0,
  brunch_cafe: 0,
  bakery: 0,
  bookstore: 10,
  library: 10,
  shopping_mall: 0,
  aquarium: 20,
  indoor: 10,
  trail: 60,
  bridge: 20,
  temple: -80,
  shrine: -80,
  church: -80,
  mosque: -80,
  religious: -80,
  other: 0,
};

const COFFEE_WEIGHTS: Record<NearbyShortcutPlaceKind, number> = {
  cafe: 100,
  coffee_shop: 100,
  espresso_bar: 95,
  roastery: 90,
  tea_house: 80,
  dessert_cafe: 40,
  brunch_cafe: 30,
  bakery: 20,
  park: -200,
  garden: -200,
  nature: -200,
  walking: -200,
  scenic: -160,
  waterfront: -160,
  art_gallery: -200,
  museum: -200,
  cultural_center: -160,
  observation: -160,
  bookstore: -40,
  library: -40,
  shopping_mall: -80,
  aquarium: -200,
  indoor: -40,
  trail: -200,
  bridge: -200,
  temple: -200,
  shrine: -200,
  church: -200,
  mosque: -200,
  religious: -200,
  other: -80,
};

const RAINY_WEIGHTS: Record<NearbyShortcutPlaceKind, number> = {
  museum: 100,
  art_gallery: 95,
  cafe: 90,
  coffee_shop: 90,
  espresso_bar: 85,
  roastery: 80,
  tea_house: 80,
  dessert_cafe: 70,
  brunch_cafe: 65,
  bakery: 55,
  bookstore: 85,
  library: 85,
  shopping_mall: 80,
  aquarium: 80,
  indoor: 75,
  cultural_center: 70,
  observation: 10,
  scenic: -20,
  waterfront: -40,
  garden: -70,
  park: -80,
  nature: -80,
  walking: -70,
  trail: -80,
  bridge: -60,
  temple: -70,
  shrine: -70,
  church: -20,
  mosque: -20,
  religious: -50,
  other: 0,
};

export const COFFEE_PRIMARY_TYPES = [
  "cafe",
  "coffee_shop",
  "espresso_bar",
  "coffee_roaster",
  "roastery",
  "tea_house",
  "tea_shop",
] as const;

export const COFFEE_FALLBACK_TYPES = [
  "bakery",
  "dessert_shop",
  "confectionery",
] as const;

export const COFFEE_BLOCKED_TYPES = [
  "park",
  "garden",
  "bridge",
  "museum",
  "art_gallery",
  "tourist_attraction",
  "hiking_area",
  "national_park",
] as const;

export const RELAX_PREFERRED_TYPES = [
  "park",
  "garden",
  "national_park",
  "botanical_garden",
  "museum",
  "art_gallery",
  "cultural_center",
  "observation_deck",
] as const;

export const RAINY_PREFERRED_TYPES = [
  "museum",
  "art_gallery",
  "cafe",
  "coffee_shop",
  "book_store",
  "library",
  "shopping_mall",
  "aquarium",
] as const;

export const RAINY_DEPRIORITIZED_TYPES = [
  "park",
  "hiking_area",
  "campground",
  "national_park",
  "garden",
] as const;

const RELIGIOUS_TYPES = new Set([
  "place_of_worship",
  "temple",
  "hindu_temple",
  "buddhist_temple",
  "church",
  "mosque",
  "synagogue",
  "shrine",
  "cemetery",
]);

const PARK_TYPES = new Set([
  "park",
  "city_park",
  "national_park",
  "dog_park",
]);

const GARDEN_TYPES = new Set([
  "garden",
  "botanical_garden",
]);

const NATURE_TYPES = new Set([
  "natural_feature",
  "campground",
  "forest",
  "nature_reserve",
]);

const WALKING_TYPES = new Set([
  "promenade",
  "plaza",
  "town_square",
]);

const SCENIC_TYPES = new Set([
  "scenic_spot",
  "scenic_lookout",
]);

const WATERFRONT_TYPES = new Set([
  "marina",
  "beach",
  "waterfront",
  "harbor",
]);

const CULTURAL_TYPES = new Set([
  "cultural_center",
  "cultural_landmark",
  "performing_arts_theater",
  "visitor_center",
]);

const INDOOR_TYPES = new Set([
  "movie_theater",
  "bowling_alley",
  "spa",
  "department_store",
  "shopping_mall",
  "aquarium",
  "library",
  "book_store",
]);

const COFFEE_PRIMARY_NAME_RE =
  /咖啡|珈琲|カフェ|café|cafe|coffee|espresso|roaster|roastery|specialty\s*coffee|茶館|茶屋|茶寮|teahouse|tea\s*house/i;
const DESSERT_CAFE_NAME_RE = /甜點|甜点|dessert|蛋糕|patisserie|下午茶/i;
const BRUNCH_CAFE_NAME_RE = /早午餐|brunch/i;
const BAKERY_NAME_RE = /烘焙|bakery|麵包|面包|パン/i;
const RELIGIOUS_NAME_RE = /寺|廟|庵|神社|教堂|清真寺|禮拜堂|礼拜堂|shrine|temple|church|mosque|place of worship/i;
const PARK_NAME_RE = /公園|花园|花園|植物園|森林公園|綠地|绿地/i;
const NATURE_NAME_RE = /森林|步道|登山|濕地|湿地|自然|生態|生态/i;
const WALKING_NAME_RE = /散步|河岸|河濱|河滨|林蔭|林荫|綠廊|绿廊/i;
const SCENIC_NAME_RE = /觀景|观景|展望|夜景|scenic/i;
const WATERFRONT_NAME_RE = /河岸|港邊|港边|水岸|海濱|海滨|湖濱|湖滨|waterfront/i;
const GALLERY_NAME_RE = /美術|艺廊|藝廊|画廊|畫廊|gallery/i;
const MUSEUM_NAME_RE = /博物|科博|美術館|美术馆|museum/i;
const CULTURAL_NAME_RE = /文化中心|藝文|艺文|人文空間|人文空间|文創|文创/i;
const OBSERVATION_NAME_RE = /觀景台|观景台|展望台|observation/i;
const BRIDGE_NAME_RE = /橋|桥|bridge/i;
const TRAIL_NAME_RE = /步道|登山|健行|trail|hiking/i;
const BOOKSTORE_NAME_RE = /書店|书局|書局|bookstore|book\s*shop/i;
const LIBRARY_NAME_RE = /圖書館|图书馆|library/i;
const MALL_NAME_RE = /百貨|商场|商場|shopping\s*mall|department/i;
const AQUARIUM_NAME_RE = /水族|aquarium/i;
const INDOOR_NAME_RE = /室內|室内|indoor/i;

export function normalizedShortcutTypes(place: PlaceTypeMeta): string[] {
  return [place.primaryType ?? "", ...(place.types ?? [])]
    .map((type) => type.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean);
}

export function classifyNearbyShortcutPlaceKind(
  place: PlaceTypeMeta,
): NearbyShortcutPlaceKind {
  // Residential metadata is authoritative; never let a name such as
  // 「京城國家美術館」override it into the museum family.
  if (isResidentialPlace(place)) return "other";
  const types = new Set(normalizedShortcutTypes(place));
  const name = (place.name ?? "").trim();

  if (types.has("mosque") || /清真寺|mosque/i.test(name)) return "mosque";
  if (types.has("church") || /教堂|教會|教会|church/i.test(name)) return "church";
  if (types.has("shrine") || /神社|shrine/i.test(name)) return "shrine";
  if (
    types.has("temple") ||
    types.has("hindu_temple") ||
    types.has("buddhist_temple") ||
    /寺|廟|庵/.test(name)
  ) {
    return "temple";
  }
  if (
    [...types].some((type) => RELIGIOUS_TYPES.has(type)) ||
    RELIGIOUS_NAME_RE.test(name)
  ) {
    return "religious";
  }

  if (types.has("espresso_bar") || /espresso/i.test(name)) return "espresso_bar";
  if (types.has("coffee_roaster") || types.has("roastery") || /roaster|焙煎/i.test(name)) {
    return "roastery";
  }
  if (types.has("tea_house") || types.has("tea_shop") || /茶館|茶屋|茶寮|teahouse/i.test(name)) {
    return "tea_house";
  }
  if (types.has("coffee_shop")) return "coffee_shop";
  if (types.has("cafe") || (/咖啡|cafe|coffee/i.test(name) && !MUSEUM_NAME_RE.test(name))) {
    if (DESSERT_CAFE_NAME_RE.test(name)) return "dessert_cafe";
    if (BRUNCH_CAFE_NAME_RE.test(name)) return "brunch_cafe";
    return "cafe";
  }
  if (types.has("bakery") || BAKERY_NAME_RE.test(name)) return "bakery";
  if (DESSERT_CAFE_NAME_RE.test(name) && COFFEE_PRIMARY_NAME_RE.test(name)) return "dessert_cafe";
  if (BRUNCH_CAFE_NAME_RE.test(name) && COFFEE_PRIMARY_NAME_RE.test(name)) return "brunch_cafe";

  if (types.has("museum") || /博物|美術館|美术馆|museum/i.test(name)) return "museum";
  if (types.has("art_gallery") || (GALLERY_NAME_RE.test(name) && !/咖啡/.test(name))) {
    return "art_gallery";
  }
  if ([...types].some((type) => CULTURAL_TYPES.has(type)) || CULTURAL_NAME_RE.test(name)) {
    return "cultural_center";
  }
  if (types.has("observation_deck") || OBSERVATION_NAME_RE.test(name)) return "observation";
  if ([...types].some((type) => GARDEN_TYPES.has(type)) || /花園|花园|植物園/.test(name)) {
    return "garden";
  }
  if ([...types].some((type) => PARK_TYPES.has(type)) || PARK_NAME_RE.test(name)) return "park";
  if ([...types].some((type) => NATURE_TYPES.has(type)) || NATURE_NAME_RE.test(name)) {
    return "nature";
  }
  if (TRAIL_NAME_RE.test(name) || types.has("hiking_area")) return "trail";
  if ([...types].some((type) => WATERFRONT_TYPES.has(type)) || WATERFRONT_NAME_RE.test(name)) {
    return "waterfront";
  }
  if ([...types].some((type) => SCENIC_TYPES.has(type)) || SCENIC_NAME_RE.test(name)) {
    return "scenic";
  }
  if ([...types].some((type) => WALKING_TYPES.has(type)) || WALKING_NAME_RE.test(name)) {
    return "walking";
  }
  if (types.has("bridge") || BRIDGE_NAME_RE.test(name)) return "bridge";
  if (types.has("book_store") || BOOKSTORE_NAME_RE.test(name)) return "bookstore";
  if (types.has("library") || LIBRARY_NAME_RE.test(name)) return "library";
  if (types.has("shopping_mall") || types.has("department_store") || MALL_NAME_RE.test(name)) {
    return "shopping_mall";
  }
  if (types.has("aquarium") || AQUARIUM_NAME_RE.test(name)) return "aquarium";
  if ([...types].some((type) => INDOOR_TYPES.has(type)) || INDOOR_NAME_RE.test(name)) {
    return "indoor";
  }

  return "other";
}

export function shortcutSceneRankScore(
  scene: ChatShortcutScene | null | undefined,
  place: PlaceTypeMeta,
): number {
  if (!scene) return 0;
  const kind = classifyNearbyShortcutPlaceKind(place);
  if (scene === "relax_walk") return RELAX_WEIGHTS[kind];
  if (scene === "quiet_cafe") return COFFEE_WEIGHTS[kind];
  return RAINY_WEIGHTS[kind];
}

export function isCoffeePrimaryPlace(place: PlaceTypeMeta): boolean {
  const kind = classifyNearbyShortcutPlaceKind(place);
  return (
    kind === "cafe" ||
    kind === "coffee_shop" ||
    kind === "espresso_bar" ||
    kind === "roastery" ||
    kind === "tea_house"
  );
}

export function isCoffeeFallbackPlace(place: PlaceTypeMeta): boolean {
  const kind = classifyNearbyShortcutPlaceKind(place);
  return kind === "dessert_cafe" || kind === "brunch_cafe" || kind === "bakery";
}

export function isCoffeeBlockedPlace(place: PlaceTypeMeta): boolean {
  const kind = classifyNearbyShortcutPlaceKind(place);
  return (
    kind === "park" ||
    kind === "garden" ||
    kind === "nature" ||
    kind === "trail" ||
    kind === "bridge" ||
    kind === "museum" ||
    kind === "art_gallery" ||
    kind === "aquarium"
  );
}

export function isRainyPreferredPlace(place: PlaceTypeMeta): boolean {
  const kind = classifyNearbyShortcutPlaceKind(place);
  return (
    kind === "museum" ||
    kind === "art_gallery" ||
    kind === "cafe" ||
    kind === "coffee_shop" ||
    kind === "espresso_bar" ||
    kind === "roastery" ||
    kind === "tea_house" ||
    kind === "dessert_cafe" ||
    kind === "brunch_cafe" ||
    kind === "bakery" ||
    kind === "bookstore" ||
    kind === "library" ||
    kind === "shopping_mall" ||
    kind === "aquarium" ||
    kind === "indoor" ||
    kind === "cultural_center"
  );
}

export function isReligiousShortcutPlace(place: PlaceTypeMeta): boolean {
  const kind = classifyNearbyShortcutPlaceKind(place);
  return (
    kind === "temple" ||
    kind === "shrine" ||
    kind === "church" ||
    kind === "mosque" ||
    kind === "religious"
  );
}

export function coffeeCandidateExcludeReason(place: PlaceTypeMeta): string {
  if (isCoffeePrimaryPlace(place) || isCoffeeFallbackPlace(place)) return "";
  if (isCoffeeBlockedPlace(place)) {
    return `blocked_non_coffee:${classifyNearbyShortcutPlaceKind(place)}`;
  }
  return `not_coffee:${classifyNearbyShortcutPlaceKind(place)}`;
}

export type ShortcutRankBreakdown = {
  placeName: string;
  primaryType: string;
  secondaryTypes: string;
  matchedCategories: NearbyShortcutPlaceKind;
  shortcutWeight: number;
  ratingScore: number;
  distancePenalty: number;
  attractionScore: number;
  finalScore: number;
  passedCandidateFilter: boolean;
  excludeReason: string;
  rankingIndex: number;
};

export function buildShortcutRankBreakdown(
  place: PlaceTypeMeta & {
    rating?: number | null;
    userRatingCount?: number | null;
    lat?: number | null;
    lng?: number | null;
  },
  scene: ChatShortcutScene,
  opts?: {
    origin?: { lat: number; lng: number };
    distanceMetersFn?: (
      a: { lat: number; lng: number },
      b: { lat: number; lng: number },
    ) => number;
    passedCandidateFilter?: boolean;
    excludeReason?: string;
    rankingIndex?: number;
  },
): ShortcutRankBreakdown {
  const kind = classifyNearbyShortcutPlaceKind(place);
  const shortcutWeight = shortcutSceneRankScore(scene, place);
  const ratingScore =
    (place.rating ?? 0) * Math.log10((place.userRatingCount ?? 0) + 10);
  let distancePenalty = 0;
  if (
    opts?.origin &&
    opts.distanceMetersFn &&
    place.lat != null &&
    place.lng != null
  ) {
    distancePenalty =
      opts.distanceMetersFn(opts.origin, { lat: place.lat, lng: place.lng }) / 50_000;
  }
  const passed =
    opts?.passedCandidateFilter ??
    (scene === "quiet_cafe"
      ? isCoffeePrimaryPlace(place) || isCoffeeFallbackPlace(place)
      : true);
  return {
    placeName: place.name ?? "",
    primaryType: place.primaryType ?? "",
    secondaryTypes: (place.types ?? []).join(","),
    matchedCategories: kind,
    shortcutWeight,
    ratingScore: Number(ratingScore.toFixed(4)),
    distancePenalty: Number(distancePenalty.toFixed(4)),
    attractionScore: 0,
    finalScore: Number((ratingScore - distancePenalty + shortcutWeight).toFixed(4)),
    passedCandidateFilter: passed,
    excludeReason: opts?.excludeReason ?? (passed ? "" : coffeeCandidateExcludeReason(place)),
    rankingIndex: opts?.rankingIndex ?? -1,
  };
}

export function pickShortcutTopPlaces<T extends PlaceTypeMeta>(
  places: T[],
  scene: ChatShortcutScene,
  count: number,
): T[] {
  const ranked = [...places].sort(
    (a, b) => shortcutSceneRankScore(scene, b) - shortcutSceneRankScore(scene, a),
  );
  if (scene === "relax_walk") {
    const qualified = ranked.filter((place) =>
      isRecommendablePlace(
        recommendationToRecommendableInput(place as PlaceResult),
        "ai_recommend",
        { logDrop: false, requireOpenNow: false },
      ).ok,
    );
    const qualifiedSet = new Set(qualified);
    const preferred = qualified.filter((place) => shortcutSceneRankScore(scene, place) >= 70);
    const rest = qualified.filter(
      (place) =>
        shortcutSceneRankScore(scene, place) < 70 && !isReligiousShortcutPlace(place),
    );
    const religious = qualified.filter(isReligiousShortcutPlace);
    const lowRatingFallback = ranked.filter((place) => !qualifiedSet.has(place));
    return [...preferred, ...rest, ...religious, ...lowRatingFallback].slice(0, count);
  }
  return ranked.slice(0, count);
}

export const SHORTCUT_CANDIDATE_POOL_TARGET = 20;

function uniquePlaces<T extends PlaceTypeMeta & { id?: string | null; name?: string | null }>(
  places: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const place of places) {
    const key = (place.id ?? place.name ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/** Coffee-first / indoor-first candidate restriction. Last-resort mix only if the preferred pool is empty. */
export function selectShortcutSceneCandidates<
  T extends PlaceTypeMeta & { id?: string | null; name?: string | null },
>(places: T[], scene?: ChatShortcutScene | null, minCount = 3): T[] {
  if (!scene) return places;

  if (scene === "quiet_cafe") {
    const primary = places.filter(isCoffeePrimaryPlace);
    if (primary.length >= minCount) return uniquePlaces(primary);
    const withFallback = uniquePlaces([
      ...primary,
      ...places.filter(isCoffeeFallbackPlace),
    ]);
    if (withFallback.length > 0) return withFallback;
    return [];
  }

  if (scene === "rainy_indoor") {
    const indoor = places.filter(isRainyPreferredPlace);
    if (indoor.length >= minCount) return uniquePlaces(indoor);
    if (indoor.length > 0) return uniquePlaces([...indoor, ...places]);
    return places;
  }

  return places;
}

export function rankPlacesForShortcutScene<T extends PlaceResult>(
  places: T[],
  scene: ChatShortcutScene | null | undefined,
): T[] {
  if (!scene) return places;
  return [...places].sort((a, b) => {
    const scoreA = shortcutSceneRankScore(scene, a);
    const scoreB = shortcutSceneRankScore(scene, b);
    if (scoreB !== scoreA) return scoreB - scoreA;
    const ratingA = (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 0) + 10);
    const ratingB = (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 0) + 10);
    return ratingB - ratingA;
  });
}

export function nearbySearchAttemptsForShortcutScene(
  scene: ChatShortcutScene,
): Array<{ query: string; mode: "nearby" | "text"; includedTypes: string[] }> {
  if (scene === "quiet_cafe") {
    return [
      {
        query: "安靜 咖啡廳 specialty coffee",
        mode: "nearby",
        includedTypes: ["cafe", "coffee_shop"],
      },
      {
        query: "espresso coffee roastery",
        mode: "text",
        includedTypes: ["cafe", "coffee_shop"],
      },
      {
        query: "茶館 甜點咖啡 早午餐咖啡",
        mode: "nearby",
        includedTypes: ["cafe", "coffee_shop", "bakery"],
      },
    ];
  }
  if (scene === "rainy_indoor") {
    return [
      {
        query: "室內 博物館 美術館",
        mode: "nearby",
        includedTypes: ["museum", "art_gallery"],
      },
      {
        query: "咖啡廳 書店 圖書館",
        mode: "nearby",
        includedTypes: ["cafe", "coffee_shop", "book_store"],
      },
      {
        query: "商場 水族館 室內景點",
        mode: "nearby",
        includedTypes: ["shopping_mall", "aquarium", "library"],
      },
    ];
  }
  return [
    {
      query: "公園 散步 綠地 花園",
      mode: "nearby",
      includedTypes: ["park", "garden"],
    },
    {
      query: "博物館 美術館 藝文",
      mode: "nearby",
      includedTypes: ["museum", "art_gallery"],
    },
    {
      query: "河岸 觀景 散步 綠地",
      mode: "nearby",
      includedTypes: ["park", "garden"],
    },
  ];
}

export const NEARBY_SHORTCUT_POLICY = {
  relax_walk: {
    recommendationIntent: "attraction",
    preferredKinds: [
      "park",
      "garden",
      "nature",
      "walking",
      "scenic",
      "art_gallery",
      "museum",
      "cultural_center",
      "observation",
      "waterfront",
    ] as const,
    negativeKinds: ["temple", "shrine", "church", "mosque", "religious"] as const,
    fallback: "keep_non_food_attractions_and_downrank_religious",
  },
  quiet_cafe: {
    recommendationIntent: "cafe",
    preferredKinds: [
      "cafe",
      "coffee_shop",
      "espresso_bar",
      "roastery",
      "tea_house",
    ] as const,
    fallbackKinds: ["dessert_cafe", "brunch_cafe", "bakery"] as const,
    blockedKinds: ["park", "bridge", "museum", "art_gallery"] as const,
    fallback: "primary_coffee_then_dessert_bakery_never_mix_attractions_if_coffee_exists",
  },
  rainy_indoor: {
    recommendationIntent: "attraction",
    preferredKinds: [
      "museum",
      "art_gallery",
      "cafe",
      "bookstore",
      "library",
      "shopping_mall",
      "aquarium",
      "indoor",
    ] as const,
    negativeKinds: ["park", "trail", "temple"] as const,
    fallback: "indoor_first_then_keep_pool_and_downrank_outdoor",
  },
} as const;
