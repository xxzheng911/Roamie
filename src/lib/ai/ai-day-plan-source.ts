import type { PlaceResult } from "@/lib/place-result";
import {
  CHAT_DAY_PLAN_MAX_PER_DAY,
  CHAT_DAY_PLAN_MIN_PER_DAY,
  type TripStyleKey,
} from "@/lib/ai/ai-trip-style";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { classifyTripPlaceCategory, type TripPlaceCategory } from "@/lib/ai/trip-place-scoring";
import {
  logAiBuildDayPlanStart,
  logAiDayPlanFinalSummary,
  logAiDayPlanItemAdded,
} from "@/lib/ai/normalize-planning-places";
import {
  buildStructuredDayPlans,
  filterExcludedRetailPlaces,
  isCafePlace,
  isExcludedRetailPlace,
  isLargeMallPlace,
  isMarketPlace,
  isNightMarketPlace,
  isProperRestaurantPlace,
  repairDayPlanSlots,
  sortComposedDayPlans,
  validateItinerary,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  buildClassicLandmarkDayPlans,
  validateClassicLandmarkTrip,
} from "@/lib/ai/ai-classic-landmark-scheduler";
import {
  buildLocalLifeDayPlans,
  validateTripNoDuplicate,
} from "@/lib/ai/ai-local-life-scheduler";
import {
  filterPlacesForLocalLife,
  LOCAL_LIFE_MIN_ITEMS_PER_DAY,
} from "@/lib/ai/ai-local-life-rules";
import {
  CLASSIC_LANDMARK_MIN_ATTRACTIONS_PER_DAY,
  CLASSIC_LANDMARK_MIN_ITEMS_PER_DAY,
  canFillClassicLandmarkSlot,
  filterPlacesForClassicLandmark,
  isClassicLandmarkScenicCandidate,
  isExcludedFromClassicLandmarkScenic,
  logClassicDayRebuild,
  placeMatchesClassicDayRegion,
  sortClassicLandmarkPlaces,
  validateClassicLandmarkItinerary,
} from "@/lib/ai/ai-classic-landmark-rules";

/** 慢遊 fallback：每天至少 2 個地點 */
export const CHAT_DAY_PLAN_SLOW_MIN_PER_DAY = 2;

export function destinationSearchVariants(destination: string): string[] {
  const zh = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[zh];
  const variants = [zh, `${zh}市`];
  if (en && en !== zh) {
    variants.push(en, `${en} City`);
  }
  return [...new Set(variants.filter(Boolean))];
}

export function logAiPlaceSearchRetry(reason: string, query: string): void {
  console.info("[AI_PLACE_SEARCH_RETRY]", `reason=${reason}`, `query=${query}`);
}

export function logAiPlaceSearchFallback(type: string): void {
  console.info("[AI_PLACE_SEARCH_FALLBACK]", `type=${type}`);
}

export function logAiDayPlanRebuild(): void {
  console.info("[AI_DAY_PLAN_REBUILD]");
}

export function logAiDayPlanFinalValidate(
  days: number,
  ok: boolean,
  minPerDay: number,
  sparseDays: number[],
): void {
  console.info(
    "[AI_DAY_PLAN_FINAL_VALIDATE]",
    `days=${days}`,
    `ok=${ok}`,
    `minPerDay=${minPerDay}`,
    `sparse=${sparseDays.join(",") || "none"}`,
  );
}

export function countScenicPlaces(places: PlaceResult[]): number {
  const buckets = bucketPlacesByKind(places);
  return buckets.attraction.length + buckets.nature.length + buckets.culture.length;
}

