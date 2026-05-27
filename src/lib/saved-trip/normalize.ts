import type { Itinerary } from "@/lib/itinerary.functions";
import {
  isRoamiePayloadV2,
  type RoamieItineraryItem,
  type RoamiePayloadV2,
  type TripTransportMode,
} from "@/lib/ai/types";
import { daysBetweenDates } from "@/lib/fetch-context";
import { groupItineraryByDate, listTripDates } from "@/lib/outfit/group-by-date";
import { formatDateRangeLabel, formatDateWithWeekday } from "@/lib/picker-utils";
import { buildLegKey } from "@/lib/transit/types";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import {
  coverFieldsFromStored,
  resolveDisplayCoverImage,
  resolveDisplayTitle,
  titleFieldsFromStored,
} from "@/lib/saved-trip/display";
import type { SavedTripDay, SavedTripDayItem, SavedTripView } from "@/lib/saved-trip/types";

const UNSET = "尚未設定";

const TRANSPORT_LABEL: Record<TripTransportMode, string> = {
  walk: "步行",
  scooter: "機車",
  drive: "開車",
  transit: "大眾運輸",
};

function transportLabel(mode?: TripTransportMode | string | null): string {
  if (!mode) return UNSET;
  if (mode in TRANSPORT_LABEL) return TRANSPORT_LABEL[mode as TripTransportMode];
  return String(mode);
}

function inferCategory(item: RoamieItineraryItem): string {
  const t = (item.placeType ?? "").trim();
  if (t) return t;
  const text = `${item.title} ${item.placeName} ${item.description}`.toLowerCase();
  if (/午餐|晚餐|餐廳|美食|吃/.test(text)) return "餐廳";
  if (/咖啡|café|cafe/.test(text)) return "咖啡廳";
  if (/住宿|飯店|旅館|hotel/.test(text)) return "住宿";
  if (/車站|機場|交通|搭|轉乘/.test(text)) return "交通";
  if (/博物館|美術|展覽|景點|公園|寺|廟/.test(text)) return "景點";
  return "景點";
}

