import type { ChatMsg } from "@/lib/chat-history";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { isTripAddPlaceMode } from "@/lib/trip/trip-add-place-mode";
import {
  createTripAddPlaceDedupRegistry,
  dedupeTripAddPlaceCandidates,
} from "@/lib/trip/trip-add-place-dedup";

export type TripAddPlaceStructuredPlace = {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  photoUrl: string | null;
  photoReference: string | null;
  types: string[];
  reason: string;
  source: "google_places";
};

export const TRIP_ADD_PLACE_RENDER_FAILED_MESSAGE =
  "我找到地點了，但卡片載入失敗，請重新整理。";

export const TRIP_ADD_PLACE_HANDOFF_LOADING_MESSAGE = "正在依照你的行程找順路地點…";

function messageIdFromParts(summary: string, count: number): string {
  return `trip-add-${count}-${summary.length}`;
}

export function recommendationsToStructuredPlaces(
  recommendations: RoamieRecommendationItem[],
): TripAddPlaceStructuredPlace[] {
  return recommendations.map((rec) => {
    const ext = rec as RoamieRecommendationItem & {
      placeId?: string;
      googlePlaceId?: string;
      photoName?: string | null;
      primaryType?: string | null;
      category?: string | null;
      userRatingCount?: number | null;
    };
    const placeId = ext.googlePlaceId ?? ext.placeId ?? rec.name;
    const types = [ext.primaryType, ext.category, rec.type].filter(Boolean) as string[];
    return {
      placeId,
      name: rec.placeName?.trim() || rec.name,
      address: rec.address ?? "",
      lat: rec.lat ?? null,
      lng: rec.lng ?? null,
      rating: rec.rating ?? null,
      reviewCount: ext.userRatingCount ?? null,
      photoUrl: null,
      photoReference: ext.photoName ?? null,
      types,
      reason: rec.reason ?? "",
      source: "google_places" as const,
    };
  });
}

export function structuredPlacesToRecommendations(
  places: TripAddPlaceStructuredPlace[],
): RoamieRecommendationItem[] {
  return places.map((p) => ({
    name: p.name,
    placeName: p.name,
    type: p.types[0] ?? "地點",
    description: p.address || "附近推薦",
    reason: p.reason || "順路推薦",
    estimatedTime: "1-2 小時",
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    googleMapsUrl: "",
    reasonSource: "template" as const,
    googlePlaceId: p.placeId,
    photoName: p.photoReference,
    rating: p.rating,
    userRatingCount: p.reviewCount,
  }));
}

export function resolveTripAddPlaceMessageRecommendations(
  message: ChatMsg,
): RoamieRecommendationItem[] {
  if (message.roamie?.recommendations?.length) {
    return message.roamie.recommendations as RoamieRecommendationItem[];
  }
  if (message.structuredPlaces?.length) {
    return structuredPlacesToRecommendations(message.structuredPlaces);
  }
  return [];
}

export function logTripAddPlaceRenderReady(
  message: ChatMsg,
  session: ChatPlanningSession,
): void {
  const structured = message.structuredPlaces ?? [];
  const recs = message.roamie?.recommendations ?? [];
  console.info("[TRIP_ADD_PLACE_RENDER_READY]", {
    messageId: messageIdFromParts(message.content, structured.length || recs.length),
    textLength: message.content?.length ?? 0,
    structuredPlacesCount: structured.length,
    roamieRecommendationsCount: recs.length,
    firstPlaceName: structured[0]?.name ?? recs[0]?.name ?? null,
    isTripAddPlaceMode: isTripAddPlaceMode(session),
  });
}

export function logTripAddPlaceRenderEmpty(params: {
  reason: string;
  messagesCount: number;
  candidatesCount: number;
  structuredPlacesCount: number;
  loading: boolean;
  error?: string | null;
}): void {
  console.warn("[TRIP_ADD_PLACE_RENDER_EMPTY]", params);
}

export function buildTripAddPlaceChatMessage(params: {
  summary: string;
  recommendations: RoamieRecommendationItem[];
  moodTag?: string;
  session: ChatPlanningSession;
}): ChatMsg {
  const { summary, recommendations, moodTag, session } = params;
  // 僅在本批訊息內去重；不可對 session shown 狀態再濾，否則 handoff 會把剛選中的卡全刪光
  const deduped = dedupeTripAddPlaceCandidates(
    recommendations,
    createTripAddPlaceDedupRegistry(),
    "render_cards",
  );
  const finalRecs = deduped.length ? deduped : recommendations;
  const structuredPlaces = recommendationsToStructuredPlaces(finalRecs);
  const text =
    summary.trim() ||
    (structuredPlaces.length > 0
      ? `我幫你找了 ${structuredPlaces.length} 個順路地點，可以看看哪個最適合加入行程。`
      : TRIP_ADD_PLACE_RENDER_FAILED_MESSAGE);

  const message: ChatMsg = {
    role: "assistant",
    content: text,
    structuredPlaces,
    roamie: {
      title: "Roamie 推薦",
      summary: text,
      moodTag: moodTag ?? "",
      recommendations: finalRecs,
      itinerary: [],
    },
  };

  if (structuredPlaces.length > 0) {
    logTripAddPlaceRenderReady(message, session);
  } else if (recommendations.length > 0 && finalRecs.length === 0) {
    logTripAddPlaceRenderEmpty({
      reason: "structured_places_empty_with_candidates",
      messagesCount: 1,
      candidatesCount: recommendations.length,
      structuredPlacesCount: 0,
      loading: false,
    });
  }

  return message;
}

export function buildTripAddPlaceRenderFallbackMessage(
  session: ChatPlanningSession,
  opts?: { candidatesCount?: number; error?: string | null },
): ChatMsg {
  logTripAddPlaceRenderEmpty({
    reason: opts?.error ? "handoff_error" : "render_failed",
    messagesCount: 0,
    candidatesCount: opts?.candidatesCount ?? 0,
    structuredPlacesCount: 0,
    loading: false,
    error: opts?.error ?? null,
  });
  return {
    role: "assistant",
    content: TRIP_ADD_PLACE_RENDER_FAILED_MESSAGE,
    structuredPlaces: [],
    roamie: {
      title: "Roamie 推薦",
      summary: TRIP_ADD_PLACE_RENDER_FAILED_MESSAGE,
      moodTag: session.mood ?? "",
      recommendations: [],
      itinerary: [],
    },
  };
}

export function buildTripAddPlaceLoadingMessage(): ChatMsg {
  return {
    role: "assistant",
    content: TRIP_ADD_PLACE_HANDOFF_LOADING_MESSAGE,
    structuredPlaces: [],
  };
}
