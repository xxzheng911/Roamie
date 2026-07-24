/**
 * Universal NL → PlaceRecommendationIntent parser.
 * Does not hardcode destinations; cuisine / feature lexicons are shared
 * with recommendation-refinement.
 */
import {
  CAFE_FEATURE_IDS,
  isMoreRecommendationResultsText,
  parseRecommendationRefinement,
  RESTAURANT_CUISINES,
} from "@/lib/ai/recommendation-refinement/parser";
import type { RecommendationIntent } from "@/lib/ai/recommendation-refinement/types";
import {
  isCountryCityInquiryText,
  isFutureTripPlanningStatement,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import type {
  PlaceRecommendationContinuation,
  PlaceRecommendationIntent,
  PlaceRecommendationPrimaryType,
} from "@/lib/ai/place-recommendation-intent/types";

const PRIMARY_PATTERNS: Array<{
  type: PlaceRecommendationPrimaryType;
  patterns: RegExp[];
}> = [
  {
    type: "cafe",
    patterns: [
      /咖啡廳|咖啡店|咖啡|café|cafe|想喝咖啡|找地方坐|下午茶|甜點店/i,
    ],
  },
  {
    type: "shopping",
    patterns: [
      /購物|逛街|買東西|买东西|百貨|百货|商場|商场|地下街|Outlet|アウトレット|商店街|伴手禮|伴手礼|文具店|精品|當地品牌|当地品牌|shopping|mall/i,
    ],
  },
  {
    type: "nightlife",
    patterns: [/酒吧|夜店|晚上去哪|小酌|夜生活|nightlife|\bbar\b/i],
  },
  {
    type: "indoor",
    patterns: [/室內景點|室内景点|下雨天|不想曬太陽|不想晒太阳|雨天可以去哪|有冷氣|有冷气|室內走走|室内走走/i],
  },
  {
    type: "attraction",
    patterns: [
      /景點|景点|可以去哪|想走走|必去|博物館|博物馆|展望台|神社|寺廟|寺庙|歷史景點|历史景点|自然景點|自然景点|親子景點|亲子景点|museum|tourist/i,
    ],
  },
  {
    type: "restaurant",
    patterns: [
      /餐廳|餐馆|吃飯|吃饭|美食|午餐|晚餐|早餐|宵夜|有什麼好吃|有什么好吃|想吃|推薦吃什麼|推荐吃什么|找吃的|用餐|美食店|拉麵店|拉面店|壽司店|烧肉店|燒肉店/i,
    ],
  },
  {
    type: "accommodation",
    patterns: [/飯店|酒店|住宿|旅館|旅馆|hotel|hostel|民宿/i],
  },
];

const RECOMMEND_SURFACE_RE =
  /(?:推薦|推荐|有沒有|有没有|有什麼|有什么|哪些|想找|找|有嗎|有吗|介紹|介绍)/i;

/** Any restaurant cuisine token present → treat as restaurant place intent. */
function detectCuisineSubtypes(text: string): string[] {
  const found: string[] = [];
  for (const def of RESTAURANT_CUISINES) {
    if (!def.patterns.some((re) => re.test(text))) continue;
    const excluded = def.labels.some((label) =>
      new RegExp(`(?:不要|別要|别要|不想吃|別推|别推)\\s*${label}`, "i").test(text),
    );
    if (excluded) continue;
    found.push(def.id);
  }
  return [...new Set(found)];
}

function detectPrimaryType(
  text: string,
  subtypes: string[],
  refinementIntent?: RecommendationIntent | null,
): PlaceRecommendationPrimaryType | undefined {
  if (refinementIntent === "cafe") return "cafe";
  if (refinementIntent === "shopping") return "shopping";
  if (refinementIntent === "nightlife") return "nightlife";
  if (refinementIntent === "indoor") return "indoor";
  if (refinementIntent === "attraction") return "attraction";
  if (refinementIntent === "restaurant") return "restaurant";

  for (const def of PRIMARY_PATTERNS) {
    if (def.patterns.some((re) => re.test(text))) return def.type;
  }

  // Cuisine alone (「拉麵」「壽喜燒」) counts as restaurant
  if (subtypes.length > 0) return "restaurant";

  // Izakaya / late night food without explicit nightlife
  if (/居酒屋|宵夜/.test(text)) return "nightlife";

  return undefined;
}

function detectContinuation(
  text: string,
  hasActiveContext: boolean,
  hasSignals: boolean,
): PlaceRecommendationContinuation {
  // Unified continue grammar — wins over category keyword leak into new_request
  if (isMoreRecommendationResultsText(text)) return "more_results";
  if (hasActiveContext && hasSignals) return "refinement";
  return "new_request";
}

function mapBudget(
  level?: "cheap" | "moderate" | "premium",
): PlaceRecommendationIntent["budget"] {
  return level;
}

/**
 * Parse natural language into PlaceRecommendationIntent.
 * Returns null when the message is not a place-recommendation request.
 */
export function parsePlaceRecommendationIntent(
  text: string,
  opts?: {
    activePrimaryType?: PlaceRecommendationPrimaryType | RecommendationIntent | null;
    hasActiveRecommendationContext?: boolean;
  },
): PlaceRecommendationIntent | null {
  const t = text.trim();
  if (!t) return null;

  // Future trip narrative / country city inquiry must never become place cards.
  if (isFutureTripPlanningStatement(t) || isCountryCityInquiryText(t)) {
    return null;
  }

  const activeAsRec =
    opts?.activePrimaryType === "restaurant" ||
    opts?.activePrimaryType === "cafe" ||
    opts?.activePrimaryType === "shopping" ||
    opts?.activePrimaryType === "attraction" ||
    opts?.activePrimaryType === "nightlife" ||
    opts?.activePrimaryType === "indoor" ||
    opts?.activePrimaryType === "general_place"
      ? (opts.activePrimaryType as RecommendationIntent)
      : undefined;

  const refinement = parseRecommendationRefinement(t, activeAsRec);
  const subtypes = detectCuisineSubtypes(t);
  const shoppingTypes = refinement?.shoppingTypes ?? [];
  const attractionTypes = refinement?.attractionTypes ?? [];

  const primaryType = detectPrimaryType(t, subtypes, refinement?.intentSwitch ?? activeAsRec);

  // Soft refinement-only replies when active context exists (「安靜一點」「不要連鎖」)
  const softRefinement =
    Boolean(opts?.hasActiveRecommendationContext) &&
    refinement != null &&
    !isMoreRecommendationResultsText(t);

  const isMoreOnly = isMoreRecommendationResultsText(t);

  // 「還有嗎」alone is not a new place category — needs active recommendation context
  if (!primaryType && !softRefinement && !isMoreOnly) {
    return null;
  }
  if (isMoreOnly && !primaryType && !opts?.hasActiveRecommendationContext && !activeAsRec) {
    return null;
  }

  // Require recommend surface OR cuisine subtype OR soft refinement / more
  const hasRecommendSurface =
    RECOMMEND_SURFACE_RE.test(t) ||
    subtypes.length > 0 ||
    shoppingTypes.length > 0 ||
    attractionTypes.length > 0 ||
    softRefinement ||
    isMoreRecommendationResultsText(t) ||
    Boolean(primaryType && /想|找|有|推薦|推荐/.test(t));

  if (!hasRecommendSurface && !softRefinement) return null;

  const resolvedPrimary: PlaceRecommendationPrimaryType =
    primaryType ??
    (opts?.activePrimaryType as PlaceRecommendationPrimaryType | undefined) ??
    "general_place";

  const preferredFeatures = [
    ...(refinement?.preferredKeywords ?? []),
    ...(refinement?.atmosphere ?? []).filter((a) => CAFE_FEATURE_IDS.has(a)),
  ];
  const atmosphere = (refinement?.atmosphere ?? []).filter((a) => !CAFE_FEATURE_IDS.has(a));

  const allSubtypes = [
    ...subtypes,
    ...shoppingTypes,
    ...attractionTypes,
  ];

  // Cafe features stored as preferredFeatures with canonical ids
  const cafeFeatures = (refinement?.atmosphere ?? []).filter((a) => CAFE_FEATURE_IDS.has(a));
  for (const f of cafeFeatures) {
    if (!preferredFeatures.includes(f)) preferredFeatures.push(f);
  }

  const excludedFeatures = refinement?.excludedKeywords ?? [];
  const destinationFromText = resolveDestinationFromText(t) ?? undefined;

  const continuation = detectContinuation(
    t,
    Boolean(opts?.hasActiveRecommendationContext),
    Boolean(refinement),
  );

  let confidence = refinement?.confidence ?? 0.55;
  if (subtypes.length || shoppingTypes.length) confidence = Math.max(confidence, 0.9);
  if (primaryType && RECOMMEND_SURFACE_RE.test(t)) confidence = Math.max(confidence, 0.88);
  if (continuation === "more_results") confidence = Math.max(confidence, 0.8);

  const indoorOnly =
    refinement?.indoorOnly ||
    resolvedPrimary === "indoor" ||
    attractionTypes.includes("indoor") ||
    attractionTypes.includes("rainy_day") ||
    undefined;

  const intent: PlaceRecommendationIntent = {
    destinationName: destinationFromText,
    primaryType: resolvedPrimary === "indoor" && !indoorOnly ? "attraction" : resolvedPrimary,
    subtypes: [...new Set(allSubtypes)],
    mealSlot: refinement?.mealSlot,
    preferredFeatures: [...new Set(preferredFeatures)],
    excludedFeatures: [...new Set(excludedFeatures)],
    budget: mapBudget(refinement?.budget?.level),
    atmosphere: atmosphere.length ? atmosphere : undefined,
    companion: refinement?.companion,
    openNow: refinement?.openNow,
    reservationPreferred: refinement?.reservationPreferred,
    nearStation: refinement?.nearStation,
    indoorOnly: indoorOnly || undefined,
    continuation,
    confidence,
  };

  // Nightlife: izakaya alone may be restaurant + late_night
  if (/居酒屋/.test(t) && intent.primaryType === "nightlife" && !/酒吧|夜店|夜生活/.test(t)) {
    intent.primaryType = "restaurant";
    if (!intent.subtypes.includes("izakaya")) intent.subtypes.push("izakaya");
    if (!intent.mealSlot) intent.mealSlot = "late_night";
  }

  return intent;
}

/** True when message is an explicit place recommendation request (not combination reply). */
export function hasExplicitPlaceRecommendationIntent(
  text: string,
  opts?: {
    activePrimaryType?: PlaceRecommendationPrimaryType | RecommendationIntent | null;
    hasActiveRecommendationContext?: boolean;
  },
): boolean {
  const parsed = parsePlaceRecommendationIntent(text, opts);
  if (!parsed) return false;
  if (parsed.confidence < 0.55) return false;
  return (
    parsed.continuation === "new_request" ||
    parsed.continuation === "refinement" ||
    parsed.continuation === "more_results"
  );
}

export function placeIntentToCategoryIntent(
  primaryType: PlaceRecommendationPrimaryType,
): "cafe" | "restaurant" | "shopping" | "attraction" | "night_market" | "bar" | "indoor" {
  if (primaryType === "nightlife") return "bar";
  if (primaryType === "indoor") return "indoor";
  if (primaryType === "accommodation" || primaryType === "general_place") return "attraction";
  return primaryType;
}

export function logPlaceRequirementParsed(intent: PlaceRecommendationIntent): void {
  console.info(
    "[PLACE_REQUIREMENT_PARSED]",
    `destination=${intent.destinationName ?? ""}`,
    `resolvedCity=${intent.resolvedSearchCity ?? ""}`,
    `primaryType=${intent.primaryType}`,
    `subtypes=${intent.subtypes.join(",")}`,
    `preferredFeatures=${intent.preferredFeatures.join(",")}`,
    `excludedFeatures=${intent.excludedFeatures.join(",")}`,
    `mealSlot=${intent.mealSlot ?? ""}`,
    `budget=${intent.budget ?? ""}`,
    `confidence=${intent.confidence}`,
  );
}
