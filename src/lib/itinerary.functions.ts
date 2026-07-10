import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type {
  RoamiePayloadV2,
  RoamieRecommendationItem,
  RoamieItineraryItem,
  RoamieResponse,
  TripTransportMode,
} from "@/lib/ai/types";
import { buildOutfitAdviceForTrip } from "@/lib/outfit/build-advice";
import { normalizeTime } from "@/lib/picker-utils";
import {
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
  isGenericPlaceLabel,
  isValidItineraryStopPlace,
} from "@/lib/ai/generic-place-label";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
  groupItineraryItemsByDay,
  type GenerateItineraryResult,
} from "@/lib/trip/itinerary-guards";
import { preparePlacesForItineraryBuild } from "@/lib/place-planning-memory";

const PlaceSchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    description: z.string().optional(),
    reason: z.string().optional(),
    estimatedTime: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    googleMapsUrl: z.string().optional(),
    placeName: z.string().optional(),
    googlePlaceId: z.string().optional(),
    reasonSource: z.enum(["template", "ai"]).optional(),
  })
  .transform((raw) => ({
    name: raw.name,
    type: raw.type ?? "地點",
    description: raw.description ?? "",
    reason: raw.reason ?? "",
    estimatedTime: raw.estimatedTime ?? "1-2 小時",
    address: raw.address ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    googleMapsUrl: raw.googleMapsUrl ?? "",
    placeName: raw.placeName ?? raw.name,
    googlePlaceId: raw.googlePlaceId,
    reasonSource: raw.reasonSource ?? "template",
  }));