function formatDurationMinutes(minutes: number | undefined): string {
  if (minutes == null || minutes <= 0) return UNSET;
  if (minutes < 60) return `${minutes} 分鐘`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} 小時 ${m} 分鐘` : `${h} 小時`;
}

function parseTimeSortKey(time: string): number {
  const m = time.trim().match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9999;
  return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10);
}

function legMinutesFor(
  settings: RoamiePayloadV2["tripSettings"],
  placeName: string,
  title: string,
): string {
  const key = placeName || title;
  const mins = settings?.legMinutes?.[key];
  return formatDurationMinutes(mins);
}

function travelToNext(
  settings: RoamiePayloadV2["tripSettings"],
  current: RoamieItineraryItem,
  next: RoamieItineraryItem | undefined,
): string {
  if (!next) return "";
  const from = current.placeName || current.title;
  const to = next.placeName || next.title;
  const legKey = buildLegKey(from, to);
  const leg = settings?.transitLegs?.[legKey];
  if (leg) {
    return `${leg.headline} · 約 ${leg.durationMinutes} 分鐘`;
  }
  return UNSET;
}

function itemToSaved(
  raw: RoamieItineraryItem,
  index: number,
  dayNumber: number,
  settings: RoamiePayloadV2["tripSettings"],
  next?: RoamieItineraryItem,
): SavedTripDayItem {
  const placeName = raw.placeName || raw.title || "地點";
  return {
    id: `${dayNumber}-${index}-${placeName.slice(0, 12)}`,
    time: raw.time?.trim() || UNSET,
    placeName,
    address: raw.address?.trim() || UNSET,
    category: inferCategory(raw),
    duration: legMinutesFor(settings, raw.placeName, raw.title),
    transportMode:
      settings?.legTransport?.[placeName] ??
      settings?.legTransport?.[raw.title] ??
      transportLabel(settings?.transport),
    travelTimeToNext: travelToNext(settings, raw, next),
    note: raw.notes?.trim() || raw.description?.trim() || "",
    placeId: raw.googlePlaceId?.trim() ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
  };
}

function daysFromV2(payload: RoamiePayloadV2): SavedTripDay[] {
  const items = [...(payload.itinerary ?? [])];
  if (items.length === 0) return [];

  const start =
    payload.tripSettings?.tripStartDate?.trim() ||
    items.map((i) => i.date?.trim()).find((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ||
    new Date().toISOString().slice(0, 10);
  const dayCount =
    payload.days ?? daysBetweenDates(start, payload.tripSettings?.tripEndDate || start);
  const orderedDates = listTripDates(items, start, dayCount);
  const groups = groupItineraryByDate(items);

  return orderedDates.map((iso, idx) => {
    const dayNumber = idx + 1;
    const groupKey = [...groups.keys()].find((k) => k === iso) ?? [...groups.keys()][idx] ?? iso;
    const dayItems = [...(groups.get(groupKey) ?? groups.get(iso) ?? [])].sort(
      (a, b) => parseTimeSortKey(a.time ?? "") - parseTimeSortKey(b.time ?? ""),
    );
    const savedItems = dayItems.map((item, i) =>
      itemToSaved(item, i, dayNumber, payload.tripSettings, dayItems[i + 1]),
    );
    return {
      dayNumber,
      date: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : groupKey,
      items: savedItems,
    };
  });
}

function daysFromLegacy(plan: Itinerary["daily_plan"]): SavedTripDay[] {
  if (!plan?.length) return [];
  return plan.map((day) => {
    const blocks = [...(day.blocks ?? [])].sort(
      (a, b) => parseTimeSortKey(a.time) - parseTimeSortKey(b.time),
    );
    const items: SavedTripDayItem[] = blocks.map((block, i) => {
      const placeName = block.title || "地點";
      const categoryMap: Record<string, string> = {
        place: "景點",
        food: "餐廳",
        transit: "交通",
        rest: "休息",
        experience: "體驗",
      };
      return {
        id: `${day.day}-${i}`,
        time: block.time?.trim() || UNSET,
        placeName,
        address: UNSET,
        category: categoryMap[block.type] ?? "景點",
        duration: formatDurationMinutes(block.duration_minutes),
        transportMode: UNSET,
        travelTimeToNext: i < blocks.length - 1 ? UNSET : "",
        note: block.description?.trim() || "",
        placeId: "",
        lat: null,
        lng: null,
      };
    });
    return {
      dayNumber: day.day,
      date: day.date?.trim() || `第 ${day.day} 天`,
      items,
    };
  });
}

function resolveDateRange(
  payload: RoamiePayloadV2 | Itinerary,
  days: SavedTripDay[],
): SavedTripView["dateRange"] {
  if (isRoamiePayloadV2(payload)) {
    const start = payload.tripSettings?.tripStartDate?.trim() ?? "";
    const end = payload.tripSettings?.tripEndDate?.trim() ?? "";
    if (start && end) return { start, end };
    if (start) return { start, end: start };
  }
  const isoDates = days
    .map((d) => d.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (isoDates.length > 0) {
    return { start: isoDates[0]!, end: isoDates[isoDates.length - 1]! };
  }
  return { start: "", end: "" };
}

function formatDateRangeDisplay(range: SavedTripView["dateRange"]): string {
  if (range.start && range.end) {
    return formatDateRangeLabel(range.start, range.end, { withYear: true });
  }
  return UNSET;
}

/** 將 stored trip 轉為詳情／列表用統一格式；舊資料安全 fallback */
export function normalizeStoredTrip(trip: StoredItinerary): SavedTripView {
  const payload = trip.payload;
  let days: SavedTripDay[] = [];
  let destination = "";
  let summary = "";
  let transportMode = UNSET;
  let dayCount = 1;
  let companionCount = UNSET;

  if (isRoamiePayloadV2(payload)) {
    destination =
      payload.destination?.trim() ||
      payload.destinationLocation?.displayLabel ||
      payload.destinationLocation?.city ||
      UNSET;
    summary = payload.summary?.trim() || "";
    transportMode = transportLabel(payload.tripSettings?.transport);
    days = daysFromV2(payload);
    dayCount = payload.days ?? Math.max(1, days.length);
    const travelers = (payload as Record<string, unknown>).travelers;
    if (typeof travelers === "number" && travelers > 0) {
      companionCount = `${travelers} 人`;
    }
  } else {
    const legacy = payload as Itinerary;
    destination = legacy.destination?.trim() || UNSET;
    summary = legacy.summary?.trim() || "";
    transportMode = legacy.transport_tips?.trim() || UNSET;
    days = daysFromLegacy(legacy.daily_plan);
    dayCount = legacy.days ?? Math.max(1, days.length);
  }

  const dateRange = resolveDateRange(payload, days);
  const titleFields = titleFieldsFromStored(trip);
  const coverFields = coverFieldsFromStored(trip);
  const displayTitle = resolveDisplayTitle(titleFields);
  const displayCoverImage = resolveDisplayCoverImage(coverFields);

  if (days.length === 0 && summary) {
    days = [
      {
        dayNumber: 1,
        date: dateRange.start || "第 1 天",
        items: [],
      },
    ];
  }

  const autoTitle =
    trip.title?.trim() ||
    (isRoamiePayloadV2(payload) ? payload.title : (payload as Itinerary).title) ||
    "我的行程";

  return {
    id: trip.id,
    title: titleFields.title || autoTitle,
    customTitle: titleFields.customTitle,
    isTitleCustomized: titleFields.isTitleCustomized,
    displayTitle,
    destination,
    dateRange,
    dayCount: Math.max(dayCount, days.length, 1),
    summary,
    transportMode,
    companionCount,
    isSaved: true,
    coverImageUrl: coverFields.coverImageUrl,
    customCoverImageUrl: coverFields.customCoverImageUrl,
    aiGeneratedCoverImageUrl: coverFields.aiGeneratedCoverImageUrl,
    isCoverCustomized: coverFields.isCoverCustomized,
    displayCoverImage,
    coverImage: trip.cover_image,
    coverSource: trip.cover_source ?? null,
    coverQuery: trip.cover_query ?? null,
    mood: trip.mood,
    days,
    createdAt: trip.created_at,
    updatedAt: trip.updated_at ?? trip.created_at,
  };
}

export function formatSavedTripDateRange(trip: SavedTripView): string {
  return formatDateRangeDisplay(trip.dateRange);
}

export function formatSavedTripDayLabel(day: SavedTripDay): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
    return `第 ${day.dayNumber} 天 · ${formatDateWithWeekday(day.date)}`;
  }
  return `第 ${day.dayNumber} 天`;
}
