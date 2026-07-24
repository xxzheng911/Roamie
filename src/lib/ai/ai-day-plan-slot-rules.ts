import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/map-explore";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isOpenAtScheduled,
  isTimePeriodMismatch,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import type {
  ComposedDayPlan,
  DayPlanEntry,
  DayPlanSlot,
  PlanPlaceKind,
} from "@/lib/ai/ai-day-plan-source";
import { LOCAL_LIFE_DAY_SLOTS } from "@/lib/ai/ai-local-life-rules";
import {
  isGeocodeEmptyPlace,
  logAiPlaceRejectDuplicate,
  logAiPlaceSelected,
  resolveTripPlaceId,
} from "@/lib/ai/ai-trip-place-allocator";
import {
  dedupeParentLandmarkPlaces,
  resolveParentLandmarkKey,
} from "@/lib/ai/ai-parent-landmark-dedup";
import {
  entryLabelMatchesPlace,
  filterRealPlanningPlaces,
  isAllowedItinerarySlotLabel,
  isPlaceholderPlanningPlaceName,
  isRealGooglePlanningPlace,
  resolvePlanningPlaceId,
} from "@/lib/ai/planning-real-place";
import { evaluateTourismQuality } from "@/lib/ai/tourism-quality-gate";

export const EXCLUDED_RETAIL_RE =
  /公有市場|零售市場|傳統市場|黃昏市場|早市|菜市場|批發市場|批發商圈|魚市場|肉品市場|果菜市場|肉市場|農產品市場|農產品市集|第三公有|新民市場|中央市場|五金賣場|超市|量販|量販店|大賣場|生鮮超市|賣場|全聯|px\s*mart|家樂福|costco|carrefour|大潤發|愛買|hypermarket|wholesale|supermarket|grocery_store|grocery_or_supermarket|convenience_store|department_store|福利中心|福利量販|便利商店|7-eleven|7\s*eleven|familymart|family\s*mart|萊爾富|萬家福|停車場|停车场|parking|學校|学校|school|university|college|辦公大樓|办公大楼|office\s*building|corporate\s*office|meeting\s*point|集合點|集合点|walking\s*tour|route\s*meeting/i;

const LOW_VALUE_PLANNING_RE =
  /產業園區(?!.*文創)|工業區|工業園|industrial\s*park|business\s*park|科技園(?!.*文創)|科學園區(?!.*文創)|物流|倉儲|warehouse|distribution/i;

const MARKET_SHOPPING_REQUEST_RE =
  /我想逛市場|我想買東西|我想去超市|逛市場|想買東西|去超市|想逛超市|想逛傳統市場/i;

/** 商圈／街區／文創園區 — 即使 type 含 shopping_mall / store 也允許（local_life） */
const ALLOWED_SHOPPING_DISTRICT_RE =
  /審計新村|彩虹眷村|草悟道|勤美|國華街|神農街|老街|文創園區|文創園|眷村|藍晒|繼光街|宮原眼科|刑務所|林森綠|park\s*2|勤美術|文創聚落|鐵花村|審計|范特西|塔拉朵/i;

const ALWAYS_EXCLUDED_RETAIL_TYPES = new Set([
  "supermarket",
  "grocery_store",
  "grocery_or_supermarket",
  "convenience_store",
  "department_store",
  "wholesale_store",
  "hypermarket",
]);

const NON_RETAIL_PLACE_TYPES = new Set([
  "restaurant",
  "food",
  "meal_takeaway",
  "cafe",
  "coffee_shop",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "bar",
  "night_club",
]);

export type ExcludedRetailReason = "market" | "supermarket" | "hypermarket";

export type ExcludedRetailFilterOptions = {
  userText?: string;
  style?: TripStyleKey;
};

const MEAL_SLOT_RE = /早餐|午餐|晚餐|宵夜/;
const LUNCH_SLOT_RE = /午餐/;
const DINNER_SLOT_RE = /晚餐|宵夜/;
const MORNING_END_MINUTES = 11 * 60 + 30;

const FOOD_VENUE_RE =
  /restaurant|food|meal_takeaway|cafe|coffee|bakery|bar|bistro|pub|lounge|餐廳|餐館|餐酒館|咖啡|酒吧|小吃|料理|輕食|brunch|dining|grill|diner/i;
const BAR_BISTRO_RE =
  /bar|bistro|pub|lounge|餐酒館|酒吧|夜店|居酒|night\s*club|眺吧|餐酒/i;
const BREAKFAST_OK_RE =
  /breakfast|bakery|brunch|cafe|coffee|咖啡|早餐|早午餐|烘焙|甜點店/i;
const MUSEUM_CULTURE_RE =
  /museum|art_gallery|gallery|美術館|博物館|藝術中心|art\s*centre|art\s*center|展覽館/i;

/** 產業／文創／文化園區 — 不可標成咖啡 */
export const CULTURE_CREATIVE_AREA_RE =
  /產業園區|文創園區|文化園區|文化創意|creative\s*park|art\s*center|art\s*centre|creative\s*hub|文創產業|creative\s*industries/i;

const EXPLICIT_CAFE_NAME_RE =
  /咖啡廳|咖啡店|coffee\s*shop|\bcafe\b|coffee_shop/i;

const EXPLICIT_CAFE_SLOT_RE = /(?:^|[\s，、（(])咖啡(?:廳|店|館|[\s，、）)]|$)/;

export function isCultureCreativeAreaPlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  const blob = placeBlob(place);
  if (CULTURE_CREATIVE_AREA_RE.test(blob)) return true;
  if (types.has("museum") || types.has("art_gallery")) return true;
  if (types.has("tourist_attraction") && /園區|文創|文化創意|產業|creative/i.test(blob)) {
    return true;
  }
  return isMuseumCulturePlace(place) && !EXPLICIT_CAFE_NAME_RE.test(blob);
}

export function isExplicitCafePlace(place: PlaceResult): boolean {
  if (isCultureCreativeAreaPlace(place)) return false;
  const types = placeTypes(place);
  const name = place.name ?? "";
  if (types.has("cafe") || types.has("coffee_shop")) return true;
  if (EXPLICIT_CAFE_NAME_RE.test(name)) return true;
  return EXPLICIT_CAFE_SLOT_RE.test(name);
}

export function logAiCategoryLabelValidate(place: string, label: string, reason: string): void {
  logAiPipeline("[AI_CATEGORY_LABEL_VALIDATE]", `place=${place}`, `label=${label}`, `reason=${reason}`);
}

export function logAiCategoryLabelFix(place: string, from: string, to: string): void {
  logAiPipeline("[AI_CATEGORY_LABEL_FIX]", `place=${place}`, `from=${from}`, `to=${to}`);
}

const SLOT_TIME_RANGES: Record<string, { start: number; end: number }> = {
  breakfast: { start: 7 * 60, end: 10 * 60 },
  morning_scenic: { start: 9 * 60 + 30, end: 11 * 60 + 30 },
  lunch: { start: 11 * 60 + 30, end: 13 * 60 + 30 },
  afternoon_scenic: { start: 14 * 60, end: 17 * 60 },
  dinner: { start: 17 * 60 + 30, end: 19 * 60 + 30 },
  evening: { start: 19 * 60 + 30, end: 21 * 60 + 30 },
  afternoon_tea: { start: 14 * 60, end: 17 * 60 },
  late_night: { start: 21 * 60, end: 25 * 60 },
};

export function logAiOpenHoursValidate(place: string, time: string, ok: boolean): void {
  logAiPipeline("[AI_OPEN_HOURS_VALIDATE]", `place=${place}`, `time=${time}`, `ok=${ok}`);
}

export function logAiOpenHoursDrop(place: string, time: string, reason: string): void {
  logAiPipeline("[AI_OPEN_HOURS_DROP]", `place=${place}`, `time=${time}`, `reason=${reason}`);
}

export function logAiSlotCategoryMismatch(place: string, slot: string, kind: string): void {
  logAiPipeline("[AI_SLOT_CATEGORY_MISMATCH]", `place=${place}`, `slot=${slot}`, `kind=${kind}`);
}

export function logAiStyleCompositionValidate(style: string, ok: boolean, detail: string): void {
  logAiPipeline("[AI_STYLE_COMPOSITION_VALIDATE]", `style=${style}`, `ok=${ok}`, detail);
}

export function logAiRestaurantRatioExceeded(ratio: number, max: number): void {
  logAiPipeline("[AI_RESTAURANT_RATIO_EXCEEDED]", `ratio=${ratio.toFixed(2)}`, `max=${max}`);
}

export function logAiDayPlanRebuildReason(reason: string): void {
  logAiPipeline("[AI_DAY_PLAN_REBUILD_REASON]", `reason=${reason}`);
}

export function logAiStyleCompositionFail(reason: string, day?: number): void {
  logAiPipeline("[AI_STYLE_COMPOSITION_FAIL]", `reason=${reason}`, day != null ? `day=${day}` : "");
}

