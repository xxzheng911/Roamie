import type { RoamieLocation } from "@/lib/ai/context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripLocation } from "@/lib/location/types";
import type { WeatherSummary } from "@/lib/weather-types";

export type TripAddPlaceFollowUpIntent = "restaurant" | "cafe" | "attraction";

export type TripAddPlaceTravelContext = {
  interests: string[];
  destination?: string;
  currentLocation?: string;
  tripPurpose?: string;
  mood?: string;
  transportMode?: string;
  budgetLevel?: string;
  days?: number;
  startDate?: string;
  endDate?: string;
  weather?: WeatherSummary | null;
};

export type TripAddPlaceContext = {
  mode: "trip_add_place";
  source: "trip_detail_add_place";
  tripId: string;
  destination: string;
  origin?: string;
  tripDates: { start?: string; end?: string; dayCount: number; label: string };
  selectedDay: number;
  dayIndex: number;
  dateKey: string;
  currentPlaces: Array<{ name: string; time?: string; address?: string }>;
  existingPlaceNames: string[];
  lastPlace?: {
    name: string;
    lat?: number | null;
    lng?: number | null;
    address?: string;
    time?: string;
  };
  transportationMode?: string;
  travelStyle?: string;
  budget?: string;
  weather?: WeatherSummary | null;
  timeWindow?: { start?: string; end?: string };
  destinationLocation?: TripLocation | null;
};

export function isTripAddPlaceSession(session: ChatPlanningSession): boolean {
  return Boolean(session.fromTripAddPlace && session.tripAddPlaceContext);
}

export function isTripMealRequestText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /(三餐|早餐|午餐|晚餐|宵夜|早午餐|吃飯|用餐|找餐廳|找美食|想吃|安排.{0,4}餐|餐廳|美食|吃什麼)/.test(
    t,
  );
}

export function parseTripAddPlaceFollowUpIntent(text: string): TripAddPlaceFollowUpIntent | null {
  const t = text.trim();
  if (!t) return null;
  if (isTripMealRequestText(t)) return "restaurant";
  if (/(咖啡廳|咖啡店|咖啡|café|cafe)/i.test(t)) return "cafe";
  if (/(散步|景點|走走|逛逛|參觀|景觀|下午茶)/.test(t)) return "attraction";
  return null;
}

function anchorFromContext(ctx: TripAddPlaceContext): { lat: number; lng: number } | null {
  const lat = ctx.lastPlace?.lat ?? ctx.destinationLocation?.lat;
  const lng = ctx.lastPlace?.lng ?? ctx.destinationLocation?.lng;
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) return null;
  return { lat, lng };
}

function areaLabel(ctx: TripAddPlaceContext): string {
  const names = ctx.currentPlaces.map((p) => p.name).filter(Boolean);
  if (names.length > 0) return `${names.join("和")}周邊`;
  return ctx.destination;
}

export function buildTripAddPlaceTravelContext(
  session: ChatPlanningSession,
  ctx: TripAddPlaceContext,
  prev: TripAddPlaceTravelContext = { interests: [] },
): TripAddPlaceTravelContext {
  return {
    ...prev,
    destination: ctx.destination,
    currentLocation: ctx.currentPlaces.map((p) => p.name).join("、") || ctx.destination,
    tripPurpose: "trip_add_place",
    mood: ctx.travelStyle ?? prev.mood ?? session.mood,
    transportMode: ctx.transportationMode ?? prev.transportMode ?? session.transportation,
    budgetLevel: ctx.budget ?? prev.budgetLevel ?? session.budget,
    days: ctx.tripDates.dayCount ?? prev.days ?? session.tripDays,
    startDate: ctx.tripDates.start ?? prev.startDate ?? session.tripStartDate,
    endDate: ctx.tripDates.end ?? prev.endDate ?? session.tripEndDate,
    weather: ctx.weather ?? session.weather ?? prev.weather ?? null,
  };
}

export function reinforceTripAddPlaceSession(
  session: ChatPlanningSession,
  userText?: string,
): ChatPlanningSession {
  const ctx = session.tripAddPlaceContext;
  if (!ctx || !session.fromTripAddPlace) return session;

  const followUp = userText ? parseTripAddPlaceFollowUpIntent(userText) : null;
  const anchor = anchorFromContext(ctx);
  const prev = (session.travelContext ?? { interests: [] }) as TripAddPlaceTravelContext;
  const travelContext = buildTripAddPlaceTravelContext(session, ctx, prev);

  const location: RoamieLocation | undefined = anchor
    ? {
        lat: anchor.lat,
        lng: anchor.lng,
        city: ctx.destination,
        ...(session.location?.placeId ? { placeId: session.location.placeId } : {}),
      }
    : session.location;

  return {
    ...session,
    fromTripAddPlace: true,
    tripAddPlaceContext: ctx,
    conversationMode: "trip_add_place",
    travelContext: travelContext as ChatPlanningSession["travelContext"],
    location,
    preferredArea: ctx.destination,
    activeChatIntent: followUp ?? session.activeChatIntent,
    phase: session.phase === "discover" ? "followup" : session.phase,
  };
}

export function buildTripAddPlaceMealSummary(
  ctx: TripAddPlaceContext,
  recommendations: Array<{ name: string; reason?: string }>,
): string {
  const dayLabel = `第 ${ctx.selectedDay} 天`;
  const area = areaLabel(ctx);

  if (!recommendations.length) {
    return [
      `如果${dayLabel}在${area}，我可以幫你找順路的餐廳。`,
      "想吃在地特色還是景觀餐廳？",
    ].join("\n");
  }

  const list = recommendations
    .slice(0, 5)
    .map((p, i) => {
      const reason = p.reason?.trim();
      return reason ? `${i + 1}. ${p.name}\n（${reason}）` : `${i + 1}. ${p.name}`;
    })
    .join("\n");

  return [
    `如果${dayLabel}在${area}，`,
    "",
    "我比較推薦：",
    "",
    list,
    "",
    "這幾個都在順路範圍內，",
    "不太會增加交通時間。",
    "",
    "想吃在地特色還是景觀餐廳？",
  ].join("\n");
}
