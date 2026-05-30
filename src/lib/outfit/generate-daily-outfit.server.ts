import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import {
  buildOutfitAdviceForTrip,
  buildUnavailableOutfitAdvice,
} from "@/lib/outfit/build-advice";
import { resolveOutfitCoords } from "@/lib/outfit/resolve-outfit-coords";
import { resolveTripDestination } from "@/lib/outfit/trip-outfit-context";
import type { OutfitAdvicePayload } from "@/lib/outfit/types";
import { openWeatherGetForecast } from "@/lib/weather/openweather.server";

export type GenerateDailyOutfitInput = {
  destination?: string;
  destinationLocation?: TripLocation | null;
  startDate: string;
  endDate?: string;
  dayCount: number;
  items: RoamieItineraryItem[];
  lat?: number | null;
  lng?: number | null;
  fashionStyle?: string;
  mood?: string;
};

/** 依行程資料取得每日穿搭建議（含天氣 API + AI） */
export async function generateDailyOutfitAdviceForTrip(
  input: GenerateDailyOutfitInput,
): Promise<OutfitAdvicePayload> {
  const destination = resolveTripDestination({
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    itinerary: input.items,
  });
  const days = Math.min(Math.max(input.dayCount, 1), 14);
  const startDate = input.startDate?.trim() || new Date().toISOString().slice(0, 10);

  const coords = await resolveOutfitCoords({
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    itinerary: input.items,
    lat: input.lat,
    lng: input.lng,
  });

  if (!coords) {
    return buildUnavailableOutfitAdvice(destination);
  }

  try {
    const forecast = await openWeatherGetForecast(coords.lat, coords.lng, days);
    if (!forecast.length) {
      return buildUnavailableOutfitAdvice(destination);
    }
    return buildOutfitAdviceForTrip({
      destination,
      startDate,
      days,
      forecast,
      itinerary: input.items,
      fashionStyle: input.fashionStyle,
      mood: input.mood,
    });
  } catch (e) {
    console.warn("[Roamie DailyOutfit] weather/outfit failed", e);
    return buildUnavailableOutfitAdvice(destination);
  }
}