export function logAiNonMealSlotMissing(day: number): void {
  logAiPipeline("[AI_NON_MEAL_SLOT_MISSING]", `day=${day}`);
}

export function logAiDayRebuildNonMeal(day: number, reason?: string): void {
  logAiPipeline("[AI_DAY_REBUILD_NON_MEAL]", `day=${day}`, reason ? `reason=${reason}` : "");
}

export function logAiExcludedRetailDrop(name: string, reason: ExcludedRetailReason): void {
  logAiPipeline("[AI_EXCLUDED_RETAIL_DROP]", `name=${name}`, `reason=${reason}`);
}

export function logAiRetailFinalValidateFail(day: number, name: string, reason: ExcludedRetailReason): void {
  logAiPipeline("[AI_RETAIL_FINAL_VALIDATE_FAIL]", `day=${day}`, `name=${name}`, `reason=${reason}`);
}

export function logAiDayRebuildRetailExcluded(day: number): void {
  logAiPipeline("[AI_DAY_REBUILD_RETAIL_EXCLUDED]", `day=${day}`);
}

export function placeHoursDataFromPlace(place: PlaceResult): PlaceHoursData {
  return {
    businessStatus: place.businessStatus,
    regularOpeningHours: place.regularOpeningHours,
    utcOffsetMinutes: place.utcOffsetMinutes,
  };
}

export function hasOpeningHoursData(place: PlaceResult): boolean {
  const hours = placeHoursDataFromPlace(place);
  return !!hours.regularOpeningHours?.periods?.length;
}

export function requiresOpeningHours(place: PlaceResult): boolean {
  return isFoodVenuePlace(place) || isBarBistroPlace(place);
}

export function isFoodVenuePlace(place: PlaceResult): boolean {
  if (isProperRestaurantPlace(place) || isCafePlace(place)) return true;
  return FOOD_VENUE_RE.test(placeBlob(place));
}

export function isBarBistroPlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.has("bar") || types.has("night_club")) return true;
  return BAR_BISTRO_RE.test(placeBlob(place));
}

export function isMuseumCulturePlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.has("museum") || types.has("art_gallery") || types.has("library")) return true;
  return MUSEUM_CULTURE_RE.test(placeBlob(place));
}

function parseHoursRangeFromLabel(label: string): { openMin: number; closeMin: number } | null {
  const trimmed = label.replace(/^今日\s*/, "").trim();
  if (/休息|閉店|closed|定休|不營業/i.test(trimmed)) return null;
  const range = trimmed.match(/(\d{1,2}):(\d{2})\s*[–\-~～至]\s*(\d{1,2}):(\d{2})/);
  if (!range) return null;
  return {
    openMin: Number(range[1]) * 60 + Number(range[2]),
    closeMin: Number(range[3]) * 60 + Number(range[4]),
  };
}

function isOpenFromTodayHoursLabel(place: PlaceResult, plannedTime: string): boolean | null {
  const range = parseHoursRangeFromLabel(place.todayHoursLabel ?? "");
  if (!range) return null;
  const minutes = parseTimeMinutes(plannedTime);
  if (range.closeMin > range.openMin) {
    return minutes >= range.openMin && minutes < range.closeMin;
  }
  return minutes >= range.openMin || minutes < range.closeMin;
}

function slotMealKey(slot: DayPlanSlot): string | null {
  if (/早餐/.test(slot.label)) return "breakfast";
  if (/午餐/.test(slot.label)) return "lunch";
  if (/下午茶|咖啡|甜點/.test(slot.label)) return "afternoon_tea";
  if (/晚餐/.test(slot.label)) return "dinner";
  if (/宵夜|夜市/.test(slot.label)) return "late_night";
  return null;
}

export function isTimeInSlotRange(time: string, mealKey: string): boolean {
  const range = SLOT_TIME_RANGES[mealKey];
  if (!range) return true;
  const minutes = parseTimeMinutes(time);
  return minutes >= range.start && minutes < range.end;
}

const BLOCKED_MEAL_SLOT_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "shopping_mall",
  "department_store",
  "park",
  "natural_feature",
  "historical_landmark",
  "amusement_park",
  "zoo",
  "aquarium",
  "library",
  "landmark",
]);

/** 餐飲 slot 僅允許 restaurant / cafe / food / 夜市餐食 */
export function isMealSlotEligiblePlace(place: PlaceResult): boolean {
  if (isExcludedRetailPlace(place)) return false;
  if (isCultureCreativeAreaPlace(place)) return false;
  if (isLowValuePlanningPlace(place)) return false;
  const types = placeTypes(place);
  for (const t of types) {
    if (BLOCKED_MEAL_SLOT_TYPES.has(t)) return false;
  }
  if (isMuseumCulturePlace(place)) return false;
  if (isNightMarketPlace(place)) return true;
  if (isProperRestaurantPlace(place) || isCafePlace(place)) return true;
  if (isFoodVenuePlace(place) && !isBarBistroPlace(place)) return true;
  const blob = placeBlob(place);
  if (/文創|市集|老街|商圈|公園|步道|美術館|博物館|地標|景點/.test(blob)) {
    return false;
  }
  return false;
}

function ensurePlansForValidation(plans: ComposedDayPlan[], days: number): ComposedDayPlan[] {
  const safeDays = Math.max(1, days);
  const byDay = new Map(plans.map((plan) => [plan.day, plan]));
  const result: ComposedDayPlan[] = [];
  for (let day = 1; day <= safeDays; day += 1) {
    const existing = byDay.get(day);
    result.push(existing ?? { day, entries: [], isIncomplete: true });
  }
  return result;
}

function minEntriesPerDayForTripDays(totalDays: number): number {
  return Math.max(1, totalDays) >= 3 ? 7 : 5;
}

export function isLowValuePlanningPlace(place: PlaceResult): boolean {
  const blob = placeBlob(place);
  if (LOW_VALUE_PLANNING_RE.test(blob)) return true;
  if (
    /飲水|水飲み|聖火台|時計台|電視塔|テレビ塔|市役所|區役所|区役所|道廳|道庁|廳舍|庁舎|政府大樓|行政大樓|辦公廳|公所|近鄰公園|近隣公園|drinking\s*fountain|olympic\s*cauldron/i.test(
      blob,
    )
  ) {
    return !evaluateTourismQuality(place).ok;
  }
  const types = placeTypes(place);
  if (types.has("parking") || types.has("parking_lot") || types.has("school") || types.has("university")) {
    return true;
  }
  if (types.has("corporate_office") || types.has("local_government_office") || types.has("city_hall")) {
    return true;
  }
  if (types.has("drinking_water") || types.has("cemetery") || types.has("funeral_home")) return true;
  return false;
}

const SUPPLEMENT_KIND_PASSES: PlanPlaceKind[][] = [
  ["attraction", "nature", "culture"],
  ["cafe"],
  ["shopping"],
  ["attraction", "nature", "culture", "shopping"],
];

function scenicFillerTimes(existingCount: number): string {
  if (existingCount === 0) return "09:00";
  if (existingCount === 1) return "11:30";
  if (existingCount === 2) return "14:00";
  if (existingCount === 3) return "16:00";
  return "15:30";
}