export function buildAttractionSupplementAttempts(destination: string): SearchAttempt[] {
  const variants = destinationSearchVariants(destination);
  const attempts: SearchAttempt[] = [];

  for (const v of variants) {
    const isLatin = /^[A-Za-z]/.test(v);
    if (isLatin) {
      attempts.push(
        { query: `${v} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${v} scenic spots`, mode: "text", includedTypes: ["tourist_attraction", "natural_feature", "park"] },
        { query: `${v} museums`, mode: "text", includedTypes: ["museum", "art_gallery"] },
        { query: `${v} parks`, mode: "text", includedTypes: ["park", "natural_feature"] },
        { query: `${v} night market`, mode: "text", includedTypes: ["restaurant", "market"] },
      );
    } else {
      attempts.push(
        { query: `${v} 景點`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${v} 美食`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${v} 咖啡`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
        { query: `${v} 自然景點`, mode: "text", includedTypes: ["park", "natural_feature", "tourist_attraction"] },
        { query: `${v} 博物館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
        { query: `${v} 夜市`, mode: "text", includedTypes: ["restaurant", "market"] },
      );
    }
  }

  return [...new Map(attempts.map((a) => [a.query, a])).values()];
}

export type PlanPlaceKind =
  | "attraction"
  | "restaurant"
  | "cafe"
  | "shopping"
  | "market"
  | "culture"
  | "nature"
  | "night_market";

export type DayPlanSlot = {
  time: string;
  kind: PlanPlaceKind;
  label: string;
};

export type DayPlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

export type ComposedDayPlan = {
  day: number;
  entries: DayPlanEntry[];
};

export type DayPlanBucketWithEntries = {
  day: number;
  names: string[];
  entries: DayPlanEntry[];
};

export const TRIP_STYLE_COMPOSITION: Record<
  TripStyleKey,
  Partial<Record<PlanPlaceKind, number>>
> = {
  classic_landmarks: {
    attraction: 100,
    culture: 40,
    nature: 40,
  },
  local_life: {
    restaurant: 35,
    shopping: 25,
    market: 20,
    cafe: 10,
    attraction: 10,
  },
  slow_nature: {
    nature: 40,
    culture: 30,
    cafe: 20,
    restaurant: 10,
  },
  mixed: {
    attraction: 30,
    restaurant: 25,
    shopping: 20,
    culture: 15,
    cafe: 10,
  },
};

const STYLE_DAY_SLOT_TEMPLATES: Record<TripStyleKey, DayPlanSlot[][]> = {
  classic_landmarks: [
    [
      { time: "09:00", kind: "attraction", label: "景點" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "14:00", kind: "attraction", label: "景點" },
      { time: "16:00", kind: "cafe", label: "咖啡 / 甜點" },
      { time: "18:00", kind: "restaurant", label: "晚餐" },
    ],
    [
      { time: "09:00", kind: "attraction", label: "景點" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "14:00", kind: "attraction", label: "景點" },
      { time: "16:00", kind: "cafe", label: "咖啡 / 甜點" },
      { time: "18:00", kind: "restaurant", label: "晚餐" },
    ],
    [
      { time: "09:00", kind: "attraction", label: "景點" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "14:00", kind: "attraction", label: "景點" },
      { time: "16:00", kind: "cafe", label: "咖啡 / 甜點" },
      { time: "18:00", kind: "restaurant", label: "晚餐" },
    ],
  ],
  local_life: [
    [
      { time: "09:00", kind: "shopping", label: "街區" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "cafe", label: "咖啡或文創街區" },
      { time: "18:00", kind: "restaurant", label: "晚餐或夜間商圈" },
    ],
    [
      { time: "09:00", kind: "shopping", label: "街區" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "cafe", label: "咖啡或文創街區" },
      { time: "18:00", kind: "restaurant", label: "晚餐或夜間商圈" },
    ],
    [
      { time: "09:00", kind: "shopping", label: "街區" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "cafe", label: "咖啡或文創街區" },
      { time: "18:00", kind: "restaurant", label: "晚餐或夜間商圈" },
    ],
  ],
  slow_nature: [
    [
      { time: "09:00", kind: "nature", label: "自然" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "cafe", label: "咖啡" },
      { time: "19:30", kind: "restaurant", label: "晚餐" },
    ],
    [
      { time: "09:00", kind: "culture", label: "文化" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "nature", label: "自然" },
      { time: "19:30", kind: "restaurant", label: "晚餐" },
    ],
  ],
  mixed: [
    [
      { time: "09:00", kind: "attraction", label: "景點" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "cafe", label: "咖啡" },
      { time: "18:00", kind: "shopping", label: "商圈" },
      { time: "19:30", kind: "restaurant", label: "晚餐" },
    ],
    [
      { time: "09:00", kind: "culture", label: "文化" },
      { time: "12:00", kind: "restaurant", label: "午餐" },
      { time: "15:00", kind: "attraction", label: "景點" },
      { time: "19:30", kind: "restaurant", label: "晚餐" },
      { time: "21:00", kind: "night_market", label: "夜市" },
    ],
  ],
};

export function logAiGenerateAttractions(count: number): void {
  console.info("[AI_GENERATE_ATTRACTIONS]", `count=${count}`);
}

export function logAiGenerateRestaurants(count: number): void {
  console.info("[AI_GENERATE_RESTAURANTS]", `count=${count}`);
}

export function logAiGenerateCafes(count: number): void {
  console.info("[AI_GENERATE_CAFES]", `count=${count}`);
}

export function logAiBuildDayPlan(days: number): void {
  console.info("[AI_BUILD_DAY_PLAN]", `days=${days}`);
}

export function logAiDayPlanSummary(summary: {
  attractions: number;
  restaurants: number;
  cafes: number;
}): void {
  console.info(
    "[AI_DAY_PLAN_SUMMARY]",
    `attractions=${summary.attractions}`,
    `restaurants=${summary.restaurants}`,
    `cafes=${summary.cafes}`,
  );
}

function placeTypes(place: PlaceResult): Set<string> {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  return out;
}

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function classifyPlanPlaceKind(place: PlaceResult): PlanPlaceKind {
  if (isExcludedRetailPlace(place)) return "shopping";
  const types = placeTypes(place);
  const blob = placeBlob(place);
  const tripCategory = classifyTripPlaceCategory(place);

  if (/觀光夜市|黃昏市場|中央市場|肉品市場|公有市場|菜市場|肉市場/.test(blob)) return "night_market";
  if (types.has("market") || (/市場/.test(blob) && !/文創園區|文創市集|鐵花村/.test(blob))) return "market";
  if (types.has("cafe") || types.has("coffee_shop") || /咖啡/.test(blob)) return "cafe";
  if (/夜市|night market/.test(blob) || tripCategory === "night_market") return "night_market";
  if (
    types.has("shopping_mall") ||
    types.has("department_store") ||
    tripCategory === "shopping_district"
  ) {
    return "shopping";
  }
  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    types.has("library") ||
    tripCategory === "museum" ||
    tripCategory === "art_gallery" ||
    tripCategory === "heritage"
  ) {
    return "culture";
  }
  if (
    types.has("park") ||
    types.has("natural_feature") ||
    tripCategory === "park" ||
    tripCategory === "trail" ||
    tripCategory === "sea_view" ||
    tripCategory === "mountain_view" ||
    tripCategory === "riverside"
  ) {
    return "nature";
  }
  if (
    types.has("restaurant") ||
    types.has("food") ||
    types.has("meal_takeaway") ||
    tripCategory === "local_food" ||
    /餐|食|小吃|料理/.test(blob)
  ) {
    return "restaurant";
  }
  return "attraction";
}

export function buildCategorySearchAttempts(
  destination: string,
  kind: PlanPlaceKind,
): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label];
  const enLabel = en && en !== label ? en : null;

  switch (kind) {
    case "restaurant":
      return [
        { query: `${label} 美食 餐廳`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 必吃`, mode: "text", includedTypes: ["restaurant"] },
        { query: `${label} 小吃`, mode: "text", includedTypes: ["restaurant", "food"] },
        ...(enLabel
          ? [{ query: `${enLabel} restaurants`, mode: "text" as const, includedTypes: ["restaurant", "food"] }]
          : []),
      ];
    case "cafe":
      return [
        { query: `${label} 咖啡廳`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
        { query: `${label} 下午茶`, mode: "text", includedTypes: ["cafe", "bakery"] },
        ...(enLabel
          ? [{ query: `${enLabel} cafes`, mode: "text" as const, includedTypes: ["cafe", "coffee_shop"] }]
          : []),
      ];
    case "shopping":
      return [
        { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "department_store"] },
        { query: `${label} 購物`, mode: "text", includedTypes: ["shopping_mall"] },
      ];
    case "market":
      return [
        { query: `${label} 傳統市場`, mode: "text", includedTypes: ["market"] },
        { query: `${label} 市集`, mode: "text", includedTypes: ["market"] },
      ];
    case "night_market":
      return [
        { query: `${label} 夜市`, mode: "text", includedTypes: ["restaurant", "night_club"] },
        ...(enLabel
          ? [{ query: `${enLabel} night market`, mode: "text" as const, includedTypes: ["restaurant", "market"] }]
          : []),
      ];
    case "culture":
      return [
        { query: `${label} 博物館`, mode: "text", includedTypes: ["museum"] },
        { query: `${label} 美術館`, mode: "text", includedTypes: ["art_gallery", "museum"] },
        ...(enLabel
          ? [{ query: `${enLabel} museums`, mode: "text" as const, includedTypes: ["museum", "art_gallery"] }]
          : []),
      ];
    case "nature":
      return [
        { query: `${label} 自然景觀`, mode: "text", includedTypes: ["park", "natural_feature"] },
        { query: `${label} 公園`, mode: "text", includedTypes: ["park"] },
        ...(enLabel
          ? [
              { query: `${enLabel} scenic spots`, mode: "text" as const, includedTypes: ["tourist_attraction", "natural_feature", "park"] },
              { query: `${enLabel} parks`, mode: "text" as const, includedTypes: ["park", "natural_feature"] },
            ]
          : []),
      ];
    case "attraction":
    default:
      return [
        { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
        { query: `${label} 地標`, mode: "text", includedTypes: ["tourist_attraction"] },
        ...(enLabel
          ? [
              { query: `${enLabel} tourist attractions`, mode: "text" as const, includedTypes: ["tourist_attraction"] },
              { query: `${enLabel} attractions`, mode: "text" as const, includedTypes: ["tourist_attraction"] },
            ]
          : []),
      ];
  }
}

export function kindsForStyle(style: TripStyleKey): PlanPlaceKind[] {
  const composition = TRIP_STYLE_COMPOSITION[style];
  return Object.entries(composition)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([kind]) => kind as PlanPlaceKind);
}

const MEAL_SLOT_LABEL_RE = /早餐|午餐|晚餐|宵夜/;

export function isMealSlotLabel(label: string): boolean {
  return MEAL_SLOT_LABEL_RE.test(label);
}

export function isRestaurantCapableKind(kind: PlanPlaceKind): boolean {
  return kind === "restaurant" || kind === "night_market";
}

export function canPlaceFillMealSlot(place: PlaceResult, slot: DayPlanSlot): boolean {
  if (!isMealSlotLabel(slot.label)) return true;
  if (isExcludedRetailPlace(place)) return false;
  if (/午餐/.test(slot.label)) {
    return isProperRestaurantPlace(place);
  }
  if (/晚餐|宵夜/.test(slot.label)) {
    if (isProperRestaurantPlace(place)) return true;
    if (isNightMarketPlace(place)) {
      const hour = Number(slot.time.split(":")[0] ?? "19");
      return hour >= 18;
    }
    return false;
  }
  const kind = classifyPlanPlaceKind(place);
  if (kind === "cafe" && /早餐|咖啡|下午茶/.test(slot.label)) return true;
  return isProperRestaurantPlace(place);
}

export function canPlaceFillSlot(place: PlaceResult, slot: DayPlanSlot): boolean {
  if (isExcludedRetailPlace(place)) return false;
  const kind = classifyPlanPlaceKind(place);
  if (isNightMarketPlace(place)) {
    const hour = Number(slot.time.split(":")[0] ?? "12");
    if (hour < 18) return false;
  }
  if (isMealSlotLabel(slot.label)) {
    if (kind === "market" || kind === "shopping" || kind === "attraction") return false;
    return canPlaceFillMealSlot(place, slot);
  }
  if ((kind === "cafe" || isCafePlace(place)) && slot.kind !== "cafe" && !/咖啡|下午茶/.test(slot.label)) {
    return false;
  }
  return slotKindMatches(kind, slot.kind);
}

/** 市場不可標成午餐 / 晚餐；夜市僅能標在晚間時段 */
export function resolveEntryLabel(slot: DayPlanSlot, place: PlaceResult): string {
  const kind = classifyPlanPlaceKind(place);
  if (kind === "market" || isMarketPlace(place)) {
    if (isMealSlotLabel(slot.label)) return "小吃探索";
    return "市場走訪";
  }
  if (kind === "night_market" || isNightMarketPlace(place)) {
    if (/午餐/.test(slot.label)) return "小吃探索";
    if (/晚餐|宵夜/.test(slot.label)) return "晚餐";
    return "夜市";
  }
  if (isMealSlotLabel(slot.label) && !canPlaceFillMealSlot(place, slot)) {
    return "小吃探索";
  }
  return slot.label;
}

function slotKindMatches(placeKind: PlanPlaceKind, slotKind: PlanPlaceKind): boolean {
  if (placeKind === slotKind) return true;
  if (slotKind === "attraction" && (placeKind === "culture" || placeKind === "nature")) return true;
  if (slotKind === "restaurant" && placeKind === "night_market") return true;
  if (slotKind === "shopping" && placeKind === "market") return true;
  return false;
}

export function computeDayPlanPlaceNeed(days: number, style: TripStyleKey = "mixed"): number {
  const safeDays = Math.max(1, days);
  let slots = 0;
  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const template =
      STYLE_DAY_SLOT_TEMPLATES[style][dayIndex] ??
      STYLE_DAY_SLOT_TEMPLATES[style][0] ??
      STYLE_DAY_SLOT_TEMPLATES.mixed[0]!;
    slots += template.length;
  }
  return Math.max(slots, safeDays * CHAT_DAY_PLAN_MIN_PER_DAY);
}

export type DayPlanValidation = {
  ok: boolean;
  missingDays: number[];
  sparseDays: number[];
};

export function minItemsPerDayForStyle(style: TripStyleKey): number {
  if (style === "classic_landmarks") return CLASSIC_LANDMARK_MIN_ITEMS_PER_DAY;
  if (style === "local_life") return LOCAL_LIFE_MIN_ITEMS_PER_DAY;
  return CHAT_DAY_PLAN_MIN_PER_DAY;
}

export function validateComposedDayPlans(
  plans: ComposedDayPlan[],
  days: number,
  minPerDay = CHAT_DAY_PLAN_MIN_PER_DAY,
): DayPlanValidation {
  const safeDays = Math.max(1, days);
  const missingDays: number[] = [];
  const sparseDays: number[] = [];

  for (let day = 1; day <= safeDays; day += 1) {
    const plan = plans.find((p) => p.day === day);
    if (!plan) {
      missingDays.push(day);
      continue;
    }
    if (plan.entries.length < minPerDay) {
      sparseDays.push(day);
    }
  }

  return {
    ok: missingDays.length === 0 && sparseDays.length === 0,
    missingDays,
    sparseDays,
  };
}

export function logAiDayPlanValidation(result: DayPlanValidation, days: number): void {
  console.info(
    "[AI_DAY_PLAN_VALIDATION]",
    `days=${days}`,
    `ok=${result.ok}`,
    `missing=${result.missingDays.join(",") || "none"}`,
    `sparse=${result.sparseDays.join(",") || "none"}`,
  );
}

export function bucketPlacesByKind(
  places: PlaceResult[],
  style?: TripStyleKey,
): Record<PlanPlaceKind, PlaceResult[]> {
  const buckets: Record<PlanPlaceKind, PlaceResult[]> = {
    attraction: [],
    restaurant: [],
    cafe: [],
    shopping: [],
    market: [],
    culture: [],
    nature: [],
    night_market: [],
  };
  const seen = new Set<string>();
  for (const place of places) {
    const id = place.id ?? place.name;
    if (!id || seen.has(id) || !place.name?.trim() || isExcludedRetailPlace(place)) continue;
    if (style === "classic_landmarks") {
      if (isClassicLandmarkScenicCandidate(place)) {
        seen.add(id);
        const kind = classifyPlanPlaceKind(place);
        const bucket =
          kind === "culture" || kind === "nature" ? kind : "attraction";
        buckets[bucket].push(place);
      } else if (isProperRestaurantPlace(place)) {
        seen.add(id);
        buckets.restaurant.push(place);
      } else if (isCafePlace(place)) {
        seen.add(id);
        buckets.cafe.push(place);
      }
      continue;
    }
    seen.add(id);
    buckets[classifyPlanPlaceKind(place)].push(place);
  }
  return buckets;
}

function rebuildFailedDays(
  plans: ComposedDayPlan[],
  failedDays: number[],
  places: PlaceResult[],
  style: TripStyleKey,
  destination?: string,
  days?: number,
): ComposedDayPlan[] {
  if (!failedDays.length) return plans;
  if (style === "classic_landmarks" && destination && days) {
    logClassicDayRebuild(0, "trip_rebuild");
    return buildClassicLandmarkDayPlans({
      places: filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places)),
      days,
      destination,
    });
  }
  if (style === "local_life" && destination && days) {
    return buildLocalLifeDayPlans({
      places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places)),
      days,
      destination,
    });
  }
  const failed = new Set(failedDays);
  return plans.map((plan) => {
    if (!failed.has(plan.day)) return plan;
    if (style === "classic_landmarks") {
      logClassicDayRebuild(plan.day, "itinerary_validation");
    }
    const rebuilt = buildStructuredDayPlans({
      places,
      days: 1,
      style,
      classifyKind: classifyPlanPlaceKind,
      resolveLabel: resolveEntryLabel,
    })[0];
    return rebuilt?.entries.length ? { day: plan.day, entries: rebuilt.entries } : plan;
  });
}

