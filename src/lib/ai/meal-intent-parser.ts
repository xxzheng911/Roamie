import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  hasOpeningHoursData,
  isBarBistroPlace,
  isFoodVenuePlace,
  isMuseumCulturePlace,
  isNightMarketPlace,
  logAiOpenHoursDrop,
  validatePlaceOpenAtTime,
} from "@/lib/ai/ai-day-plan-slot-rules";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

export type MealSlot = "breakfast" | "lunch" | "afternoon_tea" | "dinner" | "late_night";

export type ParsedMealIntent = {
  slot: MealSlot;
  targetDate?: string;
  targetTime: string;
  city?: string;
};

/** True only when the user named a meal slot — not a generic 餐廳/美食 recommendation. */
export function isExplicitMealSlotText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/宵夜|深夜|late\s*night/i.test(t)) return true;
  if (/晚餐|晚飯|dinner|晚上吃/.test(t)) return true;
  if (/下午茶|甜點/.test(t) && !/餐廳/.test(t)) return true;
  if (/早餐|早午餐|brunch/i.test(t)) return true;
  if (/中午|午餐|午飯|lunch|12點|12:00|12：00/.test(t)) return true;
  return false;
}

const NIGHT_VENUE_RE =
  /bar|bistro|pub|lounge|cocktail|rooftop|roof\s*·|屋面|餐酒館|酒吧|夜店|居酒|眺吧|夜景餐廳|night\s*view|sky\s*bar|lounge|屋頂酒吧|餐酒/i;

const LUNCH_OK_RE =
  /restaurant|food|lunch|noodle|ramen|麵|飯|小吃|料理|brunch|早餐店若中午|在地|必吃/i;

export function logAiMealIntentParsed(intent: ParsedMealIntent): void {
  logAiPipeline(
    "[AI_MEAL_INTENT_PARSED]",
    `slot=${intent.slot}`,
    intent.city ? `city=${intent.city}` : "",
    intent.targetDate ? `targetDate=${intent.targetDate}` : "targetDate=tomorrow",
    `targetTime=${intent.targetTime}`,
  );
}

export function logAiMealSlotValidate(place: string, slot: MealSlot, ok: boolean): void {
  logAiPipeline("[AI_MEAL_SLOT_VALIDATE]", `place=${place}`, `slot=${slot}`, `ok=${ok}`);
}

export function logAiMealSlotDrop(place: string, reason: string): void {
  logAiPipeline("[AI_MEAL_SLOT_DROP]", `place=${place}`, `reason=${reason}`);
}

export function logAiMealOpenHoursValidate(place: string, ok: boolean): void {
  logAiPipeline("[AI_MEAL_OPEN_HOURS_VALIDATE]", `place=${place}`, `ok=${ok}`);
}

