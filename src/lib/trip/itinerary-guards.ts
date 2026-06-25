import type {
  RoamieItineraryItem,
  RoamiePayloadV2,
  RoamieRecommendationItem,
} from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "@/lib/ai/generic-place-label";
import { listTripDates } from "@/lib/outfit/group-by-date";

export const ITINERARY_GENERATION_FAILED_MESSAGE =
  "行程建立失敗，我再幫你重新整理一次。";

export const ITINERARY_PARTIAL_FAILURE_MESSAGE =
  "我先幫你整理到幾個地點，但行程建立還沒完成，要不要我改成先列必去景點？";

export type ItineraryDayPlan = {
  day: number;
  date?: string;
  stops: RoamieItineraryItem[];
};

export type GenerateItinerarySuccess = {
  success: true;
  trip: {
    id: string;
    title: string;
    destination: string;
    days: number;
    itinerary: ItineraryDayPlan[];
    payload: RoamiePayloadV2;
  };
};

export type GenerateItineraryFailure = {
  success: false;
  errorCode: string;
  message: string;
};

export type GenerateItineraryResult = GenerateItinerarySuccess | GenerateItineraryFailure;

const FALLBACK_STOP_TIMES = ["09:30", "11:30", "14:30", "18:00"];

export function isGenerateItineraryFailure(
  result: unknown,
): result is GenerateItineraryFailure {
  return Boolean(
    result &&
      typeof result === "object" &&
      (result as GenerateItineraryFailure).success === false,
  );
}

export function groupItineraryItemsByDay(
  items: RoamieItineraryItem[],
  startDate?: string,
): ItineraryDayPlan[] {
  const stops = coalesceItineraryItems(items);
  if (!stops.length) return [];

  const dateOrder: string[] = [];
  for (const item of stops) {
    const date = item.date?.trim();
    if (date && !dateOrder.includes(date)) dateOrder.push(date);
  }
  if (!dateOrder.length && startDate?.trim()) {
    dateOrder.push(startDate.trim());
  }

  const buckets = new Map<string, RoamieItineraryItem[]>();
  for (const item of stops) {
    const date = item.date?.trim() || dateOrder[0] || startDate || "";
    const list = buckets.get(date) ?? [];
    list.push(item);
    buckets.set(date, list);
  }

  const orderedDates = dateOrder.length
    ? dateOrder
    : [...buckets.keys()];

  return orderedDates.map((date, index) => ({
    day: index + 1,
    date,
    stops: buckets.get(date) ?? [],
  }));
}

/** 從已選地點建立保底行程 — AI 失敗時仍須能產出可儲存草稿 */
export function buildFallbackItineraryFromPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
): RoamieItineraryItem[] {
  const dates = listTripDates([], startDate, Math.max(days, 1));
  const perDay = Math.max(1, Math.ceil(selectedPlaces.length / Math.max(days, 1)));

  return selectedPlaces.map((place, idx) => {
    const dayIdx = Math.min(Math.floor(idx / perDay), dates.length - 1);
    const date = dates[dayIdx] ?? startDate;
    const placeId =
      place.googlePlaceId?.trim() ||
      (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim();
    return normalizeItineraryItem({
      date,
      time: FALLBACK_STOP_TIMES[idx % FALLBACK_STOP_TIMES.length] ?? "09:30",
      title: place.name,
      placeName: place.placeName ?? place.name,
      description: place.description || place.reason || "",
      lat: place.lat,
      lng: place.lng,
      address: place.address?.trim() || place.name,
      googlePlaceId: placeId || undefined,
    });
  });
}

/** 安全讀取 itinerary — 禁止直接存取可能為 undefined 的 .itinerary */
export function coalesceItineraryItems(value: unknown): RoamieItineraryItem[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeTripPayload(
  payload: Partial<RoamiePayloadV2> & Record<string, unknown>,
): RoamiePayloadV2 {
  const itinerary = coalesceItineraryItems(payload.itinerary);
  return {
    title: typeof payload.title === "string" ? payload.title : "",
    summary: typeof payload.summary === "string" ? payload.summary : "",
    moodTag: typeof payload.moodTag === "string" ? payload.moodTag : "",
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
    itinerary,
    version: 2,
    ...payload,
    itinerary,
  } as RoamiePayloadV2;
}

/** 解析 generateItinerary 回傳 — 支援 success/trip、{ itinerary } 或直接 payload */
export function unwrapGeneratedTripPayload(result: unknown): RoamiePayloadV2 | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;

  if (record.success === false) return null;

  if (record.success === true && record.trip && typeof record.trip === "object") {
    const trip = record.trip as Record<string, unknown>;
    if (trip.payload && typeof trip.payload === "object") {
      return normalizeTripPayload(trip.payload as Partial<RoamiePayloadV2>);
    }
  }

  if (record.itinerary && typeof record.itinerary === "object" && !Array.isArray(record.itinerary)) {
    return normalizeTripPayload(record.itinerary as Partial<RoamiePayloadV2>);
  }

  if ("summary" in record || "title" in record || record.version === 2) {
    return normalizeTripPayload(record as Partial<RoamiePayloadV2>);
  }

  return null;
}

export function hasValidItineraryStops(
  payload: Pick<RoamiePayloadV2, "itinerary">,
  minStops = 1,
): boolean {
  const items = coalesceItineraryItems(payload.itinerary);
  if (items.length < minStops) return false;
  return items.every((item) => {
    const name = (item.placeName ?? item.title)?.trim();
    if (!name) return false;
    const hasId = Boolean(item.googlePlaceId?.trim());
    const hasCoords =
      item.lat != null &&
      item.lng != null &&
      (Math.abs(item.lat) > 0.001 || Math.abs(item.lng) > 0.001);
    return hasId || hasCoords;
  });
}

export function formatItineraryUserError(error: unknown): string {
  if (error instanceof ItineraryGenerationError) {
    return error.message;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    /undefined is not an object/i.test(message) ||
    /cannot read propert/i.test(message) ||
    /is not iterable/i.test(message) ||
    /\.itinerary/.test(message)
  ) {
    return ITINERARY_GENERATION_FAILED_MESSAGE;
  }
  if (
    message.includes(INSUFFICIENT_ITINERARY_PLACES_MESSAGE) ||
    /找不到足夠/.test(message) ||
    /insufficient/i.test(message)
  ) {
    return "目前還沒找到足夠的實際地點，我再幫你換一批。";
  }
  if (message.trim()) return message;
  return ITINERARY_GENERATION_FAILED_MESSAGE;
}

export class ItineraryGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItineraryGenerationError";
  }
}