function finalizeComposedDayPlans(
  plans: ComposedDayPlan[],
  places: PlaceResult[],
  style: TripStyleKey,
  days: number,
  destination?: string,
): ComposedDayPlan[] {
  let current = sortComposedDayPlans(plans);
  let itineraryValidation = validateItinerary(current, classifyPlanPlaceKind);

  if (!itineraryValidation.ok) {
    current = repairDayPlanSlots(
      current,
      places,
      style,
      classifyPlanPlaceKind,
      resolveEntryLabel,
    );
    current = sortComposedDayPlans(current);
    itineraryValidation = validateItinerary(current, classifyPlanPlaceKind);
  }

  if (!itineraryValidation.ok && itineraryValidation.failedDays.length > 0) {
    logAiDayPlanRebuild();
    current = rebuildFailedDays(
      current,
      itineraryValidation.failedDays,
      places,
      style,
      destination,
      days,
    );
    current = sortComposedDayPlans(current);
    itineraryValidation = validateItinerary(current, classifyPlanPlaceKind);
  }

  if (!itineraryValidation.ok) {
    logAiDayPlanRebuild();
    if (style === "local_life" && destination) {
      current = sortComposedDayPlans(
        buildLocalLifeDayPlans({
          places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places)),
          days,
          destination,
        }),
      );
    } else {
      current = sortComposedDayPlans(
        buildStructuredDayPlans({
          places,
          days,
          style,
          classifyKind: classifyPlanPlaceKind,
          resolveLabel: resolveEntryLabel,
        }),
      );
    }
    validateItinerary(current, classifyPlanPlaceKind);
  }

  if (style === "classic_landmarks") {
    let classicValidation = validateClassicLandmarkItinerary(current, classifyPlanPlaceKind);
    if (destination) {
      const tripDedup = validateClassicLandmarkTrip(current, destination);
      if (!tripDedup.ok) {
        classicValidation = {
          ok: false,
          reasons: [...classicValidation.reasons, ...tripDedup.reasons],
          failedDays: [
            ...new Set([...classicValidation.failedDays, ...tripDedup.duplicateDays]),
          ],
        };
      }
    }
    if (!classicValidation.ok && classicValidation.failedDays.length > 0) {
      logAiDayPlanRebuild();
      current = rebuildFailedDays(
        current,
        classicValidation.failedDays,
        places,
        style,
        destination,
        days,
      );
      current = sortComposedDayPlans(current);
      classicValidation = validateClassicLandmarkItinerary(current, classifyPlanPlaceKind);
    }
    if (!classicValidation.ok && destination) {
      logAiDayPlanRebuild();
      current = sortComposedDayPlans(
        buildClassicLandmarkDayPlans({
          places: filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places)),
          days,
          destination,
        }),
      );
      validateClassicLandmarkItinerary(current, classifyPlanPlaceKind);
      validateClassicLandmarkTrip(current, destination);
    }
  }

  if (style === "local_life" && destination) {
    const dedup = validateTripNoDuplicate(current, destination);
    if (!dedup.ok) {
      logAiDayPlanRebuild();
      current = sortComposedDayPlans(
        buildLocalLifeDayPlans({
          places: filterPlacesForLocalLife(filterExcludedRetailPlaces(places)),
          days,
          destination,
        }),
      );
      validateTripNoDuplicate(current, destination);
    }
  }

  const countValidation = validateComposedDayPlans(
    current,
    days,
    minItemsPerDayForStyle(style),
  );
  logAiDayPlanValidation(countValidation, days);
  return current;
}

