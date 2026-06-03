import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { OutfitAdvicePayload } from "@/lib/outfit/types";

export type TripDayPlanPlace = {
  name: string;
  type: string;
  address: string;
  area: string;
  startTime: string;
  endTime: string;
  duration: string;
  description: string;
  reason: string;
  lat: number | null;
  lng: number | null;
  googlePlaceId?: string;
};

export type TripDayPlan = {
  day: number;
  date: string;
  theme: string;
  places: TripDayPlanPlace[];
  transportSuggestion: string;
  weatherHint: string;
  outfitHint: string;
};

function parseTimeParts(time: string): { start: string; end: string; duration: string } {
  const start = time.trim() || "10:00";
  const [h, m] = start.split(":").map((x) => Number.parseInt(x, 10));
  const endH = Number.isFinite(h) ? Math.min(21, h + 2) : 12;
  const end = `${String(endH).padStart(2, "0")}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")}`;
  return { start, end, duration: "約 2 小時" };
}

const DEFAULT_DAY_THEMES = [
  "抵達與市區散步",
  "經典景點與在地美食",
  "文化體驗與自由探索",
  "特色街區與夜景",
  "悠閒收尾與最後採買",
  "自由活動與驚喜發現",
];

function outfitForDate(outfit: OutfitAdvicePayload | undefined, date: string): string {
  const day = outfit?.days?.find((d) => d.date === date);
  if (!day) return "";
  const parts = [day.summary, ...(day.items ?? [])].filter(Boolean);
  return parts.join(" · ");
}

function groupItemsByDate(items: RoamieItineraryItem[]): Map<string, RoamieItineraryItem[]> {
  const byDate = new Map<string, RoamieItineraryItem[]>();
  for (const item of items) {
    const date = item.date || "day-1";
    const list = byDate.get(date) ?? [];
    list.push(item);
    byDate.set(date, list);
  }
  return byDate;
}

function dayPlanForDate(
  date: string,
  index: number,
  dayItems: RoamieItineraryItem[],
  payload: Pick<RoamiePayloadV2, "outfitAdvice" | "weatherSummary" | "tripSettings">,
): TripDayPlan {
  const places: TripDayPlanPlace[] = dayItems.map((item) => {
    const times = parseTimeParts(item.time);
    return {
      name: item.placeName || item.title,
      type: item.placeType ?? "景點",
      address: item.address ?? "",
      area: item.address ?? "",
      startTime: times.start,
      endTime: times.end,
      duration: times.duration,
      description: item.description,
      reason: item.notes ?? item.description,
      lat: item.lat,
      lng: item.lng,
      googlePlaceId: item.googlePlaceId,
    };
  });

  return {
    day: index + 1,
    date,
    theme:
      DEFAULT_DAY_THEMES[index % DEFAULT_DAY_THEMES.length] ??
      (dayItems[0]?.title ? `${dayItems[0].title} 起` : `第 ${index + 1} 天`),
    places,
    transportSuggestion: payload.tripSettings?.transportTips ?? "依距離建議步行或大眾運輸",
    weatherHint: payload.weatherSummary ?? "",
    outfitHint: outfitForDate(payload.outfitAdvice, date),
  };
}

/** 將 flat itinerary 轉為 UI / 儲存用的 dayPlans 結構 */
export function buildDayPlansFromItinerary(
  items: RoamieItineraryItem[],
  payload: Pick<RoamiePayloadV2, "outfitAdvice" | "weatherSummary" | "tripSettings">,
): TripDayPlan[] {
  const explicit = (payload.tripSettings?.tripDayDates ?? []).filter((d) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d),
  );
  const byDate = groupItemsByDate(items);

  if (explicit.length > 0) {
    return explicit.map((date, index) =>
      dayPlanForDate(date, index, byDate.get(date) ?? [], payload),
    );
  }

  const dates = [...byDate.keys()].sort();
  return dates.map((date, index) => {
    return dayPlanForDate(date, index, byDate.get(date) ?? [], payload);
  });
}

export function attachDayPlansToPayload(payload: RoamiePayloadV2): RoamiePayloadV2 {
  const itinerary = payload.itinerary ?? [];
  const explicitCount = (payload.tripSettings?.tripDayDates ?? []).filter((d) =>
    /^\d{4}-\d{2}-\d{2}$/.test(d),
  ).length;
  if (!itinerary.length && explicitCount === 0) return payload;
  const dayPlans = buildDayPlansFromItinerary(itinerary, payload);
  const dayCount = explicitCount > 0 ? explicitCount : dayPlans.length;
  return {
    ...payload,
    dayPlans,
    days: dayCount > 0 ? dayCount : payload.days,
  };
}
