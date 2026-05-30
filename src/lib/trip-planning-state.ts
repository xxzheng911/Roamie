import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { placeDisplayName } from "@/lib/chat-session";
import {
  isSimilarPlaceName,
  placeIdentityKey,
} from "@/lib/place-planning-memory";

export type PlaceSelectionSource = "mood" | "chat" | "nearby" | "map" | "recommendations";

export type ItineraryGenerationDiagnostics = {
  selectedPlaces: Array<{
    name: string;
    place_id: string | null;
    lat: number | null;
    lng: number | null;
    address: string;
  }>;
  itineraryPayload?: Record<string, unknown> | null;
  generationSource: PlaceSelectionSource | string | null;
  errorMessage: string | null;
  created_at: string;
};

let lastItineraryDiagnostics: ItineraryGenerationDiagnostics | null = null;

export function peekLastItineraryDiagnostics(): ItineraryGenerationDiagnostics | null {
  return lastItineraryDiagnostics;
}

export function recordItineraryDiagnostics(
  partial: Omit<ItineraryGenerationDiagnostics, "created_at">,
): ItineraryGenerationDiagnostics {
  lastItineraryDiagnostics = { ...partial, created_at: new Date().toISOString() };
  console.info("[ITINERARY_DIAGNOSTICS]", lastItineraryDiagnostics);
  return lastItineraryDiagnostics;
}

export function inferPlaceSelectionSource(session: ChatPlanningSession): PlaceSelectionSource {
  if (session.selectionSource) return session.selectionSource;
  if (session.fromMoodFlow || session.fromMoodCard || session.chatEntry === "home_mood") {
    return "mood";
  }
  if (session.chatEntry === "mood_recommendation") return "recommendations";
  if (session.chatEntry === "tab") return "chat";
  return "chat";
}

export function isPlaceAlreadySelected(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): boolean {
  const key = placeIdentityKey(place);
  return session.selectedPlaces.some((p) => placeIdentityKey(p) === key);
}

/** 正規化後端 itinerary API 可接受的 selectedPlaces */
export function normalizePlacesForItinerary(places: ChatPlaceItem[]): RoamieRecommendationItem[] {
  return places
    .map((p) => {
      const name = (p.placeName ?? p.name)?.trim();
      if (!name) return null;
      return {
        name,
        type: p.type?.trim() || "地點",
        description: p.description?.trim() || p.reason?.trim() || "",
        reason: p.reason?.trim() || "",
        estimatedTime: p.estimatedTime?.trim() || "1-2 小時",
        address: p.address?.trim() || "",
        lat: typeof p.lat === "number" ? p.lat : null,
        lng: typeof p.lng === "number" ? p.lng : null,
        googleMapsUrl: p.googleMapsUrl?.trim() || "",
        placeName: p.placeName?.trim() || name,
        reasonSource: p.reasonSource ?? ("template" as const),
        googlePlaceId: p.placeId?.trim() || undefined,
      } satisfies RoamieRecommendationItem;
    })
    .filter((p): p is RoamieRecommendationItem => Boolean(p));
}

function itineraryContainsPlace(items: RoamieItineraryItem[], place: ChatPlaceItem): boolean {
  const target = placeDisplayName(place);
  return items.some((item) => {
    const label = item.placeName?.trim() || item.title?.trim() || "";
    return label && (isSimilarPlaceName(label, target) || label === target);
  });
}

/** 確保使用者已選地點出現在 AI 行程中 */
export function ensureSelectedPlacesInItinerary(
  itinerary: RoamieItineraryItem[],
  selected: ChatPlaceItem[],
  startDate: string,
): RoamieItineraryItem[] {
  const merged = [...itinerary];
  let hour = 10;

  for (const place of selected) {
    if (itineraryContainsPlace(merged, place)) continue;
    const name = placeDisplayName(place);
    merged.unshift({
      date: startDate,
      time: `${String(hour).padStart(2, "0")}:00`,
      title: name,
      description: place.description?.trim() || place.reason?.trim() || "使用者選定的地點",
      placeName: name,
      lat: place.lat ?? null,
      lng: place.lng ?? null,
      address: place.address?.trim() || undefined,
      googlePlaceId: place.placeId?.trim() || undefined,
      placeType: place.type?.trim() || undefined,
      notes: place.reason?.trim() || undefined,
    });
    hour = Math.min(hour + 2, 20);
  }

  return merged.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}

export function selectedPlacesDiagnosticsSnapshot(places: ChatPlaceItem[]) {
  return places.map((p) => ({
    name: placeDisplayName(p),
    place_id: p.placeId?.trim() || null,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    address: p.address?.trim() || "",
  }));
}