export function buildComposedDayPlans(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  destination?: string;
}): ComposedDayPlan[] {
  const { places, days, style, destination } = params;
  const safeDays = Math.max(1, days);

  if (style === "classic_landmarks" && destination) {
    const safePlaces = filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places));
    logAiBuildDayPlanStart(safeDays, safePlaces.length);
    const plans = buildClassicLandmarkDayPlans({
      places: safePlaces,
      days: safeDays,
      destination,
    });
    const finalized = finalizeComposedDayPlans(plans, safePlaces, style, safeDays, destination);
    for (const plan of finalized) {
      for (const entry of plan.entries) {
        logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
      }
    }
    const totalItems = finalized.reduce((n, p) => n + p.entries.length, 0);
    logAiDayPlanFinalSummary(safeDays, totalItems);
    return finalized;
  }

  if (style === "local_life" && destination) {
    const safePlaces = filterPlacesForLocalLife(filterExcludedRetailPlaces(places));
    logAiBuildDayPlanStart(safeDays, safePlaces.length);
    const plans = buildLocalLifeDayPlans({
      places: safePlaces,
      days: safeDays,
      destination,
    });
    const finalized = finalizeComposedDayPlans(plans, safePlaces, style, safeDays, destination);
    for (const plan of finalized) {
      for (const entry of plan.entries) {
        logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
      }
    }
    const totalItems = finalized.reduce((n, p) => n + p.entries.length, 0);
    logAiDayPlanFinalSummary(safeDays, totalItems);
    return finalized;
  }

  const safePlaces =
    style === "classic_landmarks"
      ? filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places))
      : filterExcludedRetailPlaces(places);
  logAiBuildDayPlanStart(safeDays, safePlaces.length);
  const byKind = bucketPlacesByKind(safePlaces, style);
  const used = new Set<string>();
  const plans: ComposedDayPlan[] = [];

  const pickFromKind = (kind: PlanPlaceKind, filter?: (place: PlaceResult) => boolean): PlaceResult | undefined => {
    const primary = byKind[kind] ?? [];
    const fallbackKinds: PlanPlaceKind[] =
      kind === "restaurant"
        ? []
        : kind === "attraction"
          ? style === "classic_landmarks"
            ? ["culture", "nature"]
            : ["culture", "nature", "shopping"]
          : kind === "shopping"
            ? ["market", "attraction"]
            : kind === "culture"
              ? style === "classic_landmarks"
                ? ["nature", "attraction"]
                : ["nature", "attraction"]
              : kind === "nature"
                ? style === "classic_landmarks"
                  ? ["culture", "attraction"]
                  : ["culture", "attraction", "market"]
                : kind === "cafe"
                  ? []
                  : [];

    const orderSources = (list: PlaceResult[]) =>
      style === "classic_landmarks" ? sortClassicLandmarkPlaces(list) : list;

    for (const source of [primary, ...fallbackKinds.map((k) => byKind[k] ?? [])]) {
      for (const place of orderSources(source)) {
        const id = place.id ?? place.name;
        if (!id || used.has(id)) continue;
        if (filter && !filter(place)) continue;
        used.add(id);
        return place;
      }
    }
    return undefined;
  };

  const pickForSlot = (
    slot: DayPlanSlot,
    dayState: { cafeCount: number; mallCount: number },
    dayIndex: number,
  ): PlaceResult | undefined => {
    if (style === "classic_landmarks") {
      if (/午餐/.test(slot.label)) {
        return pickFromKind("restaurant", (p) => canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind));
      }
      if (/晚餐|宵夜/.test(slot.label)) {
        return pickFromKind("restaurant", (p) => canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind));
      }
      if (slot.kind === "cafe" || /咖啡|甜點/.test(slot.label)) {
        if (dayState.cafeCount >= 1) return undefined;
        const cafe = pickFromKind("cafe", (p) => canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind));
        if (cafe) dayState.cafeCount += 1;
        return cafe;
      }
      const regionalFilter = (p: PlaceResult) =>
        canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind) &&
        (!destination || placeMatchesClassicDayRegion(p, destination, dayIndex));
      let place = pickFromKind(slot.kind, regionalFilter);
      if (!place) {
        place = pickFromKind(slot.kind, (p) =>
          canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind),
        );
      }
      if (!place) {
        for (const kind of ["attraction", "culture", "nature"] as PlanPlaceKind[]) {
          place = pickFromKind(kind, regionalFilter);
          if (place) break;
          place = pickFromKind(kind, (p) =>
            canFillClassicLandmarkSlot(p, slot, classifyPlanPlaceKind),
          );
          if (place) break;
        }
      }
      return place;
    }

    if (/午餐/.test(slot.label)) {
      const place = pickFromKind("restaurant", isProperRestaurantPlace);
      return place && canPlaceFillMealSlot(place, slot) ? place : undefined;
    }
    if (/晚餐|宵夜/.test(slot.label)) {
      for (const kind of ["restaurant", "night_market"] as PlanPlaceKind[]) {
        const place = pickFromKind(
          kind,
          kind === "restaurant" ? isProperRestaurantPlace : (p) => isNightMarketPlace(p),
        );
        if (place && canPlaceFillMealSlot(place, slot)) return place;
        if (place) {
          const id = place.id ?? place.name;
          if (id) used.delete(id);
        }
      }
      return undefined;
    }
    if (slot.kind === "cafe" || /咖啡|下午茶/.test(slot.label)) {
      if (dayState.cafeCount >= 1) return undefined;
      const place = pickFromKind("cafe", (p) => isCafePlace(p));
      if (place) dayState.cafeCount += 1;
      return place;
    }

    if (slot.kind === "shopping" || /商圈/.test(slot.label)) {
      if (dayState.mallCount >= 1) {
        const place = pickFromKind("attraction", (p) => !isLargeMallPlace(p));
        return place;
      }
    }

    let place = pickFromKind(slot.kind, (p) => {
      if (dayState.mallCount >= 1 && isLargeMallPlace(p)) return false;
      return true;
    });
    if (!place) {
      for (const kind of kindsForStyle(style)) {
        place = pickFromKind(kind);
        if (place && canPlaceFillSlot(place, slot)) break;
        if (place && !canPlaceFillSlot(place, slot)) {
          const id = place.id ?? place.name;
          if (id) used.delete(id);
          place = undefined;
        }
      }
    }
    if (place && !canPlaceFillSlot(place, slot)) {
      const id = place.id ?? place.name;
      if (id) used.delete(id);
      return undefined;
    }
    if (place && (isCafePlace(place) || classifyPlanPlaceKind(place) === "cafe")) {
      dayState.cafeCount += 1;
    }
    if (place && isLargeMallPlace(place)) {
      dayState.mallCount += 1;
    }
    return place;
  };

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const template =
      STYLE_DAY_SLOT_TEMPLATES[style][dayIndex] ??
      STYLE_DAY_SLOT_TEMPLATES[style][0] ??
      STYLE_DAY_SLOT_TEMPLATES.mixed[0]!;
    const entries: DayPlanEntry[] = [];
    const dayState = { cafeCount: 0, mallCount: 0 };

    for (const slot of template) {
      const place = pickForSlot(slot, dayState, dayIndex);
      if (!place?.name) continue;
      entries.push({
        time: slot.time,
        label: resolveEntryLabel(slot, place),
        name: place.name,
        place,
      });
    }

    const minPerDay = minItemsPerDayForStyle(style);
    if (entries.length < minPerDay) {
      for (const kind of kindsForStyle(style)) {
        if (entries.length >= minPerDay) break;
        const place = pickFromKind(kind, (p) => !isExcludedRetailPlace(p));
        if (!place?.name) continue;
        const fillerSlot: DayPlanSlot = {
          time: entries.length === 0 ? "09:00" : entries.length === 1 ? "12:00" : "15:00",
          kind,
          label: kind === "restaurant" ? "午餐" : kind === "cafe" ? "咖啡" : kind === "market" ? "市場" : "景點",
        };
        if (!canPlaceFillSlot(place, fillerSlot)) {
          const id = place.id ?? place.name;
          if (id) used.delete(id);
          continue;
        }
        if (fillerSlot.kind === "cafe" && dayState.cafeCount >= 1) {
          const id = place.id ?? place.name;
          if (id) used.delete(id);
          continue;
        }
        if (fillerSlot.kind === "cafe") dayState.cafeCount += 1;
        entries.push({
          time: fillerSlot.time,
          label: resolveEntryLabel(fillerSlot, place),
          name: place.name,
          place,
        });
      }
    }

    plans.push({ day: dayIndex + 1, entries });
  }

  logAiBuildDayPlan(safeDays);
  const finalized = finalizeComposedDayPlans(plans, safePlaces, style, safeDays, destination);
  const summary = {
    attractions: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "attraction").length,
    restaurants: finalized.flatMap((p) => p.entries).filter((e) => {
      const k = classifyPlanPlaceKind(e.place);
      return k === "restaurant" || k === "night_market";
    }).length,
    cafes: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "cafe").length,
  };
  logAiDayPlanSummary(summary);

  if (
    !validateComposedDayPlans(finalized, safeDays, minItemsPerDayForStyle(style)).ok &&
    safePlaces.length >= safeDays * CHAT_DAY_PLAN_SLOW_MIN_PER_DAY &&
    style !== "classic_landmarks"
  ) {
    logAiDayPlanRebuild();
    const balanced = buildBalancedSlowDayPlans({ places: safePlaces, days: safeDays, style });
    if (balanced.some((p) => p.entries.length > 0)) {
      const totalItems = balanced.reduce((n, p) => n + p.entries.length, 0);
      logAiDayPlanFinalSummary(safeDays, totalItems);
      return balanced;
    }
  }

  for (const plan of finalized) {
    for (const entry of plan.entries) {
      logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
    }
  }
  const totalItems = finalized.reduce((n, p) => n + p.entries.length, 0);
  logAiDayPlanFinalSummary(safeDays, totalItems);

  return finalized;
}