function supplementDayPlanEntries(params: {
  entries: DayPlanEntry[];
  day: number;
  pool: PlaceResult[];
  used: Set<string>;
  style: TripStyleKey;
  totalDays: number;
  classifyKind: (place: PlaceResult) => PlanPlaceKind;
  resolveLabel: (slot: DayPlanSlot, place: PlaceResult) => string;
  plannedDate?: string;
}): DayPlanEntry[] {
  const {
    entries,
    pool,
    used,
    style,
    totalDays,
    classifyKind,
    resolveLabel,
    plannedDate,
  } = params;
  const minPerDay = minEntriesPerDayForTripDays(totalDays);
  const maxPerDay = minPerDay;
  const result = [...entries];
  const scenicKinds: PlanPlaceKind[] =
    style === "slow_nature"
      ? ["nature", "attraction", "culture", "cafe"]
      : style === "local_life"
        ? ["shopping", "attraction", "culture", "cafe"]
        : ["attraction", "culture", "nature", "cafe"];

  const tryPick = (kinds: PlanPlaceKind[]): PlaceResult | undefined => {
    const scenicOnly = kinds.filter((k) => k !== "restaurant" && k !== "night_market");
    for (const kind of scenicOnly) {
      for (const place of pool) {
        const id = resolveTripPlaceId(place);
        if (!id || used.has(id) || !place.name?.trim()) continue;
        if (isGeocodeEmptyPlace(place)) continue;
        if (isExcludedRetailPlace(place)) continue;
        const placeKind = classifyKind(place);
        const kindOk =
          placeKind === kind ||
          (kind === "attraction" &&
            (placeKind === "attraction" || placeKind === "nature" || placeKind === "culture")) ||
          (kind === "market" && (placeKind === "market" || placeKind === "shopping")) ||
          (kind === "shopping" && (placeKind === "shopping" || placeKind === "market"));
        if (!kindOk) continue;
        const fillerSlot: DayPlanSlot = {
          time: scenicFillerTimes(result.length),
          kind: placeKind,
          label:
            placeKind === "cafe"
              ? "咖啡"
              : "景點",
        };
        if (!canFillStructuredSlot(place, fillerSlot, { cafeCount: 0 }, classifyKind, plannedDate)) {
          continue;
        }
        used.add(id);
        return place;
      }
    }
    return undefined;
  };

  for (const pass of SUPPLEMENT_KIND_PASSES) {
    while (result.length < minPerDay && result.length < maxPerDay) {
      const place = tryPick(pass);
      if (!place) break;
      const kind = classifyKind(place);
      const fillerSlot: DayPlanSlot = {
        time: scenicFillerTimes(result.length),
        kind,
        label: kind === "cafe" ? "咖啡" : "景點",
      };
      result.push({
        time: fillerSlot.time,
        label: resolveLabel(fillerSlot, place),
        name: place.name,
        place,
      });
    }
    if (result.length >= minPerDay) break;
  }

  while (result.length < minPerDay && result.length < maxPerDay) {
    const place = tryPick(scenicKinds);
    if (!place) break;
    const kind = classifyKind(place);
    const fillerSlot: DayPlanSlot = {
      time: scenicFillerTimes(result.length),
      kind,
      label: "景點",
    };
    result.push({
      time: fillerSlot.time,
      label: resolveLabel(fillerSlot, place),
      name: place.name,
      place,
    });
  }

  const requiredMeals: DayPlanSlot[] = [
    { time: "08:30", kind: "restaurant", label: "早餐" },
    { time: "12:00", kind: "restaurant", label: "午餐" },
    { time: "18:00", kind: "restaurant", label: "晚餐" },
  ];
  for (const slot of requiredMeals) {
    const hasMeal = result.some((e) => e.label === slot.label);
    if (hasMeal) continue;

    let picked: PlaceResult | undefined;
    for (const place of pool) {
      const id = resolveTripPlaceId(place);
      if (!id || used.has(id) || !place.name?.trim() || isExcludedRetailPlace(place)) continue;
      if (!isMealSlotEligiblePlace(place)) continue;
      if (slot.label === "晚餐" && !isProperRestaurantPlace(place) && !isNightMarketPlace(place)) continue;
      if (!canFillStructuredSlot(place, slot, { cafeCount: 0 }, classifyKind, plannedDate)) continue;
      picked = place;
      used.add(id);
      break;
    }
    if (!picked) continue;

    const dinnerConflictIdx =
      slot.label === "晚餐"
        ? result.findIndex(
            (e) => e.label === "景點" && parseTimeMinutes(e.time) >= 17 * 60 + 30,
          )
        : -1;
    const entry: DayPlanEntry = {
      time: slot.time,
      label: resolveLabel(slot, picked),
      name: picked.name,
      place: picked,
    };
    if (dinnerConflictIdx >= 0) {
      const displaced = result[dinnerConflictIdx]!;
      const displacedId = resolveTripPlaceId(displaced.place);
      if (displacedId) used.delete(displacedId);
      result[dinnerConflictIdx] = entry;
    } else {
      result.push(entry);
    }
  }

  return result;
}

export function canPlaceFillSlotByCategory(place: PlaceResult, slot: DayPlanSlot): boolean {
  const blob = placeBlob(place);
  const mealKey = slotMealKey(slot);
  const minutes = parseTimeMinutes(slot.time);

  if (mealKey && !isMealSlotEligiblePlace(place)) {
    return false;
  }

  if (mealKey === "breakfast") {
    if (isBarBistroPlace(place)) return false;
    if (isMuseumCulturePlace(place)) return false;
    if (isCultureCreativeAreaPlace(place)) return false;
    if (!BREAKFAST_OK_RE.test(blob) && !isCafePlace(place) && !isProperRestaurantPlace(place)) {
      return false;
    }
    return isTimeInSlotRange(slot.time, "breakfast");
  }

  if (mealKey === "lunch") {
    if (isBarBistroPlace(place)) return false;
    if (isNightMarketPlace(place)) return false;
    if (isMuseumCulturePlace(place)) return false;
    if (isCultureCreativeAreaPlace(place)) return false;
    return isProperRestaurantPlace(place) && isTimeInSlotRange(slot.time, "lunch");
  }

  if (mealKey === "afternoon_tea") {
    if (isBarBistroPlace(place)) return false;
    if (isMuseumCulturePlace(place) && !/咖啡/.test(blob)) return false;
    return (
      (isCafePlace(place) || /甜點|dessert|tea|bakery|烘焙/.test(blob)) &&
      isTimeInSlotRange(slot.time, "afternoon_tea")
    );
  }

  if (mealKey === "dinner") {
    if (isMuseumCulturePlace(place)) return false;
    if (/公園|park|步道|trail/.test(blob) && !isNightMarketPlace(place)) return false;
    if (isProperRestaurantPlace(place) || isBarBistroPlace(place)) {
      return isTimeInSlotRange(slot.time, "dinner");
    }
    if (isNightMarketPlace(place)) return minutes >= 17 * 60;
    return false;
  }

  if (mealKey === "late_night") {
    return (
      (isNightMarketPlace(place) || isBarBistroPlace(place) || /宵夜|late.?night/i.test(blob)) &&
      isTimeInSlotRange(slot.time, "late_night")
    );
  }

  if (isNonMealActivitySlot(slot)) {
    if (isFoodVenuePlace(place) || isBarBistroPlace(place) || isCafePlace(place)) return false;
    if (isProperRestaurantPlace(place) || isNightMarketPlace(place)) return false;
  }

  if (isFoodVenuePlace(place) && !/咖啡|下午茶/.test(slot.label)) {
    if (minutes <= MORNING_END_MINUTES && isBarBistroPlace(place)) return false;
    if (isMuseumCulturePlace(place)) return false;
    return false;
  }

  if (isBarBistroPlace(place)) return false;
  if (isMuseumCulturePlace(place) && minutes >= 17 * 60) return false;
  if (isNightMarketPlace(place) && minutes < 18 * 60) return false;

  return true;
}

export function resolvePlaceCategoryLabel(place: PlaceResult, slot: DayPlanSlot): string {
  const kind = classifyPlanPlaceKindForLabel(place);

  if (/咖啡|下午茶/.test(slot.label) && isCultureCreativeAreaPlace(place)) {
    logAiCategoryLabelFix(place.name ?? "", slot.label, "文化");
    return "文化";
  }
  if (/咖啡|下午茶/.test(slot.label) && !isExplicitCafePlace(place) && !isFoodVenuePlace(place)) {
    if (kind === "culture" || isMuseumCulturePlace(place)) return "文化";
    if (kind === "shopping") return "商圈";
    if (kind === "attraction") return "景點";
    return slot.label.replace(/咖啡/, "文化");
  }

  if (isFoodVenuePlace(place) || isBarBistroPlace(place)) {
    if (/早餐/.test(slot.label) || (parseTimeMinutes(slot.time) < 10 * 60 + 30 && isCafePlace(place))) {
      return "早餐";
    }
    if (/午餐/.test(slot.label) || (parseTimeMinutes(slot.time) >= 11 * 60 && parseTimeMinutes(slot.time) < 14 * 60 && isProperRestaurantPlace(place))) {
      return "午餐";
    }
    if (isCafePlace(place) || /咖啡|甜點|下午茶/.test(slot.label)) return "咖啡";
    if (isBarBistroPlace(place)) return "酒吧";
    if (/晚餐|宵夜/.test(slot.label)) return "晚餐";
    return "午餐";
  }

  if (kind === "night_market" || isNightMarketPlace(place)) {
    return parseTimeMinutes(slot.time) >= 18 * 60 ? "晚餐" : "夜市";
  }

  if (kind === "culture" || isMuseumCulturePlace(place)) return "文化";
  if (kind === "nature") return "自然";
  if (kind === "cafe") return "咖啡";
  if (kind === "shopping") return "商圈";
  if (kind === "market") return "市場走訪";

  return slot.label;
}