const InputSchema = z.object({
  destination: z.string().min(1).max(100),
  days: z.number().int().min(1).max(14),
  budget: z.enum(["low", "medium", "high"]).default("medium"),
  style: z.string().max(120).optional().default(""),
  mood: z.string().max(120).optional().default(""),
  interests: z.string().max(4000).optional().default(""),
  conversationSummary: z.string().max(4000).optional().default(""),
  startDate: z.string().max(40).optional().default(""),
  endDate: z.string().max(40).optional().default(""),
  origin: z.string().max(120).optional().default(""),
  travelers: z.number().int().min(1).max(20).optional(),
  transport: z.string().max(120).optional().default(""),
  selectedPlaces: z.array(PlaceSchema).max(20).optional().default([]),
  preferences: z.record(z.unknown()).optional(),
  location: z.object({ lat: z.number(), lng: z.number(), city: z.string().optional() }).optional(),
  weather: z.record(z.unknown()).nullable().optional(),
  time: z.string().optional(),
  /** 穿搭風格（文青、韓系、極簡等），來自個人檔案 */
  fashionStyle: z.string().max(80).optional().default(""),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

function inferTripTransport(transport?: string): TripTransportMode {
  const t = (transport ?? "").toLowerCase();
  if (/機車|scooter|摩托/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車/.test(t)) return "drive";
  if (/捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro/.test(t)) return "transit";
  return "walk";
}

function filterValidSelectedPlaces(
  places: RoamieRecommendationItem[],
  destination: string,
): RoamieRecommendationItem[] {
  return preparePlacesForItineraryBuild(
    places.map((p) => ({
      ...p,
      placeId: p.googlePlaceId ?? (p as RoamieRecommendationItem & { placeId?: string }).placeId,
    })),
    destination,
  );
}

function enrichItineraryFromSelectedPlaces(
  items: RoamieItineraryItem[],
  selectedPlaces: RoamieRecommendationItem[],
  destination: string,
): RoamieItineraryItem[] {
  const byId = new Map(
    selectedPlaces
      .filter((p) => p.googlePlaceId?.trim())
      .map((p) => [p.googlePlaceId!.trim(), p]),
  );
  const byName = new Map(
    selectedPlaces.map((p) => [(p.placeName ?? p.name).trim(), p]),
  );

  return items
    .map((item) => {
      const name = (item.placeName ?? item.title).trim();
      if (!name || isGenericPlaceLabel(name, destination)) return null;

      const match =
        (item.googlePlaceId?.trim() && byId.get(item.googlePlaceId.trim())) ||
        byName.get(name) ||
        byName.get(item.title.trim());

      const enriched: RoamieItineraryItem = match
        ? {
            ...item,
            placeName: match.placeName ?? match.name,
            title: item.title?.trim() ? item.title : match.name,
            googlePlaceId: match.googlePlaceId,
            lat: match.lat,
            lng: match.lng,
            address: item.address?.trim() ? item.address : match.address,
          }
        : item;

      if (
        !isValidItineraryStopPlace(
          {
            placeName: enriched.placeName,
            name: enriched.title,
            placeId: enriched.googlePlaceId,
            googlePlaceId: enriched.googlePlaceId,
            address: enriched.address,
            lat: enriched.lat,
            lng: enriched.lng,
          },
          destination,
        )
      ) {
        return null;
      }
      return enriched;
    })
    .filter((item): item is RoamieItineraryItem => item != null);
}

function buildItineraryFromSelectedPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
): RoamieItineraryItem[] {
  return buildFallbackItineraryFromPlaces(selectedPlaces, days, startDate, destination);
}

function buildFallbackTripPayload(
  data: ItineraryInput,
  items: RoamieItineraryItem[],
  selectedPlaces: RoamieRecommendationItem[],
): RoamiePayloadV2 {
  const placeNames = selectedPlaces.map((p) => p.placeName ?? p.name).join("、");
  return {
    version: 2,
    title: `${data.destination} ${data.days} 天`,
    summary: `依你選的地點排成 ${data.days} 天節奏：${placeNames}`,
    moodTag: data.mood ?? "",
    recommendations: selectedPlaces,
    itinerary: items,
    destination: data.destination,
    days: data.days,
    generatedAt: new Date().toISOString(),
  };
}

export type ItineraryInput = z.infer<typeof InputSchema>;

/** @deprecated Legacy format — kept for backward-compatible trip display */
export type ItineraryBlock = {
  time: string;
  title: string;
  type: "place" | "food" | "transit" | "rest" | "experience";
  description: string;
  duration_minutes: number;
  estimated_cost: string;
  tags: string[];
};

export type ItineraryDay = {
  day: number;
  date?: string;
  theme: string;
  weather_note?: string;
  blocks: ItineraryBlock[];
  rainy_alternative?: string;
  estimated_daily_cost: string;
};

export type Itinerary = {
  title: string;
  destination: string;
  days: number;
  mood: string;
  summary: string;
  total_estimated_cost: string;
  transport_tips: string;
  daily_plan: ItineraryDay[];
};

export const generateItinerary = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateItineraryResult> => {
    const [{ callRoamieAI }, { buildTransitLegsForItinerary }, { openWeatherGetForecast }] =
      await Promise.all([
        import("@/lib/ai/service.server"),
        import("@/lib/transit/build-legs.server"),
        import("@/lib/weather/openweather.server"),
      ]);
    const selectedPlaces = filterValidSelectedPlaces(
      (data.selectedPlaces ?? []) as RoamieRecommendationItem[],
      data.destination,
    );

    if (selectedPlaces.length < 1) {
      return {
        success: false,
        errorCode: "insufficient_places",
        message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      };
    }

    const interestsText = [data.interests, data.conversationSummary].filter(Boolean).join("\n\n");
    const startDate = data.startDate?.trim() || new Date().toISOString().slice(0, 10);

    let ai: RoamiePayloadV2 | null = null;

    try {
      const aiResponse: RoamieResponse = await callRoamieAI({
        mode: "itinerary",
        locale: data.locale,
        mood: data.mood,
        preferences: data.preferences as never,
        location: data.location,
        weather: data.weather as never,
        time: data.time,
        planningHints: {
          transportation: data.transport,
          budget: data.budget === "low" ? "省錢" : data.budget === "high" ? "舒適" : "適中",
          conversationSummary: data.conversationSummary,
        },
        itineraryRequest: {
          destination: data.destination,
          days: data.days,
          budget: data.budget,
          style: data.style,
          mood: data.mood,
          interests: interestsText,
          startDate: data.startDate,
          endDate: data.endDate,
          origin: data.origin,
          travelers: data.travelers,
          transport: data.transport,
          selectedPlaces,
        },
      });

      let rawItinerary = coalesceItineraryItems(aiResponse.itinerary);
      if (rawItinerary.length > 0) {
        const enrichedItinerary = enrichItineraryFromSelectedPlaces(
          rawItinerary,
          selectedPlaces,
          data.destination,
        );
        if (enrichedItinerary.length > 0) {
          ai = { ...aiResponse, itinerary: enrichedItinerary };
        }
      }
    } catch (e) {
      console.warn("[Roamie] AI itinerary generation failed", e);
    }

    if (!ai || coalesceItineraryItems(ai.itinerary).length < 1) {
      devVerboseInfo("[AI_ITINERARY_BUILD] building from selectedPlaces", {
        count: selectedPlaces.length,
        days: data.days,
      });
      const builtItems = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
      );
      ai = buildFallbackTripPayload(data, builtItems, selectedPlaces);
    }

    const lat = data.location?.lat;
    const lng = data.location?.lng;

    let outfitAdvice: RoamiePayloadV2["outfitAdvice"];
    if (lat != null && lng != null) {
      try {
        const forecast = await openWeatherGetForecast(lat, lng, data.days);
        outfitAdvice = await buildOutfitAdviceForTrip({
          destination: data.destination,
          startDate,
          days: data.days,
          forecast,
          itinerary: ai.itinerary,
          fashionStyle: data.fashionStyle || undefined,
          mood: data.mood || undefined,
        });
      } catch (e) {
        console.warn("[Roamie] outfit advice skipped", e);
      }
    }

    let tripSettings: RoamiePayloadV2["tripSettings"];
    try {
      const weatherHint = data.weather as {
        condition?: string;
        precipProbability?: number;
        tempC?: number;
        feelsLikeC?: number;
        isDaytime?: boolean;
        uvi?: number;
      } | null;
      const temp = weatherHint?.feelsLikeC ?? weatherHint?.tempC;
      const transit = await buildTransitLegsForItinerary({
        items: ai.itinerary.map((i) => ({
          placeName: i.placeName,
          title: i.title,
          lat: i.lat,
          lng: i.lng,
          date: i.date,
          time: i.time,
        })),
        destination: data.destination,
        preferences: {
          transportation: data.transport,
          pace: data.preferences?.pace as string | undefined,
        },
        weather: weatherHint
          ? {
              ...weatherHint,
              isRainy:
                (weatherHint.precipProbability ?? 0) >= 40 ||
                (weatherHint.condition ?? "").includes("雨"),
              isHot: temp != null && temp >= 32,
              isNight: weatherHint.isDaytime === false,
              uvi: weatherHint.uvi ?? null,
            }
          : undefined,
        time: data.time,
        useAiReasons: true,
      });
      tripSettings = {
        startTime: data.time
          ? normalizeTime(data.time)
          : (coalesceItineraryItems(ai.itinerary)[0]?.time?.slice(0, 5) ?? "09:30"),
        tripStartDate: data.startDate?.trim() || startDate,
        tripEndDate: data.endDate?.trim() || data.startDate?.trim() || startDate,
        transport: inferTripTransport(data.transport),
        legMinutes: {},
        transitLegs: Object.fromEntries(transit.legs.map((l) => [l.legKey, l])),
        transportTips: transit.transportTips,
      };
    } catch (e) {
      console.warn("[Roamie] transit legs skipped on generate", e);
    }

    const itineraryItems = coalesceItineraryItems(ai.itinerary);
    const payload: RoamiePayloadV2 = {
      ...ai,
      version: 2,
      destination: data.destination,
      days: data.days,
      generatedAt: new Date().toISOString(),
      outfitAdvice,
      tripSettings,
      itinerary: itineraryItems,
    };

    return {
      success: true,
      trip: {
        id: `trip-${Date.now()}`,
        title: payload.title || `${data.destination} ${data.days} 天`,
        destination: data.destination,
        days: data.days,
        itinerary: groupItineraryItemsByDay(itineraryItems, startDate),
        payload,
      },
    };
  });