export function composedDayPlansToBuckets(plans: ComposedDayPlan[]): DayPlanBucketWithEntries[] {
  return plans.map((plan) => ({
    day: plan.day,
    names: plan.entries.map((entry) => entry.name),
    entries: plan.entries,
  }));
}

export function buildBalancedSlowDayPlans(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
}): ComposedDayPlan[] {
  const { places, days, style } = params;
  const safeDays = Math.max(1, days);
  const pool =
    style === "classic_landmarks"
      ? filterPlacesForClassicLandmark(filterExcludedRetailPlaces(places))
      : filterExcludedRetailPlaces(places);
  const plans = buildStructuredDayPlans({
    places: pool,
    days: safeDays,
    style,
    classifyKind: classifyPlanPlaceKind,
    resolveLabel: resolveEntryLabel,
  });

  const finalized = sortComposedDayPlans(plans);
  validateItinerary(finalized, classifyPlanPlaceKind);

  logAiBuildDayPlan(safeDays);
  const validation = validateComposedDayPlans(
    finalized,
    safeDays,
    minItemsPerDayForStyle(style),
  );
  logAiDayPlanValidation(validation, safeDays);
  const summary = {
    attractions: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "attraction").length,
    restaurants: finalized.flatMap((p) => p.entries).filter((e) => {
      const k = classifyPlanPlaceKind(e.place);
      return k === "restaurant" || k === "night_market";
    }).length,
    cafes: finalized.flatMap((p) => p.entries).filter((e) => classifyPlanPlaceKind(e.place) === "cafe").length,
  };
  logAiDayPlanSummary(summary);
  logAiPlaceSearchFallback(style === "slow_nature" ? "natural" : "balanced");
  for (const plan of finalized) {
    for (const entry of plan.entries) {
      logAiDayPlanItemAdded(plan.day, entry.name, classifyPlanPlaceKind(entry.place));
    }
  }
  const totalItems = finalized.reduce((n, p) => n + p.entries.length, 0);
  logAiDayPlanFinalSummary(safeDays, totalItems);
  return finalized;
}

