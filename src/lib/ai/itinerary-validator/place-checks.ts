/**
 * Itinerary Validator 本地 place 檢查（刻意不 import ai-day-plan-slot-rules /
 * ai-day-plan-source，避免 vite-node 循環依賴）。
 */

import type { PlaceResult } from "@/lib/place-result";
import { resolveNightlifeClassification } from "@/lib/ai/nightlife-classification";

function blob(place: PlaceResult): string {
  return [place.name, place.address, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function typesOf(place: PlaceResult): Set<string> {
  return new Set(
    [place.primaryType, ...(place.types ?? [])]
      .filter(Boolean)
      .map((t) => String(t).toLowerCase()),
  );
}

export function isCafePlaceLocal(place: PlaceResult): boolean {
  const t = typesOf(place);
  return t.has("cafe") || t.has("coffee_shop") || /咖啡|cafe|coffee/.test(blob(place));
}

export function isBarBistroPlaceLocal(place: PlaceResult): boolean {
  return resolveNightlifeClassification(place).isNightlife;
}

export function isNightMarketPlaceLocal(place: PlaceResult): boolean {
  return resolveNightlifeClassification(place).nightlifeSubtype === "night_market";
}

export function isProperRestaurantPlaceLocal(place: PlaceResult): boolean {
  const t = typesOf(place);
  if (isCafePlaceLocal(place) && !t.has("restaurant")) return false;
  if (isBarBistroPlaceLocal(place) && !t.has("restaurant")) return false;
  if (isNightMarketPlaceLocal(place)) return false;
  return (
    t.has("restaurant") ||
    t.has("meal_takeaway") ||
    t.has("food") ||
    /餐廳|食堂|定食|拉麵|壽司|燒肉|火鍋|restaurant|ramen|sushi/.test(blob(place))
  );
}

export function hasOpeningHoursDataLocal(place: PlaceResult): boolean {
  const any = place as PlaceResult & {
    openingHours?: unknown;
    regularOpeningHours?: unknown;
    currentOpeningHours?: unknown;
  };
  return Boolean(
    any.openingHours ||
      any.regularOpeningHours ||
      any.currentOpeningHours ||
      (place.todayHoursLabel && place.todayHoursLabel.trim()),
  );
}

/** 明確休息／打烊才回 false；未知回 null（caller 應 warning） */
export function isClearlyClosedAtSlot(
  place: PlaceResult,
  _plannedDate: string | undefined,
  plannedTime: string,
): boolean | null {
  if (place.businessStatus === "CLOSED_PERMANENTLY") return true;
  if (!hasOpeningHoursDataLocal(place)) return null;
  const minutes = (() => {
    const m = plannedTime.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return 12 * 60;
    return Number(m[1]) * 60 + Number(m[2]);
  })();
  // 夜市／酒吧早上視為明確不適合
  if (isNightMarketPlaceLocal(place) && minutes < 17 * 60 + 30) return true;
  if (isBarBistroPlaceLocal(place) && minutes < 11 * 60) return true;
  if (/museum|美術館|博物館/.test(blob(place)) && minutes >= 19 * 60) return true;
  // 有 hours label 且明確寫休息
  if (/公休|休息中|closed/i.test(place.todayHoursLabel ?? "")) return true;
  if (place.openStatus === "closed_now" && !(_plannedDate?.trim())) return true;
  return false;
}

const ALWAYS_RETAIL = new Set([
  "supermarket",
  "grocery_or_supermarket",
  "convenience_store",
  "hypermarket",
  "wholesale_store",
]);

export function excludedRetailReasonLocal(
  place: PlaceResult,
  _opts?: { shoppingIntent?: boolean },
): string | null {
  const t = typesOf(place);
  for (const x of ALWAYS_RETAIL) {
    if (t.has(x)) return x;
  }
  if (/超市|量販|便利商店|convenience|supermarket/.test(blob(place))) {
    return "supermarket";
  }
  // shopping_mall / department_store are valid tourist stops (心齋橋、榮商圈…).
  // Do not reject them as "excluded retail" — only block grocery / convenience noise.
  return null;
}