function classifyPlanPlaceKindForLabel(place: PlaceResult): PlanPlaceKind {
  const types = placeTypes(place);
  const blob = placeBlob(place);
  if (isBarBistroPlace(place)) return "restaurant";
  if (isCultureCreativeAreaPlace(place) || isMuseumCulturePlace(place)) return "culture";
  if (isExplicitCafePlace(place)) return "cafe";
  if (types.has("park") || types.has("natural_feature") || /公園|河岸|步道/.test(blob)) return "nature";
  if (isProperRestaurantPlace(place)) return "restaurant";
  return "attraction";
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

function isAllowedShoppingDistrict(place: PlaceResult): boolean {
  const blob = placeBlob(place);
  return ALLOWED_SHOPPING_DISTRICT_RE.test(blob) || /商圈|文創園區|文創園|創意園區|老街/.test(blob);
}

function isExcludedMarketByName(blob: string): boolean {
  if (/夜市|night\s*market/i.test(blob)) return false;
  if (EXCLUDED_RETAIL_RE.test(blob)) return true;
  if (/市場/.test(blob)) {
    if (ALLOWED_SHOPPING_DISTRICT_RE.test(blob)) return false;
    if (/商圈|文創市集|創意市集|藝術市集|假日市集|觀光/.test(blob)) return false;
    return true;
  }
  return false;
}

export function getExcludedRetailReason(
  place: PlaceResult,
  opts?: string | ExcludedRetailFilterOptions,
): ExcludedRetailReason | null {
  const options: ExcludedRetailFilterOptions =
    typeof opts === "string" ? { userText: opts } : (opts ?? {});
  const userText = options.userText;
  const style = options.style;

  if (userText?.trim() && MARKET_SHOPPING_REQUEST_RE.test(userText.trim())) return null;

  const blob = placeBlob(place);
  const types = placeTypes(place);

  if (isExcludedMarketByName(blob)) return "market";

  for (const t of types) {
    if (ALWAYS_EXCLUDED_RETAIL_TYPES.has(t)) {
      return t === "department_store" || t === "wholesale_store" || t === "hypermarket"
        ? "hypermarket"
        : "supermarket";
    }
  }

  if (types.has("market") && !isNightMarketPlace(place)) {
    if (isAllowedShoppingDistrict(place)) return null;
    return "market";
  }

  if (types.has("store")) {
    const hasNonRetail = [...types].some((t) => NON_RETAIL_PLACE_TYPES.has(t));
    if (!hasNonRetail && !isAllowedShoppingDistrict(place)) {
      if (EXCLUDED_RETAIL_RE.test(blob) || /市場/.test(blob)) return "supermarket";
    }
  }

  if (types.has("shopping_mall")) {
    if (style === "local_life" || style === "mixed") {
      if (isAllowedShoppingDistrict(place)) return null;
      if (/超市|量販|大賣場|全聯|家樂福|costco|carrefour|大潤發|愛買|px\s*mart/i.test(blob)) {
        return "hypermarket";
      }
      return null;
    }
    return "hypermarket";
  }

  return null;
}

export function isExcludedRetailPlace(
  place: PlaceResult,
  opts?: string | ExcludedRetailFilterOptions,
): boolean {
  return getExcludedRetailReason(place, opts) != null;
}

export function filterExcludedRetailPlaces(
  places: PlaceResult[],
  opts?: ExcludedRetailFilterOptions,
): PlaceResult[] {
  return places.filter((p) => {
    if (isLowValuePlanningPlace(p)) {
      logAiExcludedRetailDrop(p.name ?? "", "supermarket");
      return false;
    }
    const reason = getExcludedRetailReason(p, opts);
    if (reason) {
      logAiExcludedRetailDrop(p.name ?? "", reason);
      return false;
    }
    return true;
  });
}

export function validateNoExcludedRetailPlaces(
  plans: ComposedDayPlan[],
  style?: TripStyleKey,
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    for (const entry of plan.entries) {
      const reason = getExcludedRetailReason(entry.place, { style });
      if (reason) {
        reasons.push(`excluded_retail:day${plan.day}:${entry.name}:${reason}`);
        logAiRetailFinalValidateFail(plan.day, entry.name, reason);
        failedDays.add(plan.day);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function stripExcludedRetailFromDayPlans(
  plans: ComposedDayPlan[],
  style?: TripStyleKey,
): ComposedDayPlan[] {
  return plans.map((plan) => ({
    ...plan,
    entries: plan.entries.filter((entry) => {
      const reason = getExcludedRetailReason(entry.place, { style });
      if (reason) {
        logAiExcludedRetailDrop(entry.name, reason);
        return false;
      }
      return true;
    }),
  }));
}

export function isNightMarketPlace(place: PlaceResult): boolean {
  const blob = placeBlob(place);
  return /夜市|night\s*market/i.test(blob) || placeTypes(place).has("night_club");
}

export function isMarketPlace(place: PlaceResult): boolean {
  if (isNightMarketPlace(place)) return false;
  return getExcludedRetailReason(place) === "market";
}

export function isLargeMallPlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  const blob = placeBlob(place);
  return (
    types.has("shopping_mall") ||
    types.has("department_store") ||
    /百貨|購物中心|outlet|mall|量販/i.test(blob)
  );
}

export function parseDayPlanTimeMinutes(time: string): number {
  return parseTimeMinutes(time);
}

export function isCafePlace(place: PlaceResult): boolean {
  return isExplicitCafePlace(place);
}

export function isProperRestaurantPlace(place: PlaceResult): boolean {
  if (isExcludedRetailPlace(place)) return false;
  if (isCultureCreativeAreaPlace(place)) return false;
  if (isLowValuePlanningPlace(place)) return false;
  if (isNightMarketPlace(place) || isMarketPlace(place)) return false;
  const types = placeTypes(place);
  if ([...types].some((t) => ALWAYS_EXCLUDED_RETAIL_TYPES.has(t))) return false;
  if (types.has("shopping_mall") && !types.has("restaurant") && !types.has("food")) {
    return false;
  }
  return (
    types.has("restaurant") ||
    types.has("food") ||
    types.has("meal_takeaway") ||
    /餐|食|小吃|料理|輕食|麵|飯/i.test(placeBlob(place))
  );
}

export function isScenicPlaceKind(kind: PlanPlaceKind): boolean {
  return (
    kind === "attraction" ||
    kind === "nature" ||
    kind === "culture" ||
    kind === "market" ||
    kind === "shopping"
  );
}

const NON_MEAL_SCENIC_SLOT_KINDS = new Set<PlanPlaceKind>([
  "attraction",
  "culture",
  "nature",
  "shopping",
  "market",
]);

/** 非餐飲活動 slot（街區、文創、散步點等）— 禁止填入餐飲 */
export function isNonMealActivitySlot(slot: DayPlanSlot): boolean {
  if (MEAL_SLOT_RE.test(slot.label)) return false;
  if (slot.kind === "restaurant" || slot.kind === "night_market") return false;
  if (NON_MEAL_SCENIC_SLOT_KINDS.has(slot.kind)) return true;
  return /街區|商圈|文創|散步|老街|文化|自然|景點|步道|河岸|公園|夕景/.test(slot.label);
}

export function isDiningPlace(
  place: PlaceResult,
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): boolean {
  const kind = classifyKind(place);
  return (
    kind === "restaurant" ||
    kind === "night_market" ||
    kind === "cafe" ||
    isFoodVenuePlace(place) ||
    isCafePlace(place)
  );
}

export function isDayMealsOnly(
  entries: DayPlanEntry[],
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): boolean {
  if (!entries.length) return false;
  return entries.every(
    (e) => MEAL_SLOT_RE.test(e.label) || isDiningPlace(e.place, classifyKind),
  );
}

export function scenicKindsForStyle(style: TripStyleKey): PlanPlaceKind[] {
  if (style === "local_life") return ["shopping", "culture", "attraction"];
  if (style === "slow_nature") return ["nature", "culture", "attraction"];
  if (style === "classic_landmarks") return ["attraction", "culture", "nature"];
  return ["attraction", "culture", "nature", "shopping"];
}

function parseTimeMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function logAiSlotValidateStart(): void {
  logAiPipeline("[AI_SLOT_VALIDATE_START]");
}

export function logAiSlotValidateFail(reason: string, detail: string, day?: number): void {
  logAiPipeline(
    "[AI_SLOT_VALIDATE_FAIL]",
    `reason=${reason}`,
    day != null ? `day=${day}` : "",
    detail ? `name=${detail}` : "",
  );
}

export function logAiSlotReorder(): void {
  logAiPipeline("[AI_SLOT_REORDER]");
}

export function logAiSlotReplacementSearch(slot: string, type: string): void {
  logAiPipeline("[AI_SLOT_REPLACEMENT_SEARCH]", `slot=${slot}`, `type=${type}`);
}

export function logAiDayPlanValidated(day: number, itemCount: number): void {
  logAiPipeline("[AI_DAY_PLAN_VALIDATED]", `day=${day}`, `itemCount=${itemCount}`);
}

export type SlotValidationResult = {
  ok: boolean;
  reasons: string[];
};

export function validateDayPlanSlots(
  plans: ComposedDayPlan[],
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): SlotValidationResult {
  logAiSlotValidateStart();
  const reasons: string[] = [];

  for (const plan of plans) {
    if (!plan.entries.length) {
      reasons.push(`empty_day:day${plan.day}`);
      logAiSlotValidateFail("empty_day", `day${plan.day}`, plan.day);
      continue;
    }

    let cafeCount = 0;
    let scenicCount = 0;
    let hasMorning = false;

    for (const entry of plan.entries) {
      const kind = classifyKind(entry.place);
      const name = entry.name;

      if (isExcludedRetailPlace(entry.place)) {
        reasons.push(`excluded_retail:${name}`);
        logAiSlotValidateFail("excluded_retail", name, plan.day);
      }

      if (/咖啡/.test(entry.label) && (kind === "cafe" || isCafePlace(entry.place))) {
        cafeCount += 1;
        if (cafeCount > 1) {
          reasons.push(`duplicate_cafe:day${plan.day}`);
          logAiSlotValidateFail("duplicate_cafe", name, plan.day);
        }
      }

      if (LUNCH_SLOT_RE.test(entry.label)) {
        if (!isMealSlotEligiblePlace(entry.place) || !isProperRestaurantPlace(entry.place)) {
          reasons.push(`lunch_not_restaurant:${name}`);
          logAiSlotValidateFail("lunch_not_restaurant", name, plan.day);
        }
        if (isNightMarketPlace(entry.place) || kind === "night_market") {
          reasons.push(`night_market_at_lunch:${name}`);
          logAiSlotValidateFail("night_market_at_lunch", name, plan.day);
        }
      }

      if (DINNER_SLOT_RE.test(entry.label)) {
        const okDinner =
          isProperRestaurantPlace(entry.place) ||
          (isNightMarketPlace(entry.place) && parseTimeMinutes(entry.time) >= 18 * 60);
        if (!okDinner) {
          reasons.push(`dinner_invalid:${name}`);
          logAiSlotValidateFail("lunch_not_restaurant", name, plan.day);
        }
      }

      if (isNightMarketPlace(entry.place) && parseTimeMinutes(entry.time) < 18 * 60) {
        reasons.push(`night_market_too_early:${name}`);
        logAiSlotValidateFail("night_market_at_lunch", name, plan.day);
      }

      if (isScenicPlaceKind(kind) || kind === "market") {
        scenicCount += 1;
      }
      if (parseTimeMinutes(entry.time) <= MORNING_END_MINUTES && (isScenicPlaceKind(kind) || kind === "market")) {
        hasMorning = true;
      }
    }

    if (plan.entries.length > 0 && plan.entries.length < minEntriesPerDayForTripDays(3)) {
      reasons.push(`too_few_items:day${plan.day}`);
    }
    if (scenicCount < 1 && plan.entries.length > 0) {
      reasons.push(`no_scenic:day${plan.day}`);
    }
    if (plan.entries.length > 0 && !hasMorning) {
      const firstTime = plan.entries[0]?.time ?? "12:00";
      if (parseTimeMinutes(firstTime) >= 12 * 60) {
        reasons.push(`empty_morning:day${plan.day}`);
      }
    }

    logAiDayPlanValidated(plan.day, plan.entries.length);
  }

  return { ok: reasons.length === 0, reasons };
}

export const STRUCTURED_DAY_SLOTS: DayPlanSlot[] = standardItinerarySlotsFromTemplate();

export const CLASSIC_LANDMARK_DAY_SLOTS: DayPlanSlot[] = standardItinerarySlotsFromTemplate();

export const SLOW_NATURE_DAY_SLOTS: DayPlanSlot[] = standardItinerarySlotsFromTemplate();

export const MIXED_DAY_SLOTS: DayPlanSlot[] = standardItinerarySlotsFromTemplate();

function standardItinerarySlotsFromTemplate(): DayPlanSlot[] {
  return [
    { time: "08:30", kind: "restaurant", label: "早餐" },
    { time: "10:00", kind: "attraction", label: "景點" },
    { time: "12:00", kind: "restaurant", label: "午餐" },
    { time: "14:00", kind: "attraction", label: "景點" },
    { time: "16:00", kind: "cafe", label: "咖啡" },
    { time: "18:00", kind: "restaurant", label: "晚餐" },
    { time: "20:00", kind: "night_market", label: "酒吧" },
  ];
}

export function slotsForStyle(_style: TripStyleKey): DayPlanSlot[] {
  return standardItinerarySlotsFromTemplate();
}

export function canFillStructuredSlot(
  place: PlaceResult,
  slot: DayPlanSlot,
  dayState: { cafeCount: number },
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
  plannedDate?: string,
): boolean {
  if (isExcludedRetailPlace(place)) return false;
  if (!canPlaceFillSlotByCategory(place, slot)) return false;
  if (!validatePlaceOpenAtTime(place, plannedDate, slot.time)) return false;

  const kind = classifyKind(place);

  if (LUNCH_SLOT_RE.test(slot.label)) {
    return isProperRestaurantPlace(place) && !isBarBistroPlace(place);
  }
  if (DINNER_SLOT_RE.test(slot.label)) {
    return (
      (isProperRestaurantPlace(place) || isBarBistroPlace(place)) &&
      !isMuseumCulturePlace(place) &&
      (parseTimeMinutes(slot.time) >= 18 * 60 || isNightMarketPlace(place))
    );
  }
  if (isNonMealActivitySlot(slot)) {
    if (isDiningPlace(place, classifyKind)) return false;
    if (isFoodVenuePlace(place) || isBarBistroPlace(place)) return false;
  }
  if (slot.kind === "cafe" || /咖啡|下午茶/.test(slot.label)) {
    if (dayState.cafeCount >= 1) return false;
    return isCafePlace(place) || kind === "cafe";
  }
  if (slot.time === "09:00" || parseTimeMinutes(slot.time) <= MORNING_END_MINUTES) {
    if (isNightMarketPlace(place)) return false;
    if (isFoodVenuePlace(place) || isBarBistroPlace(place)) return false;
    if (isCafePlace(place) && !/咖啡|下午茶/.test(slot.label)) return false;
    return isScenicPlaceKind(kind) || kind === "market";
  }
  if (parseTimeMinutes(slot.time) >= 17 * 60 && isMuseumCulturePlace(place)) return false;
  if (isNightMarketPlace(place)) {
    return parseTimeMinutes(slot.time) >= 18 * 60;
  }
  if (isMarketPlace(place)) {
    return !MEAL_SLOT_RE.test(slot.label);
  }
  if (isFoodVenuePlace(place) && !/早餐|午餐|晚餐|宵夜|咖啡|下午茶/.test(slot.label)) {
    return false;
  }
  return true;
}

export function buildStructuredDayPlans(params: {
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  classifyKind: (place: PlaceResult) => PlanPlaceKind;
  resolveLabel: (slot: DayPlanSlot, place: PlaceResult) => string;
  plannedDate?: string;
}): ComposedDayPlan[] {
  const { places, days, style, classifyKind, resolveLabel, plannedDate } = params;
  const safeDays = Math.max(1, days);
  const minPerDay = minEntriesPerDayForTripDays(safeDays);
  const pool = filterExcludedRetailPlaces(places);
  const used = new Set<string>();
  const byKind: Record<PlanPlaceKind, PlaceResult[]> = {
    attraction: [],
    restaurant: [],
    cafe: [],
    shopping: [],
    market: [],
    culture: [],
    nature: [],
    night_market: [],
  };

  for (const place of pool) {
    const id = resolveTripPlaceId(place);
    if (!id || used.has(id)) continue;
    if (isGeocodeEmptyPlace(place)) continue;
    const kind = classifyKind(place);
    if (isExcludedRetailPlace(place)) continue;
    byKind[kind]?.push(place);
  }

  const pickFrom = (
    kinds: PlanPlaceKind[],
    day: number,
    filter?: (p: PlaceResult) => boolean,
  ): PlaceResult | undefined => {
    for (const kind of kinds) {
      for (const place of byKind[kind] ?? []) {
        const id = resolveTripPlaceId(place);
        if (!id || used.has(id)) {
          if (id && used.has(id)) logAiPlaceRejectDuplicate(day, id, "already_used");
          continue;
        }
        if (isGeocodeEmptyPlace(place)) continue;
        if (filter && !filter(place)) continue;
        used.add(id);
        logAiPlaceSelected(day, id);
        return place;
      }
    }
    return undefined;
  };

  const slotBlueprint = slotsForStyle(style);
  const plans: ComposedDayPlan[] = [];

  for (let day = 1; day <= safeDays; day += 1) {
    plans.push({ day, entries: [] });
  }

  for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
    const dayState = { cafeCount: 0 };
    const day = dayIndex + 1;
    let entries: DayPlanEntry[] = [];

    for (const slot of slotBlueprint) {
      let place: PlaceResult | undefined;
      if (LUNCH_SLOT_RE.test(slot.label)) {
        logAiSlotReplacementSearch("lunch", "restaurant");
        place = pickFrom(["restaurant"], day, (p) => isProperRestaurantPlace(p) && isMealSlotEligiblePlace(p));
      } else if (DINNER_SLOT_RE.test(slot.label)) {
        place =
          pickFrom(["restaurant"], day, (p) => isProperRestaurantPlace(p) && isMealSlotEligiblePlace(p)) ??
          pickFrom(["night_market"], day, (p) => isMealSlotEligiblePlace(p) && parseTimeMinutes(slot.time) >= 18 * 60);
      } else if (slot.kind === "cafe" || /咖啡/.test(slot.label)) {
        if (dayState.cafeCount < 1) {
          place = pickFrom(["cafe"], day, (p) => isCafePlace(p) && canFillStructuredSlot(p, slot, dayState, classifyKind, plannedDate));
          if (place) dayState.cafeCount += 1;
        }
      } else if (isNonMealActivitySlot(slot)) {
        const scenicKinds =
          style === "slow_nature"
            ? ["nature", "culture", "attraction", "market", "shopping"]
            : style === "local_life"
              ? ["shopping", "culture", "attraction"]
              : ["attraction", "culture", "nature", "shopping"];
        place = pickFrom(scenicKinds as PlanPlaceKind[], day, (p) =>
          canFillStructuredSlot(p, slot, dayState, classifyKind, plannedDate),
        );
      } else {
        const afternoonKinds: PlanPlaceKind[] = scenicKindsForStyle(style);
        place = pickFrom(afternoonKinds, day, (p) => canFillStructuredSlot(p, slot, dayState, classifyKind, plannedDate));
      }

      if (!place?.name) continue;
      if (!canPlaceFillSlotByCategory(place, slot)) {
        const id = resolveTripPlaceId(place);
        if (id) used.delete(id);
        continue;
      }
      if (isCafePlace(place) && !LUNCH_SLOT_RE.test(slot.label) && !DINNER_SLOT_RE.test(slot.label)) {
        dayState.cafeCount += 1;
      }
      entries.push({
        time: slot.time,
        label: resolvePlaceCategoryLabel(place, slot),
        name: place.name,
        place,
      });
    }

    entries = supplementDayPlanEntries({
      entries,
      day: dayIndex + 1,
      pool,
      used,
      style,
      totalDays: safeDays,
      classifyKind,
      resolveLabel,
      plannedDate,
    });

    plans[dayIndex] = {
      day: dayIndex + 1,
      entries,
      isIncomplete: entries.length < minPerDay,
    };
  }

  logAiSlotReorder();
  return plans;
}

export function dedupeEntryTimes(entries: DayPlanEntry[]): DayPlanEntry[] {
  const seen = new Set<number>();
  const fallbackTimes = ["08:30", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];
  const out: DayPlanEntry[] = [];

  for (const entry of entries) {
    let time = entry.time;
    let minutes = parseTimeMinutes(time);
    if (seen.has(minutes)) {
      const replacement = fallbackTimes.find((slot) => !seen.has(parseTimeMinutes(slot)));
      if (replacement) {
        time = replacement;
        minutes = parseTimeMinutes(time);
      }
    }
    seen.add(minutes);
    out.push(time === entry.time ? entry : { ...entry, time });
  }

  return out;
}

export function repairDayPlanSlots(
  plans: ComposedDayPlan[],
  places: PlaceResult[],
  style: TripStyleKey,
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
  resolveLabel: (slot: DayPlanSlot, place: PlaceResult) => string,
  totalDays: number,
  plannedDate?: string,
): ComposedDayPlan[] {
  const safeDays = Math.max(totalDays, plans.length, 1);
  const minPerDay = minEntriesPerDayForTripDays(safeDays);
  const pool = filterExcludedRetailPlaces(filterRealPlanningPlaces(places));
  const used = new Set<string>();

  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = resolveTripPlaceId(entry.place);
      if (id) used.add(id);
    }
  }

  const byDay = new Map(plans.map((plan) => [plan.day, plan]));
  const repaired: ComposedDayPlan[] = [];

  for (let day = 1; day <= safeDays; day += 1) {
    const plan = byDay.get(day) ?? { day, entries: [] };
    const dayState = { cafeCount: 0 };
    const entries: DayPlanEntry[] = [];

    for (const entry of plan.entries) {
      if (isExcludedRetailPlace(entry.place)) continue;

      const kind = classifyKind(entry.place);
      const isCafe = kind === "cafe" || isCafePlace(entry.place);
      const isDining = isDiningPlace(entry.place, classifyKind);

      if (isCafe) {
        if (dayState.cafeCount >= 1) continue;
        dayState.cafeCount += 1;
      }

      if (isDining && !MEAL_SLOT_RE.test(entry.label) && !/咖啡/.test(entry.label)) {
        logAiSlotCategoryMismatch(entry.name, entry.label, "dining_in_scenic_slot");
        continue;
      }

      if (LUNCH_SLOT_RE.test(entry.label) && !isMealSlotEligiblePlace(entry.place)) {
        continue;
      }
      if (DINNER_SLOT_RE.test(entry.label)) {
        const ok =
          isMealSlotEligiblePlace(entry.place) &&
          (isProperRestaurantPlace(entry.place) ||
            (isNightMarketPlace(entry.place) && parseTimeMinutes(entry.time) >= 18 * 60));
        if (!ok) continue;
      }
      if (isNightMarketPlace(entry.place) && parseTimeMinutes(entry.time) < 18 * 60) {
        continue;
      }

      entries.push(entry);
    }

    const supplemented = supplementDayPlanEntries({
      entries,
      day,
      pool,
      used,
      style,
      totalDays: safeDays,
      classifyKind,
      resolveLabel,
      plannedDate,
    });

    repaired.push({
      day,
      entries: dedupeEntryTimes(supplemented),
      isIncomplete: supplemented.length < minPerDay,
    });
  }

  return repaired;
}

