import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { callRoamieAI } from "@/lib/ai/service.server";
import type { RoamiePayloadV2, RoamieRecommendationItem, RoamieResponse } from "@/lib/ai/types";
import { buildOutfitAdviceForTrip } from "@/lib/outfit/build-advice";
import { fetchOpenMeteoDailyForecast } from "@/lib/weather.functions";

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
  location: z
    .object({ lat: z.number(), lng: z.number(), city: z.string().optional() })
    .optional(),
  weather: z.record(z.unknown()).nullable().optional(),
  time: z.string().optional(),
  /** 穿搭風格（文青、韓系、極簡等），來自個人檔案 */
  fashionStyle: z.string().max(80).optional().default(""),
});

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
  .handler(async ({ data }): Promise<{ itinerary: RoamiePayloadV2 }> => {
    const selectedPlaces = (data.selectedPlaces ?? []) as RoamieRecommendationItem[];

    const interestsText = [data.interests, data.conversationSummary].filter(Boolean).join("\n\n");

    const ai: RoamieResponse = await callRoamieAI({
      mode: "itinerary",
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

    const startDate =
      data.startDate?.trim() || new Date().toISOString().slice(0, 10);
    const lat = data.location?.lat;
    const lng = data.location?.lng;

    let outfitAdvice: RoamiePayloadV2["outfitAdvice"];
    if (lat != null && lng != null) {
      try {
        const forecast = await fetchOpenMeteoDailyForecast(lat, lng, data.days);
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

    const itinerary: RoamiePayloadV2 = {
      ...ai,
      version: 2,
      destination: data.destination,
      days: data.days,
      generatedAt: new Date().toISOString(),
      outfitAdvice,
    };

    return { itinerary };
  });
