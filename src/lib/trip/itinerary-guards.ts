import type {
  RoamieItineraryItem,
  RoamiePayloadV2,
  RoamieRecommendationItem,
} from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { INSUFFICIENT_ITINERARY_PLACES_MESSAGE } from "@/lib/ai/generic-place-label";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { buildMixedItineraryFromPlaces } from "@/lib/trip/mixed-itinerary-schedule";

export const ITINERARY_GENERATION_FAILED_MESSAGE =
  "行程建立失敗，我再幫你重新整理一次。";

export const ITINERARY_PARTIAL_FAILURE_MESSAGE =
  "行程建立失敗，是否改成列出必去景點？";

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

const DAY_FILLER_TEMPLATES: { title: string; time: string; description: string }[] = [
  { title: "市區自由探索", time: "10:00", description: "保留彈性，可依體力調整節奏。" },
  { title: "在地咖啡廳與散步", time: "14:30", description: "慢步調認識當地街區。" },
  { title: "移動日 · 轉換區域", time: "09:00", description: "安排交通與行李，轉往下一區。" },
  { title: "半日休息 · 自由活動", time: "11:00", description: "可補眠、購物或調整前幾天節奏。" },
  { title: "近郊探索", time: "09:30", description: "依天氣選擇輕量戶外或市區延伸。" },
  { title: "當地餐廳與夜景", time: "17:30", description: "體驗在地飲食與夜間氛圍。" },
];

function dayIndexForPlace(placeIndex: number, placeCount: number, dayCount: number): number {
  if (placeCount <= 0 || dayCount <= 0) return 0;
  if (placeCount >= dayCount) return Math.min(placeIndex, dayCount - 1);
  return Math.min(Math.floor((placeIndex * dayCount) / placeCount), dayCount - 1);
}

function makePlaceItineraryStop(
  place: RoamieRecommendationItem,
  date: string,
  time: string,
): RoamieItineraryItem {
  const placeId =
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim();
  return normalizeItineraryItem({
    date,
    time,
    title: place.name,
    placeName: place.placeName ?? place.name,
    description: place.description || place.reason || "",
    lat: place.lat,
    lng: place.lng,
    address: place.address?.trim() || place.name,
    googlePlaceId: placeId || undefined,
  });
}

function makeFillerItineraryStop(
  destination: string,
  date: string,
  template: (typeof DAY_FILLER_TEMPLATES)[number],
): RoamieItineraryItem {
  const label = normalizeDestinationLabel(destination);
  const approx = resolveDestinationApproxCenter(label);
  const title = `${label} · ${template.title}`;
  return normalizeItineraryItem({
    date,
    time: template.time,
    title,
    placeName: title,
    description: template.description,
    lat: approx?.lat,
    lng: approx?.lng,
    address: label,
  });
}

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

/** 從已選地點建立保底行程 — 混合類型分配到每天 */
export function buildFallbackItineraryFromPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
): RoamieItineraryItem[] {
  const mixed = buildMixedItineraryFromPlaces(selectedPlaces, days, startDate, destination);
  if (mixed.length > 0) return mixed;

  const dayCount = Math.max(days, 1);
  const dates = listTripDates([], startDate, dayCount);
  const destLabel = destination?.trim() ? normalizeDestinationLabel(destination) : "";
  const stops: RoamieItineraryItem[] = [];
  const dayOccupied = new Array<boolean>(dayCount).fill(false);

  selectedPlaces.forEach((place, idx) => {
    const dayIdx = dayIndexForPlace(idx, selectedPlaces.length, dayCount);
    const date = dates[dayIdx] ?? startDate;
    dayOccupied[dayIdx] = true;
    stops.push(
      makePlaceItineraryStop(
        place,
        date,
        FALLBACK_STOP_TIMES[idx % FALLBACK_STOP_TIMES.length] ?? "09:30",
      ),
    );
  });

  let fillerIdx = 0;
  for (let d = 0; d < dayCount; d += 1) {
    if (dayOccupied[d]) continue;
    const template = DAY_FILLER_TEMPLATES[fillerIdx % DAY_FILLER_TEMPLATES.length]!;
    fillerIdx += 1;
    const date = dates[d] ?? startDate;
    stops.push(
      destLabel
        ? makeFillerItineraryStop(destLabel, date, template)
        : normalizeItineraryItem({
            date,
            time: template.time,
            title: template.title,
            placeName: template.title,
            description: template.description,
          }),
    );
  }

  return stops.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
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