export type ItineraryValidation = {
  ok: boolean;
  reasons: string[];
  failedDays: number[];
};

const BREAKFAST_SLOT_RE = /早餐/;
const AFTERNOON_TEA_SLOT_RE = /下午茶/;
const MAX_BACKTRACK_METERS = 18_000;

function hasCoords(place: PlaceResult): boolean {
  return place.lat != null && place.lng != null;
}

function entryDistanceM(a: DayPlanEntry, b: DayPlanEntry): number {
  if (!hasCoords(a.place) || !hasCoords(b.place)) return Number.POSITIVE_INFINITY;
  return distanceMeters(
    { lat: a.place.lat!, lng: a.place.lng! },
    { lat: b.place.lat!, lng: b.place.lng! },
  );
}

function nearestNeighborOrder(entries: DayPlanEntry[]): DayPlanEntry[] {
  if (entries.length <= 2) return entries;
  const remaining = [...entries];
  const ordered: DayPlanEntry[] = [];
  ordered.push(remaining.shift()!);
  while (remaining.length) {
    const last = ordered[ordered.length - 1]!;
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const d = entryDistanceM(last, remaining[i]!);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return ordered;
}

export function sortComposedDayPlans(plans: ComposedDayPlan[]): ComposedDayPlan[] {
  logAiSlotReorder();
  return plans.map((plan) => {
    const meals = plan.entries.filter((e) => MEAL_SLOT_RE.test(e.label) || BREAKFAST_SLOT_RE.test(e.label));
    const scenic = plan.entries.filter((e) => !MEAL_SLOT_RE.test(e.label) && !BREAKFAST_SLOT_RE.test(e.label));
    const orderedScenic = nearestNeighborOrder(scenic);
    const merged: DayPlanEntry[] = [];
    const slots = [...meals, ...orderedScenic].sort(
      (a, b) => parseTimeMinutes(a.time) - parseTimeMinutes(b.time),
    );
    for (const entry of slots) {
      if (!merged.some((m) => (m.place.id ?? m.name) === (entry.place.id ?? entry.name))) {
        merged.push(entry);
      }
    }
    return { day: plan.day, entries: merged };
  });
}

export function validateItineraryOrder(plans: ComposedDayPlan[]): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    const scenic = plan.entries.filter((e) => !MEAL_SLOT_RE.test(e.label));
    for (let i = 0; i < scenic.length - 2; i += 1) {
      const a = scenic[i]!;
      const b = scenic[i + 1]!;
      const c = scenic[i + 2]!;
      const ab = entryDistanceM(a, b);
      const ac = entryDistanceM(a, c);
      const bc = entryDistanceM(b, c);
      if (ab > MAX_BACKTRACK_METERS && ac < ab && bc < ab) {
        reasons.push(`route_backtrack:day${plan.day}:${a.name}->${c.name}->${b.name}`);
        failedDays.add(plan.day);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateTripTimeline(plans: ComposedDayPlan[]): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    const seenTimes = new Map<number, string>();
    for (const entry of plan.entries) {
      const minutes = parseTimeMinutes(entry.time);
      const prev = seenTimes.get(minutes);
      if (prev) {
        reasons.push(`time_conflict:day${plan.day}:${entry.time}:${prev}+${entry.name}`);
        failedDays.add(plan.day);
      } else {
        seenTimes.set(minutes, entry.name);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateRestaurantSlots(
  plans: ComposedDayPlan[],
  style?: TripStyleKey,
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    const hasBreakfast = plan.entries.some((e) => BREAKFAST_SLOT_RE.test(e.label));
    const hasLunch = plan.entries.some((e) => LUNCH_SLOT_RE.test(e.label));
    const hasDinner = plan.entries.some((e) => DINNER_SLOT_RE.test(e.label));

    if (!hasBreakfast || !hasLunch || !hasDinner) {
      reasons.push(`missing_meals:day${plan.day}:b=${hasBreakfast}:l=${hasLunch}:d=${hasDinner}`);
      failedDays.add(plan.day);
    }

    for (const entry of plan.entries) {
      if (LUNCH_SLOT_RE.test(entry.label)) {
        if (
          !isMealSlotEligiblePlace(entry.place) ||
          !isProperRestaurantPlace(entry.place) ||
          isBarBistroPlace(entry.place) ||
          isCultureCreativeAreaPlace(entry.place)
        ) {
          reasons.push(`lunch_invalid:${entry.name}`);
          failedDays.add(plan.day);
        }
        if (parseTimeMinutes(entry.time) < 11 * 60 + 30 || parseTimeMinutes(entry.time) >= 13 * 60 + 30) {
          reasons.push(`lunch_bad_time:${entry.name}@${entry.time}`);
          failedDays.add(plan.day);
        }
        if (isNightMarketPlace(entry.place)) {
          reasons.push(`night_market_at_lunch:${entry.name}`);
          failedDays.add(plan.day);
        }
      }
      if (BREAKFAST_SLOT_RE.test(entry.label)) {
        if (
          isBarBistroPlace(entry.place) ||
          isNightMarketPlace(entry.place) ||
          isCultureCreativeAreaPlace(entry.place) ||
          (!isProperRestaurantPlace(entry.place) && !isCafePlace(entry.place))
        ) {
          reasons.push(`breakfast_invalid:${entry.name}`);
          failedDays.add(plan.day);
        }
        if (parseTimeMinutes(entry.time) < 7 * 60 || parseTimeMinutes(entry.time) >= 10 * 60) {
          reasons.push(`breakfast_bad_time:${entry.name}@${entry.time}`);
          failedDays.add(plan.day);
        }
      }
      if (DINNER_SLOT_RE.test(entry.label)) {
        if (isMuseumCulturePlace(entry.place) || isCultureCreativeAreaPlace(entry.place)) {
          reasons.push(`museum_at_dinner:${entry.name}`);
          failedDays.add(plan.day);
        }
        const okDinner =
          isProperRestaurantPlace(entry.place) ||
          isBarBistroPlace(entry.place) ||
          (isNightMarketPlace(entry.place) && parseTimeMinutes(entry.time) >= 17 * 60 + 30);
        if (!okDinner) {
          reasons.push(`dinner_invalid:${entry.name}`);
          failedDays.add(plan.day);
        }
        if (parseTimeMinutes(entry.time) < 17 * 60 + 30 || parseTimeMinutes(entry.time) >= 19 * 60 + 30) {
          reasons.push(`dinner_bad_time:${entry.name}@${entry.time}`);
          failedDays.add(plan.day);
        }
      }
      if (isBarBistroPlace(entry.place) && parseTimeMinutes(entry.time) < 17 * 60 + 30) {
        reasons.push(`bar_too_early:${entry.name}@${entry.time}`);
        failedDays.add(plan.day);
      }
      if (isNightMarketPlace(entry.place) && parseTimeMinutes(entry.time) < 19 * 60 + 30) {
        reasons.push(`night_market_too_early:${entry.name}@${entry.time}`);
        failedDays.add(plan.day);
      }
      if (parseTimeMinutes(entry.time) <= MORNING_END_MINUTES) {
        if (isFoodVenuePlace(entry.place) && !BREAKFAST_SLOT_RE.test(entry.label) && !/咖啡/.test(entry.label)) {
          reasons.push(`food_at_morning_scenic:${entry.name}`);
          failedDays.add(plan.day);
        }
      }
      if (MEAL_SLOT_RE.test(entry.label) && isCultureCreativeAreaPlace(entry.place)) {
        reasons.push(`culture_creative_as_meal:${entry.name}:${entry.label}`);
        failedDays.add(plan.day);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validatePlaceOpenAtTime(
  place: PlaceResult,
  date: string | undefined,
  plannedTime: string,
): boolean {
  const name = place.name ?? "";
  if (place.businessStatus === "CLOSED_PERMANENTLY") {
    logAiOpenHoursDrop(name, plannedTime, "permanently_closed");
    return false;
  }

  // closed_now reflects current status only — ignore when scheduling a future trip day.
  const planningFutureDay = Boolean(date?.trim());
  if (
    !planningFutureDay &&
    (place.normalizedOpeningStatus === "closed" || place.openStatus === "closed_now")
  ) {
    logAiOpenHoursDrop(name, plannedTime, "closed_now");
    return false;
  }

  const at = date ? new Date(`${date}T12:00:00`) : new Date();
  const hours = placeHoursDataFromPlace(place);
  const hasHours = hasOpeningHoursData(place);
  const scheduled = hasHours ? isOpenAtScheduled(hours, at, plannedTime) : null;

  if (scheduled === false) {
    // Tier A: known hours and closed at slot — reject meal/bar; scenic may still pass conservative rules.
    if (requiresOpeningHours(place) || isBarBistroPlace(place)) {
      logAiOpenHoursDrop(name, plannedTime, "not_open_at_scheduled");
      return false;
    }
    if (isMuseumCulturePlace(place) || isNightMarketPlace(place)) {
      logAiOpenHoursDrop(name, plannedTime, "not_open_at_scheduled");
      return false;
    }
    // Parks / landmarks with hours showing closed: still allow conservative morning/afternoon slots.
  }
  if (scheduled === true) {
    logAiOpenHoursValidate(name, plannedTime, true);
    return true;
  }

  const fromLabel = isOpenFromTodayHoursLabel(place, plannedTime);
  if (fromLabel === false) {
    if (requiresOpeningHours(place) || isBarBistroPlace(place)) {
      logAiOpenHoursDrop(name, plannedTime, "hours_label_closed");
      return false;
    }
  }
  if (fromLabel === true) {
    logAiOpenHoursValidate(name, plannedTime, true);
    return true;
  }

  // Tier B/C: no reliable opening hours — scenic uses conservative times; meals allowed for scheduling
  // (slot refill / details enrichment may replace if still unsuitable).
  if (!hasHours && (requiresOpeningHours(place) || isBarBistroPlace(place))) {
    logAiOpenHoursValidate(name, plannedTime, true);
    return true;
  }

  const minutes = parseTimeMinutes(plannedTime);
  const checkAt = new Date(at);
  checkAt.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (isTimePeriodMismatch(name, place.primaryType ?? undefined, checkAt)) {
    logAiOpenHoursDrop(name, plannedTime, "time_period_mismatch");
    return false;
  }
  if (isNightMarketPlace(place) && minutes < 18 * 60) {
    logAiOpenHoursDrop(name, plannedTime, "night_market_too_early");
    return false;
  }
  if (isBarBistroPlace(place) && minutes < 11 * 60) {
    logAiOpenHoursDrop(name, plannedTime, "bar_too_early");
    return false;
  }
  if (isMuseumCulturePlace(place) && minutes >= 19 * 60) {
    logAiOpenHoursDrop(name, plannedTime, "museum_too_late");
    return false;
  }
  if (BREAKFAST_SLOT_RE.test(plannedTime) || minutes < 10 * 60) {
    if (/僅供午餐|午餐開始|11:00|11點/.test(place.todayHoursLabel ?? "")) {
      logAiOpenHoursDrop(name, plannedTime, "lunch_only");
      return false;
    }
  }

  logAiOpenHoursValidate(name, plannedTime, true);
  return true;
}

export function validatePlaceCategoryLabels(
  plans: ComposedDayPlan[],
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    for (const entry of plan.entries) {
      if (!isAllowedItinerarySlotLabel(entry.label)) {
        reasons.push(`disallowed_label:${entry.name}:${entry.label}`);
        logAiSlotCategoryMismatch(entry.name, entry.label, "disallowed");
        failedDays.add(plan.day);
        continue;
      }
      if (!entryLabelMatchesPlace(entry.label, entry.place, entry.time)) {
        reasons.push(`label_place_mismatch:${entry.name}:${entry.label}`);
        logAiSlotCategoryMismatch(entry.name, entry.label, "mismatch");
        failedDays.add(plan.day);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateRealPlanningEntries(plans: ComposedDayPlan[]): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();
  const seenIds = new Set<string>();

  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = resolvePlanningPlaceId(entry.place);
      if (!isRealGooglePlanningPlace(entry.place)) {
        reasons.push(`synthetic_place:${entry.name}:${id || "no_id"}`);
        failedDays.add(plan.day);
      }
      if (isPlaceholderPlanningPlaceName(entry.name)) {
        reasons.push(`placeholder_name:${entry.name}`);
        failedDays.add(plan.day);
      }
      if (id) {
        if (seenIds.has(id)) {
          reasons.push(`duplicate_place_id:${entry.name}`);
          failedDays.add(plan.day);
        }
        seenIds.add(id);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateDailyScenicComposition(
  plans: ComposedDayPlan[],
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    const scenic = plan.entries.filter((entry) => entry.label === "景點");
    if (plan.entries.length > 0 && scenic.length < 2) {
      reasons.push(`too_few_scenic:day${plan.day}:${scenic.length}`);
      failedDays.add(plan.day);
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateParentLandmarkDuplicates(plans: ComposedDayPlan[]): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();
  const parentToNames = new Map<string, { day: number; name: string }[]>();

  for (const plan of plans) {
    for (const entry of plan.entries) {
      const parentKey = resolveParentLandmarkKey(entry.name);
      if (!parentKey) continue;
      const list = parentToNames.get(parentKey) ?? [];
      list.push({ day: plan.day, name: entry.name });
      parentToNames.set(parentKey, list);
    }
  }

  for (const [parentKey, entries] of parentToNames) {
    if (entries.length <= 1) continue;
    reasons.push(
      `parent_landmark_dup:${parentKey}:${entries.map((e) => `d${e.day}:${e.name}`).join("|")}`,
    );
    entries.forEach((e) => failedDays.add(e.day));
    logAiPipeline(
      "[AI_PARENT_LANDMARK_VALIDATE_FAIL]",
      `parent=${parentKey}`,
      `count=${entries.length}`,
    );
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateCompleteItinerary(
  plans: ComposedDayPlan[],
  requestedDays: number,
  style: TripStyleKey | undefined,
  plannedDate: string | undefined,
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): ItineraryValidation {
  const normalized = ensurePlansForValidation(plans, requestedDays);
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  if (normalized.length !== requestedDays) {
    return { ok: false, reasons: ["day_count_mismatch"], failedDays: [] };
  }

  const minPerDay = minEntriesPerDayForTripDays(requestedDays);
  const maxPerDay = minPerDay;
  for (const plan of normalized) {
    if (plan.entries.length < minPerDay) {
      reasons.push(`incomplete_day:${plan.day}:${plan.entries.length}<${minPerDay}`);
      failedDays.add(plan.day);
    } else if (plan.entries.length > maxPerDay) {
      reasons.push(`overflow_day:${plan.day}:${plan.entries.length}>${maxPerDay}`);
      failedDays.add(plan.day);
    }
  }

  for (const check of [
    validateParentLandmarkDuplicates,
    validateRealPlanningEntries,
    (p: ComposedDayPlan[]) => validateItinerary(p, classifyKind, style, plannedDate, requestedDays),
  ]) {
    const result = check(normalized);
    if (!result.ok) {
      reasons.push(...result.reasons);
      result.failedDays.forEach((day) => failedDays.add(day));
    }
  }

  const scenicResult = validateDailyScenicComposition(normalized, classifyKind);
  if (!scenicResult.ok) {
    logAiPipeline(
      "[AI_SCENIC_COMPOSITION_ADVISORY]",
      scenicResult.reasons.slice(0, 4).join(";") || "scenic_mismatch",
    );
  }

  const validation = { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
  logAiPipeline(
    "[AI_COMPLETE_ITINERARY_VALIDATE]",
    `ok=${validation.ok}`,
    `days=${requestedDays}`,
    validation.reasons.length ? `reasons=${validation.reasons.slice(0, 5).join(";")}` : "",
  );
  return validation;
}

export function validateStyleComposition(
  plans: ComposedDayPlan[],
  style: TripStyleKey,
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    if (!plan.entries.length) continue;

    const scenic = plan.entries.filter((e) => {
      const k = classifyKind(e.place);
      return isScenicPlaceKind(k) || k === "market";
    });
    const cafes = plan.entries.filter((e) => classifyKind(e.place) === "cafe" || isCafePlace(e.place));
    const culture = plan.entries.filter((e) => classifyKind(e.place) === "culture");
    const restaurants = plan.entries.filter((e) => {
      if (/酒吧|咖啡/.test(e.label)) return false;
      if (isBarBistroPlace(e.place)) return false;
      return MEAL_SLOT_RE.test(e.label);
    });
    const total = plan.entries.length;
    const restaurantRatio = restaurants.length / total;

    if (style === "slow_nature") {
      if (restaurantRatio > 0.45) {
        reasons.push(`slow_nature_too_many_restaurants:day${plan.day}`);
        logAiRestaurantRatioExceeded(restaurantRatio, 0.45);
        failedDays.add(plan.day);
      }
      if (scenic.length < 2) {
        reasons.push(`slow_nature_too_few_scenic:day${plan.day}`);
        failedDays.add(plan.day);
      }
      const morningFood = plan.entries.filter(
        (e) =>
          parseTimeMinutes(e.time) <= MORNING_END_MINUTES &&
          isFoodVenuePlace(e.place) &&
          !BREAKFAST_SLOT_RE.test(e.label),
      );
      if (morningFood.length > 0) {
        reasons.push(`slow_nature_food_at_morning:day${plan.day}`);
        failedDays.add(plan.day);
      }
    }

    if (style === "mixed") {
      if (restaurantRatio > 0.5) {
        reasons.push(`mixed_too_many_restaurants:day${plan.day}`);
        logAiRestaurantRatioExceeded(restaurantRatio, 0.5);
        failedDays.add(plan.day);
      }
      const scenicLabels = plan.entries.filter((e) => e.label === "景點").length;
      const hasLunch = plan.entries.some((e) => LUNCH_SLOT_RE.test(e.label));
      const hasDinner = plan.entries.some((e) => DINNER_SLOT_RE.test(e.label));
      if (scenicLabels < 2 || !hasLunch || !hasDinner) {
        reasons.push(`mixed_missing_composition:day${plan.day}`);
        failedDays.add(plan.day);
      }
    }

    if (style === "local_life") {
      // local_life 僅影響候選排序，不作額外 composition 硬性驗證
    }

    const ok = !failedDays.has(plan.day);
    logAiStyleCompositionValidate(
      style,
      ok,
      `day=${plan.day} scenic=${scenic.length} cafe=${cafes.length} culture=${culture.length} restaurants=${restaurants.length}`,
    );
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

export function validateOpenHours(
  plans: ComposedDayPlan[],
  plannedDate?: string,
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();

  for (const plan of plans) {
    const dayDate = plannedDate
      ? addDaysToIsoDate(plannedDate, plan.day - 1)
      : undefined;
    for (const entry of plan.entries) {
      if (!validatePlaceOpenAtTime(entry.place, dayDate, entry.time)) {
        reasons.push(`closed_at_time:${entry.name}@${entry.time}`);
        failedDays.add(plan.day);
      }
    }
  }

  return { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function logAiDayPlanValidate(ok: boolean, reasons: string[]): void {
  logAiPipeline("[AI_DAY_PLAN_VALIDATE]", `ok=${ok}`, reasons.length ? `reasons=${reasons.join(";")}` : "");
}

export function logAiItineraryValidation(ok: boolean, reasons: string[]): void {
  logAiPipeline("[AI_ITINERARY_VALIDATION]", `ok=${ok}`, reasons.length ? `reasons=${reasons.join(";")}` : "");
}

export function validateItinerary(
  plans: ComposedDayPlan[],
  classifyKind: (place: PlaceResult) => PlanPlaceKind,
  style?: TripStyleKey,
  plannedDate?: string,
  requestedDays?: number,
): ItineraryValidation {
  const reasons: string[] = [];
  const failedDays = new Set<number>();
  const safeDays = requestedDays ?? Math.max(1, ...plans.map((p) => p.day), 1);
  const minPerDay = minEntriesPerDayForTripDays(safeDays);

  for (let day = 1; day <= safeDays; day += 1) {
    const plan = plans.find((p) => p.day === day);
    if (!plan) {
      reasons.push(`missing_day:${day}`);
      failedDays.add(day);
      continue;
    }
    if (plan.entries.length < minPerDay) {
      reasons.push(`incomplete_day:${day}:${plan.entries.length}<${minPerDay}`);
      failedDays.add(day);
      plan.isIncomplete = true;
    } else {
      plan.isIncomplete = false;
    }
  }

  const slot = validateDayPlanSlots(plans, classifyKind);
  if (!slot.ok) reasons.push(...slot.reasons);

  for (const check of [
    validateItineraryOrder,
    validateTripTimeline,
    (p: ComposedDayPlan[]) => validateRestaurantSlots(p, style),
    (p: ComposedDayPlan[]) => validateOpenHours(p, plannedDate),
    validatePlaceCategoryLabels,
    (p: ComposedDayPlan[]) => validateNoExcludedRetailPlaces(p, style),
  ]) {
    const result = check(plans);
    if (!result.ok) {
      reasons.push(...result.reasons);
      result.failedDays.forEach((day) => failedDays.add(day));
    }
  }

  if (style) {
    const styleResult = validateStyleComposition(plans, style, classifyKind);
    if (!styleResult.ok) {
      logAiPipeline(
        "[AI_STYLE_COMPOSITION_ADVISORY]",
        styleResult.reasons.slice(0, 4).join(";") || "style_mismatch",
      );
    }
  }

  const validation = { ok: reasons.length === 0, reasons, failedDays: [...failedDays] };
  logAiDayPlanValidate(validation.ok, validation.reasons);
  logAiItineraryValidation(validation.ok, validation.reasons);
  return validation;
}
