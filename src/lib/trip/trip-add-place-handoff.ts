import type { RoamieLocation } from "@/lib/ai/context";
import type { RoamieItineraryItem, RoamiePayloadV2, TripPlanSettings } from "@/lib/ai/types";
import { buildNearbyPlaceRecommendation, type PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import { formatDateRangeLabel } from "@/lib/picker-utils";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import {
  createEmptySession,
  roamieRecToChatItem,
  type ChatPlanningSession,
  type ChatPlaceItem,
} from "@/lib/chat-session";
import { tripLocationToRoamie } from "@/lib/location/to-roamie";
import type { TripLocation } from "@/lib/location/types";
import { syncSessionPlaceMemory } from "@/lib/place-planning-memory";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import type { NearbyPlaceIntent } from "@/lib/ai/chat-intent";
import {
  buildTripAddPlaceMealSummary,
  buildTripAddPlaceTravelContext,
  type TripAddPlaceContext,
  type TripAddPlaceFollowUpIntent,
} from "@/lib/trip/trip-add-place-session";

export { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";
export {
  isTripMealRequestText,
  parseTripAddPlaceFollowUpIntent,
  reinforceTripAddPlaceSession,
  type TripAddPlaceContext,
} from "@/lib/trip/trip-add-place-session";

const HANDOFF_STORAGE_KEY = "roamie:trip-add-place-handoff";

export type TripAddPlaceHandoffInput = {
  stored: StoredItinerary;
  payload: RoamiePayloadV2;
  settings: TripPlanSettings;
  dayIndex: number;
  selectedDay: number;
  dateKey: string;
  dayItems: RoamieItineraryItem[];
  dayCount: number;
};

function normalizePlaceName(name: string): string {
  return name.trim().toLowerCase();
}

function isDuplicatePlace(name: string, existing: string[]): boolean {
  const n = normalizePlaceName(name);
  return existing.some((e) => {
    const x = normalizePlaceName(e);
    return x === n || x.includes(n) || n.includes(x);
  });
}

export function buildTripAddPlaceContext(input: TripAddPlaceHandoffInput): TripAddPlaceContext {
  const { stored, payload, settings, dayIndex, selectedDay, dateKey, dayItems, dayCount } = input;
  const destination = resolveTripDestination(payload);
  const existingPlaceNames = [
    ...new Set(
      (payload.itinerary ?? [])
        .map((item) => item.placeName?.trim() || item.title?.trim())
        .filter(Boolean) as string[],
    ),
  ];
  const currentPlaces = dayItems.map((item) => ({
    name: item.placeName?.trim() || item.title?.trim() || "地點",
    time: item.time,
    address: item.address,
  }));
  const lastItem = dayItems[dayItems.length - 1];
  const lastPlace = lastItem
    ? {
        name: lastItem.placeName?.trim() || lastItem.title?.trim() || "地點",
        lat: lastItem.lat,
        lng: lastItem.lng,
        address: lastItem.address,
        time: lastItem.time,
      }
    : undefined;

  const start = settings.tripStartDate ?? payload.tripSettings?.tripStartDate;
  const end = settings.tripEndDate ?? payload.tripSettings?.tripEndDate;
  const dateLabel =
    start && end
      ? formatDateRangeLabel(start, end, { withYear: true })
      : dayCount > 0
        ? `${dayCount} 天`
        : "";

  return {
    mode: "trip_add_place",
    source: "trip_detail_add_place",
    tripId: stored.id,
    destination,
    origin:
      payload.originLocation?.formattedName?.trim() ||
      payload.originLocation?.displayLabel?.trim() ||
      undefined,
    tripDates: { start, end, dayCount, label: dateLabel },
    selectedDay,
    dayIndex,
    dateKey,
    currentPlaces,
    existingPlaceNames,
    lastPlace,
    transportationMode: settings.transport ?? payload.tripSettings?.transport,
    travelStyle: payload.moodTag?.trim() || undefined,
    budget: undefined,
    timeWindow: {
      start: settings.startTime ?? payload.tripSettings?.startTime,
      end: settings.endTime,
    },
    destinationLocation: payload.destinationLocation ?? null,
  };
}

export function buildTripAddPlaceInitialContext(ctx: TripAddPlaceContext): string {
  const dayLabel = `第 ${ctx.selectedDay} 天（${ctx.dateKey}）`;
  const placesLine =
    ctx.currentPlaces.length > 0
      ? ctx.currentPlaces.map((p) => p.name).join("、")
      : "（尚未排定地點）";
  const lastLine = ctx.lastPlace?.name ? `lastPlace：${ctx.lastPlace.name}` : "";
  const lines = [
    "【行程內頁 → 請 Roamie 推薦下一個地點】",
    `mode：trip_add_place`,
    `source：${ctx.source}`,
    `tripId：${ctx.tripId}`,
    `destination：${ctx.destination}`,
    ctx.origin ? `origin：${ctx.origin}` : "",
    `tripDates：${ctx.tripDates.label}`,
    `selectedDay：${dayLabel}`,
    `dayIndex：${ctx.dayIndex}`,
    `currentPlaces：${placesLine}`,
    `existingPlaceNames：${ctx.existingPlaceNames.join("、") || "—"}`,
    lastLine,
    ctx.transportationMode ? `transportationMode：${ctx.transportationMode}` : "",
    ctx.travelStyle ? `travelStyle：${ctx.travelStyle}` : "",
    ctx.budget ? `budget：${ctx.budget}` : "",
    ctx.weather
      ? `weather：${ctx.weather.city ?? ctx.destination} ${ctx.weather.condition ?? ""} ${ctx.weather.tempC ?? ""}°C`
      : "",
    ctx.timeWindow?.start ? `timeWindow：${ctx.timeWindow.start} - ${ctx.timeWindow.end ?? "—"}` : "",
    "",
    "【必守】",
    "- 延續這趟行程與當天節奏，不要像新對話開場",
    "- 只推薦適合加入「當天」的地點，不要排到其他天",
    "- 不可推薦 existingPlaceNames 已有地點",
    "- 優先順路、附近、不會讓行程太趕的選擇",
    "- 考量交通方式、剩餘時間、天氣與旅行風格",
    "- 若行程已偏滿，先提醒再建議輕量選項",
    "- 使用者按「加入行程」時，直接加入此 trip 的當天",
  ];
  return lines.filter(Boolean).join("\n");
}

export function buildTripAddPlaceOpening(ctx: TripAddPlaceContext): string {
  const dayLabel = `第 ${ctx.selectedDay} 天`;
  const names = ctx.currentPlaces.map((p) => p.name).filter(Boolean);
  const lead =
    names.length > 0
      ? `我看到你目前${dayLabel}已經排了${names.join("和")}。`
      : `我看到你正在規劃${dayLabel}的行程。`;

  return [
    lead,
    "如果要再加一個地點，我會建議找附近、順路、不會讓行程太趕的地方。",
    "你想要我偏向咖啡休息、景點散步，還是晚餐安排？",
  ].join("\n");
}

export function writeTripAddPlaceHandoff(ctx: TripAddPlaceContext): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(HANDOFF_STORAGE_KEY, JSON.stringify(ctx));
}

export function consumeTripAddPlaceHandoff(): TripAddPlaceContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_STORAGE_KEY);
    sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TripAddPlaceContext;
    if (parsed?.mode !== "trip_add_place" || !parsed.tripId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function prepareTripAddPlaceSession(
  ctx: TripAddPlaceContext,
  bundle: ClientContextBundle,
): ChatPlanningSession {
  const destLoc = ctx.destinationLocation;
  const location: RoamieLocation = destLoc
    ? (tripLocationToRoamie(destLoc) as RoamieLocation)
    : {
        lat: ctx.lastPlace?.lat ?? bundle.location.lat,
        lng: ctx.lastPlace?.lng ?? bundle.location.lng,
        city: ctx.destination,
      };

  const rejected = [...ctx.existingPlaceNames];

  const base: ChatPlanningSession = {
    ...createEmptySession(),
    phase: "followup",
    mood: ctx.travelStyle,
    location,
    weather: ctx.weather ?? bundle.weather,
    tripDestination: destLoc ?? undefined,
    transportation: ctx.transportationMode,
    budget: ctx.budget,
    tripStartDate: ctx.tripDates.start,
    tripEndDate: ctx.tripDates.end,
    tripDays: ctx.tripDates.dayCount,
    preferredArea: ctx.destination,
    fromTripAddPlace: true,
    tripAddPlaceContext: ctx,
    conversationMode: "trip_add_place",
    activeChatIntent: "attraction",
    pendingHandoff: true,
    rejectedPlaceNames: rejected,
    initialChatContext: buildTripAddPlaceInitialContext(ctx),
    updatedAt: new Date().toISOString(),
  };

  return syncSessionPlaceMemory(base);
}

export function markTripAddPlaceHandoffComplete(
  session: ChatPlanningSession,
): ChatPlanningSession {
  return {
    ...session,
    pendingHandoff: false,
    tripAddPlaceHandoffDone: true,
    phase: "followup",
    updatedAt: new Date().toISOString(),
  };
}

function recommendationAnchor(ctx: TripAddPlaceContext): { lat: number; lng: number } | null {
  const lat = ctx.lastPlace?.lat ?? ctx.destinationLocation?.lat;
  const lng = ctx.lastPlace?.lng ?? ctx.destinationLocation?.lng;
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return null;
  return { lat, lng };
}

export async function fetchTripAddPlaceRecommendations(params: {
  ctx: TripAddPlaceContext;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
}): Promise<{ summary: string; recommendations: RoamieRecommendationItem[] }> {
  const { ctx, searchPlaces, locale } = params;
  const opening = buildTripAddPlaceOpening(ctx);
  const anchor = recommendationAnchor(ctx);
  if (!anchor) {
    return { summary: opening, recommendations: [] };
  }

  const travelCtx = buildTripAddPlaceTravelContext(
    { travelContext: { interests: [] } } as ChatPlanningSession,
    ctx,
    { interests: [] },
  );

  try {
    const { payload } = await buildNearbyPlaceRecommendation({
      intent: "attraction",
      lat: anchor.lat,
      lng: anchor.lng,
      locale,
      context: travelCtx,
      searchPlaces,
    });
    const filtered = (payload.recommendations ?? []).filter(
      (rec) => !isDuplicatePlace(rec.name, ctx.existingPlaceNames),
    );
    if (!filtered.length) {
      return { summary: opening, recommendations: [] };
    }

    const list = filtered
      .slice(0, 5)
      .map((p, i) => `${i + 1}. ${p.name}`)
      .join("\n");
    const summary = [
      opening,
      "",
      "如果現在要加一個點，這幾個順路又不會太趕：",
      "",
      list,
    ].join("\n");
    return { summary, recommendations: filtered.slice(0, 5) };
  } catch {
    return { summary: opening, recommendations: [] };
  }
}

function buildTripAddPlaceFollowUpSummary(
  ctx: TripAddPlaceContext,
  intent: TripAddPlaceFollowUpIntent,
  recommendations: RoamieRecommendationItem[],
): string {
  if (intent === "restaurant") {
    return buildTripAddPlaceMealSummary(ctx, recommendations);
  }

  const dayLabel = `第 ${ctx.selectedDay} 天`;
  const names = ctx.currentPlaces.map((p) => p.name).filter(Boolean);
  const area = names.length > 0 ? `${names.join("和")}周邊` : ctx.destination;

  if (!recommendations.length) {
    if (intent === "cafe") {
      return `如果${dayLabel}在${area}，我可以幫你找順路的咖啡廳。你想安靜坐坐還是順便拍照？`;
    }
    return `如果${dayLabel}在${area}，我可以幫你找順路的景點。你想輕鬆散步還是多待一會？`;
  }

  const list = recommendations
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");
  const lead =
    intent === "cafe"
      ? `如果${dayLabel}在${area}，這幾間咖啡廳順路又不會太趕：`
      : `如果${dayLabel}在${area}，這幾個景點順路又不會太趕：`;

  return [lead, "", list, "", "想加入行程的話，直接點卡片就可以。"].join("\n");
}

export async function fetchTripAddPlaceFollowUpRecommendations(params: {
  ctx: TripAddPlaceContext;
  intent: TripAddPlaceFollowUpIntent;
  searchPlaces: PlaceSearchFn;
  locale: Locale;
}): Promise<{ summary: string; recommendations: RoamieRecommendationItem[] }> {
  const { ctx, intent, searchPlaces, locale } = params;
  const anchor = recommendationAnchor(ctx);
  if (!anchor) {
    return {
      summary: buildTripAddPlaceFollowUpSummary(ctx, intent, []),
      recommendations: [],
    };
  }

  const travelCtx = buildTripAddPlaceTravelContext(
    { travelContext: { interests: [] } } as ChatPlanningSession,
    ctx,
    { interests: [] },
  );

  try {
    const { payload } = await buildNearbyPlaceRecommendation({
      intent,
      lat: anchor.lat,
      lng: anchor.lng,
      locale,
      context: travelCtx,
      searchPlaces,
    });
    const filtered = (payload.recommendations ?? []).filter(
      (rec) => !isDuplicatePlace(rec.name, ctx.existingPlaceNames),
    );
    return {
      summary: buildTripAddPlaceFollowUpSummary(ctx, intent, filtered),
      recommendations: filtered.slice(0, 5),
    };
  } catch {
    return {
      summary: buildTripAddPlaceFollowUpSummary(ctx, intent, []),
      recommendations: [],
    };
  }
}

export function tripAddPlaceRecommendationsToSession(
  session: ChatPlanningSession,
  recommendations: RoamieRecommendationItem[],
): ChatPlanningSession {
  const recs = recommendations.map(roamieRecToChatItem);
  return syncSessionPlaceMemory({
    ...session,
    recommendedPlaces: recs as ChatPlaceItem[],
    phase: "followup",
  });
}
