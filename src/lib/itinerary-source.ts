import type { RoamieRecommendationItem, RoamieResponse } from "@/lib/ai/types";
import type { RoamieLocation } from "@/lib/ai/context";
import type { WeatherSummary } from "@/lib/weather.functions";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { ChatMsg } from "@/lib/chat-history";
import { getRecommendation } from "@/lib/recommendation-storage";

const SESSION_KEY = "roamie:itinerary-source";

export type ItinerarySourceKind = "recommendations" | "chat" | "manual";

export type ItinerarySourceContext = {
  source: ItinerarySourceKind;
  recommendationId?: string;
  selectedPlaces: RoamieRecommendationItem[];
  moodTag?: string;
  summary?: string;
  location?: RoamieLocation;
  weather?: WeatherSummary | null;
  preferences?: TravelPreferences;
  savedAt: string;
};

export function setItinerarySource(ctx: Omit<ItinerarySourceContext, "savedAt">): void {
  if (typeof window === "undefined") return;
  const payload: ItinerarySourceContext = { ...ctx, savedAt: new Date().toISOString() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

export function getItinerarySource(): ItinerarySourceContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ItinerarySourceContext;
  } catch {
    return null;
  }
}

export function clearItinerarySource(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(SESSION_KEY);
}

/** Last assistant message that contains recommendations. */
export function extractPlacesFromChat(msgs: ChatMsg[]): RoamieRecommendationItem[] {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "assistant") continue;
    const recs = m.roamie?.recommendations;
    if (recs?.length) return recs;
  }
  return [];
}

export function extractMoodFromChat(msgs: ChatMsg[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === "assistant" && m.roamie?.moodTag) return m.roamie.moodTag;
  }
  return undefined;
}

export function inferDestinationFromPlaces(
  places: RoamieRecommendationItem[],
  location?: RoamieLocation,
): string {
  if (location?.city && location.city !== "目前位置") return location.city;
  const addr = places.find((p) => p.address?.trim())?.address ?? "";
  if (addr) {
    const cityMatch = addr.match(/^[\u4e00-\u9fff]{2,4}[市縣]/);
    if (cityMatch) return cityMatch[0];
    const district = addr.match(/^[\u4e00-\u9fff]{2,4}/);
    if (district) return district[0];
  }
  return places[0]?.name?.split(/[·、,]/)[0]?.trim() ?? "";
}

export function placesToInterestsText(places: RoamieRecommendationItem[]): string {
  return places
    .map(
      (p, i) =>
        `${i + 1}. ${p.name}（${p.type}）— ${p.description}；理由：${p.reason}；地址：${p.address}；建議停留：${p.estimatedTime}`,
    )
    .join("\n");
}

export function buildSourceFromRoamieResponse(
  data: RoamieResponse,
  extra: {
    source: ItinerarySourceKind;
    recommendationId?: string;
    location?: RoamieLocation;
    weather?: WeatherSummary | null;
    preferences?: TravelPreferences;
  },
): Omit<ItinerarySourceContext, "savedAt"> {
  return {
    source: extra.source,
    recommendationId: extra.recommendationId,
    selectedPlaces: data.recommendations ?? [],
    moodTag: data.moodTag,
    summary: data.summary,
    location: extra.location,
    weather: extra.weather,
    preferences: extra.preferences,
  };
}

/** Hydrate from sessionStorage, or reload from recommendationId if session missing. */
export async function loadItinerarySource(
  recommendationId?: string,
): Promise<ItinerarySourceContext | null> {
  const cached = getItinerarySource();
  if (cached?.selectedPlaces?.length) {
    if (!recommendationId || cached.recommendationId === recommendationId) return cached;
  }

  if (!recommendationId) return cached;

  const record = await getRecommendation(recommendationId);
  if (!record?.payload?.recommendations?.length) return cached;

  const ctx: ItinerarySourceContext = {
    source: "recommendations",
    recommendationId,
    selectedPlaces: record.payload.recommendations,
    moodTag: record.payload.moodTag ?? record.mood ?? undefined,
    summary: record.payload.summary,
    savedAt: new Date().toISOString(),
  };
  setItinerarySource(ctx);
  return ctx;
}
