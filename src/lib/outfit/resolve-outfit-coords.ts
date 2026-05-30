import type { RoamieItineraryItem } from "@/lib/ai/types";
import { geocodeForwardUrl } from "@/lib/google-maps-api";
import type { TripLocation } from "@/lib/location/types";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";

export type ResolveOutfitCoordsInput = {
  destination?: string;
  destinationLocation?: TripLocation | null;
  itinerary?: RoamieItineraryItem[];
  lat?: number | null;
  lng?: number | null;
};

function geocodeQueries(input: ResolveOutfitCoordsInput): string[] {
  const loc = input.destinationLocation;
  const resolved = resolveTripDestination({
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    itinerary: input.itinerary,
  });
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (q?: string | null) => {
    const t = q?.trim();
    if (!t || t === "你的目的地" || t === "尚未設定" || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  push(loc?.formattedName);
  push(loc?.displayLabel);
  if (loc?.city) push(loc.country ? `${loc.country} ${loc.city}` : loc.city);
  push(input.destination);
  push(resolved);
  for (const item of input.itinerary ?? []) {
    push(item.address);
    push(item.placeName);
  }
  return out;
}

async function geocodeDestination(queries: string[]): Promise<{ lat: number; lng: number } | null> {
  if (queries.length === 0) return null;
  try {
    const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
    const apiKey = requireGoogleMapsServerKey();
    for (const query of queries) {
      const res = await fetch(
        geocodeForwardUrl(query, apiKey, { language: "zh-TW", region: "tw" }),
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      if (json.status !== "OK" || !json.results?.[0]?.geometry?.location) continue;
      const { lat, lng } = json.results[0].geometry.location;
      if (lat != null && lng != null) return { lat, lng };
    }
  } catch (e) {
    console.warn("[Roamie Outfit] geocode destination failed", e);
  }
  return null;
}

/** 依目的地／行程地點解析天氣查詢座標（優先目的地，而非使用者 GPS） */
export async function resolveOutfitCoords(
  input: ResolveOutfitCoordsInput,
): Promise<{ lat: number; lng: number } | null> {
  const loc = input.destinationLocation;
  if (loc?.lat != null && loc?.lng != null) {
    return { lat: loc.lat, lng: loc.lng };
  }

  const fromItinerary = (input.itinerary ?? []).find((i) => i.lat != null && i.lng != null);
  if (fromItinerary?.lat != null && fromItinerary?.lng != null) {
    return { lat: fromItinerary.lat, lng: fromItinerary.lng };
  }

  const geocoded = await geocodeDestination(geocodeQueries(input));
  if (geocoded) return geocoded;

  if (input.lat != null && input.lng != null) {
    return { lat: input.lat, lng: input.lng };
  }

  return null;
}