export function buildComposedDayPlanSummary(
  destination: string,
  days: number,
  style: TripStyleKey,
  plans: ComposedDayPlan[],
  opts?: { slowTravel?: boolean },
): string {
  const label = normalizeDestinationLabel(destination);
  const styleLabels: Record<TripStyleKey, string> = {
    classic_landmarks: "經典地標",
    local_life: "在地生活體驗",
    slow_nature: "慢遊療癒行程",
    mixed: "Roamie 混搭推薦",
  };
  const lines: string[] = opts?.slowTravel && style === "slow_nature"
    ? ["我先幫你排一版慢遊行程 🌿", "", `${label} ${days} 天推薦（${styleLabels[style]}）：`, ""]
    : [`${label} ${days} 天推薦（${styleLabels[style]}）：`, ""];

  for (const plan of plans) {
    if (!plan.entries.length) continue;
    lines.push(`Day${plan.day}：`);
    const sortedEntries = sortComposedDayPlans([plan])[0]?.entries ?? plan.entries;
    for (const entry of sortedEntries) {
      if (/午餐|晚餐|早餐|下午茶|宵夜|咖啡|小吃探索|市場走訪|商圈市集/.test(entry.label)) {
        lines.push(`- ${entry.time} ${entry.label}：${entry.name}`);
      } else {
        lines.push(`- ${entry.time} ${entry.label} — ${entry.name}`);
      }
    }
    if (plan.day < days) lines.push("");
  }

  lines.push("", "想加進行程的話，可以跟我說「加入全部」或選幾個最想去的。");
  return lines.join("\n");
}

export function flattenComposedDayPlanPlaces(plans: ComposedDayPlan[]): PlaceResult[] {
  const seen = new Set<string>();
  const ordered: PlaceResult[] = [];
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = entry.place.id ?? entry.name;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ordered.push(entry.place);
    }
  }
  return ordered;
}