export function logAiMealRecommendationReady(count: number, slot: MealSlot): void {
  logAiPipeline("[AI_MEAL_RECOMMENDATION_READY]", `count=${count}`, `slot=${slot}`);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function tomorrowIso(ref = new Date()): string {
  return addDaysIso(ref.toISOString().slice(0, 10), 1);
}

function extractCity(text: string): string | undefined {
  const m = text.match(
    /([\u4e00-\u9fff]{2,8}(?:市|縣|區)?)(?:有|的|附近|推薦|午餐|晚餐|餐廳|美食)/,
  );
  if (m?.[1]) return normalizeDestinationLabel(m[1].replace(/市$/, ""));
  const dest = text.match(/(高雄|台北|台中|台南|桃園|新北|基隆|新竹|嘉義|屏東|花蓮|台東|金門|澎湖|馬祖)/);
  return dest?.[1] ? normalizeDestinationLabel(dest[1]) : undefined;
}

export function parseMealIntentFromText(
  text: string,
  refDate = new Date(),
): ParsedMealIntent | null {
  const t = text.trim();
  if (!t) return null;

  const city = extractCity(t);
  const hasFood =
    /餐廳|美食|吃飯|用餐|午餐|晚餐|早餐|宵夜|brunch|lunch|dinner|吃什麼|推薦.*吃/.test(t);
  if (!hasFood) return null;

  let slot: MealSlot | null = null;
  let targetTime = "12:00";
  let targetDate: string | undefined;

  if (/宵夜|深夜|late\s*night/i.test(t)) {
    slot = "late_night";
    targetTime = "22:00";
  } else if (/晚餐|晚飯|dinner|晚上吃/.test(t)) {
    slot = "dinner";
    targetTime = "19:00";
  } else if (/下午茶|甜點|咖啡/.test(t) && !/餐廳/.test(t)) {
    slot = "afternoon_tea";
    targetTime = "15:00";
  } else if (/早餐|早午餐|brunch/i.test(t)) {
    slot = "breakfast";
    targetTime = "08:30";
  } else if (/中午|午餐|午飯|lunch|12點|12:00|12：00/.test(t)) {
    slot = "lunch";
    targetTime = "12:00";
  }

  if (!slot) return null;

  if (/明天|明日|tomorrow/i.test(t)) {
    targetDate = tomorrowIso(refDate);
  } else if (/今天|今日|today/i.test(t)) {
    targetDate = refDate.toISOString().slice(0, 10);
  }

  const intent: ParsedMealIntent = { slot, targetDate, targetTime, city };
  logAiMealIntentParsed(intent);
  return intent;
}

/**
 * Meal-slot search / hours filter is itinerary-grade.
 * Generic「有什麼餐廳推薦」must keep the restaurant category contract
 * that already passed quality — do not infer lunch.
 */
export function resolveExplicitMealIntent(
  text: string,
  refDate = new Date(),
): ParsedMealIntent | null {
  if (!isExplicitMealSlotText(text)) return null;
  return parseMealIntentFromText(text, refDate);
}

export function validateMealRecommendationSlot(
  place: PlaceResult,
  slot: MealSlot,
): boolean {
  const name = place.name ?? "";
  const blob = [name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (slot === "lunch") {
    if (isBarBistroPlace(place) || NIGHT_VENUE_RE.test(blob)) {
      logAiMealSlotDrop(name, "night_place_for_lunch");
      logAiMealSlotValidate(name, slot, false);
      return false;
    }
    if (isNightMarketPlace(place)) {
      logAiMealSlotDrop(name, "night_market_for_lunch");
      logAiMealSlotValidate(name, slot, false);
      return false;
    }
    if (isMuseumCulturePlace(place)) {
      logAiMealSlotDrop(name, "museum_for_lunch");
      logAiMealSlotValidate(name, slot, false);
      return false;
    }
  }

  if (slot === "dinner" && isMuseumCulturePlace(place)) {
    logAiMealSlotDrop(name, "museum_for_dinner");
    logAiMealSlotValidate(name, slot, false);
    return false;
  }

  if (slot === "breakfast" && (isBarBistroPlace(place) || NIGHT_VENUE_RE.test(blob))) {
    logAiMealSlotDrop(name, "bar_for_breakfast");
    logAiMealSlotValidate(name, slot, false);
    return false;
  }

  logAiMealSlotValidate(name, slot, true);
  return true;
}

export function validateMealPlaceOpenAtTarget(
  place: PlaceResult,
  intent: ParsedMealIntent,
): boolean {
  const date = intent.targetDate;
  const placeForCheck: PlaceResult =
    date && intent.slot === "lunch"
      ? {
          ...place,
          openStatus: undefined,
          normalizedOpeningStatus: undefined,
          openStatusLabel: undefined,
        }
      : place;
  const ok = validatePlaceOpenAtTime(placeForCheck, date, intent.targetTime);
  if (!ok) {
    logAiMealOpenHoursValidate(place.name ?? "", false);
    return false;
  }
  if ((isFoodVenuePlace(place) || isBarBistroPlace(place)) && !hasOpeningHoursData(place)) {
    logAiOpenHoursDrop(place.name ?? "", intent.targetTime, "missing_hours_food");
    logAiMealOpenHoursValidate(place.name ?? "", false);
    return false;
  }
  logAiMealOpenHoursValidate(place.name ?? "", true);
  return true;
}

export function filterPlacesForMealIntent(
  places: PlaceResult[],
  intent: ParsedMealIntent,
): PlaceResult[] {
  return places.filter((place) => {
    if (!validateMealRecommendationSlot(place, intent.slot)) return false;
    if (!validateMealPlaceOpenAtTarget(place, intent)) return false;
    return true;
  });
}

export function buildMealSearchAttempts(city: string, slot: MealSlot): SearchAttempt[] {
  const label = normalizeDestinationLabel(city);
  switch (slot) {
    case "lunch":
      return [
        { query: `${label} 午餐 餐廳`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 中午 營業 餐廳`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 在地午餐`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 必吃午餐`, mode: "text", includedTypes: ["restaurant", "food"] },
      ];
    case "dinner":
      return [
        { query: `${label} 晚餐 餐廳`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 晚餐 營業中`, mode: "text", includedTypes: ["restaurant", "food"] },
        { query: `${label} 在地晚餐`, mode: "text", includedTypes: ["restaurant", "food"] },
      ];
    case "breakfast":
      return [
        { query: `${label} 早餐`, mode: "text", includedTypes: ["cafe", "bakery", "restaurant"] },
        { query: `${label} 早餐 營業中`, mode: "text", includedTypes: ["cafe", "bakery"] },
      ];
    case "afternoon_tea":
      return [
        { query: `${label} 咖啡 下午茶`, mode: "text", includedTypes: ["cafe", "bakery"] },
        { query: `${label} 甜點`, mode: "text", includedTypes: ["cafe", "bakery"] },
      ];
    case "late_night":
      return [
        { query: `${label} 宵夜`, mode: "text", includedTypes: ["restaurant", "bar"] },
        { query: `${label} 夜市`, mode: "text", includedTypes: ["restaurant", "market"] },
      ];
    default:
      return [{ query: `${label} 餐廳`, mode: "text", includedTypes: ["restaurant"] }];
  }
}

const NIGHT_COPY_RE = /夜晚|小坐|酒吧|晚餐|宵夜|微醺|喝一杯|夜間|夜景|酒吧/i;

export function buildMealRecommendationDescription(
  place: PlaceResult,
  intent: ParsedMealIntent,
): string {
  const name = place.name ?? "";
  if (intent.slot === "lunch") {
    if (NIGHT_COPY_RE.test(name)) return "適合午餐";
    return "明天中午可安排 · 適合午餐";
  }
  if (intent.slot === "dinner") return "適合晚餐";
  if (intent.slot === "breakfast") return "適合早餐";
  return "適合用餐";
}

/**
 * Meal copy is card metadata, not recommendation-reason authority.
 * Preserve a grounded reason produced by the evidence/template pipeline;
 * only use the meal label when that pipeline produced no renderable text.
 */
export function preserveMealRecommendationReason(
  reason: string | null | undefined,
  place: PlaceResult,
  intent: ParsedMealIntent,
): string {
  const groundedReason = reason?.trim();
  return groundedReason
    ? sanitizeMealReasonText(groundedReason, intent.slot)
    : buildMealRecommendationDescription(place, intent);
}

export function sanitizeMealSummaryText(summary: string, slot: MealSlot): string {
  if (slot !== "lunch") return summary;
  return summary
    .replace(/適合夜晚小坐/g, "適合午餐")
    .replace(/散步後來一杯剛好/g, "明天中午可安排")
    .replace(/營業中，現在出發剛好/g, "明天中午營業")
    .replace(/目前營業中，現在出發剛好/g, "明天中午營業")
    .replace(/夜晚/g, "中午")
    .replace(/微醺/g, "");
}

export function sanitizeMealReasonText(reason: string, slot: MealSlot): string {
  if (slot !== "lunch") return reason;
  if (NIGHT_COPY_RE.test(reason) || /酒吧|餐酒|bistro|bar|屋頂|夜景/i.test(reason)) {
    return "適合午餐 · 明天中午可安排";
  }
  return sanitizeMealSummaryText(reason, slot);
}
