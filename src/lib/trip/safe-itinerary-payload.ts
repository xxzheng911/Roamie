import type { ItineraryInput } from "@/lib/itinerary.functions";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatMsg } from "@/lib/chat-history";

export type SafeItineraryPlace = {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  category: string;
};

export type SafeRecentMessage = {
  role: "user" | "assistant";
  text: string;
};

function sanitizePlace(place: RoamieRecommendationItem): SafeItineraryPlace {
  return {
    name: (place.placeName ?? place.name ?? "").trim().slice(0, 120),
    address: (place.address ?? "").trim().slice(0, 200),
    lat: typeof place.lat === "number" ? place.lat : null,
    lng: typeof place.lng === "number" ? place.lng : null,
    category: (place.type ?? "地點").trim().slice(0, 40),
  };
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** 送進 itinerary generator 的精簡 payload，避免循環參照導致 stack overflow */
export function buildSafeItineraryGeneratorPayload(
  input: ItineraryInput,
  recentMessages?: ChatMsg[],
): ItineraryInput {
  const safe: ItineraryInput = {
    destination: String(input.destination ?? "").slice(0, 100),
    days: input.days,
    budget: input.budget,
    style: String(input.style ?? "").slice(0, 120),
    mood: String(input.mood ?? "").slice(0, 120),
    interests: String(input.interests ?? "").slice(0, 4000),
    conversationSummary: String(input.conversationSummary ?? "").slice(0, 4000),
    startDate: String(input.startDate ?? "").slice(0, 40),
    endDate: String(input.endDate ?? "").slice(0, 40),
    origin: String(input.origin ?? "").slice(0, 120),
    travelers: input.travelers,
    transport: String(input.transport ?? "").slice(0, 120),
    selectedPlaces: (input.selectedPlaces ?? []).slice(0, 20).map((p) => ({
      name: (p.placeName ?? p.name ?? "").trim(),
      type: (p.type ?? "地點").trim(),
      description: String(p.description ?? "").slice(0, 500),
      reason: String(p.reason ?? "").slice(0, 500),
      estimatedTime: String(p.estimatedTime ?? "1-2 小時").slice(0, 40),
      address: String(p.address ?? "").slice(0, 200),
      lat: typeof p.lat === "number" ? p.lat : null,
      lng: typeof p.lng === "number" ? p.lng : null,
      googleMapsUrl: String(p.googleMapsUrl ?? "").slice(0, 300),
      placeName: (p.placeName ?? p.name ?? "").trim(),
      reasonSource: p.reasonSource === "ai" ? "ai" : "template",
      googlePlaceId:
        typeof (p as { googlePlaceId?: string }).googlePlaceId === "string"
          ? (p as { googlePlaceId?: string }).googlePlaceId!.slice(0, 120)
          : undefined,
    })),
    preferences: plainRecord(input.preferences),
    location: input.location
      ? {
          lat: input.location.lat,
          lng: input.location.lng,
          city: input.location.city?.slice(0, 80),
        }
      : undefined,
    weather: plainRecord(input.weather ?? undefined) ?? input.weather,
    time: input.time?.slice(0, 40),
    fashionStyle: String(input.fashionStyle ?? "").slice(0, 80),
    locale: input.locale,
    destinationLocation: input.destinationLocation
      ? {
          lat: input.destinationLocation.lat,
          lng: input.destinationLocation.lng,
          formattedName: input.destinationLocation.formattedName?.slice(0, 120),
          displayLabel: input.destinationLocation.displayLabel?.slice(0, 120),
          city: input.destinationLocation.city?.slice(0, 80),
          country: input.destinationLocation.country?.slice(0, 80),
        }
      : undefined,
  };

  if (recentMessages?.length) {
    const tail = recentMessages
      .filter((m) => m.content.trim())
      .slice(-6)
      .map(
        (m): SafeRecentMessage => ({
          role: m.role === "user" ? "user" : "assistant",
          text: m.content.trim().slice(0, 300),
        }),
      );
    const summaryExtra = tail.map((m) => `${m.role}: ${m.text}`).join("\n");
    if (summaryExtra) {
      safe.conversationSummary = [safe.conversationSummary, summaryExtra]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4000);
    }
  }

  return safe;
}

export function logItinerarySafePayloadReady(
  safe: ItineraryInput,
  extra?: { recentMessagesCount?: number },
): void {
  console.info("[ITINERARY_SAFE_PAYLOAD_READY]", {
    destination: safe.destination,
    days: safe.days,
    selectedPlacesCount: safe.selectedPlaces?.length ?? 0,
    recentMessagesCount: extra?.recentMessagesCount ?? 0,
  });
}

export function logItineraryGeneratorFailed(step: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("[ITINERARY_GENERATOR_FAILED]", { step, error: msg });
}

export function safeSerializeItineraryPayload(input: ItineraryInput): string {
  const safe = buildSafeItineraryGeneratorPayload(input);
  try {
    return JSON.stringify(safe);
  } catch (e) {
    logItineraryGeneratorFailed("serialize", e);
    return JSON.stringify({
      destination: safe.destination,
      days: safe.days,
      selectedPlaces: safe.selectedPlaces?.map(sanitizePlace),
    });
  }
}
