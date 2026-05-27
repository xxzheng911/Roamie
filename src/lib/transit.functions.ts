import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { TransitLegAdvice } from "@/lib/transit/types";

const LegItemSchema = z.object({
  placeName: z.string(),
  title: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  date: z.string().optional(),
  time: z.string().optional(),
});

const InputSchema = z.object({
  destination: z.string().max(120).optional(),
  items: z.array(LegItemSchema).min(2).max(30),
  preferences: z
    .object({
      transportation: z.string().optional(),
      pace: z.string().optional(),
      companionship: z.string().optional(),
      setting: z.string().optional(),
      vibe: z.string().optional(),
    })
    .optional(),
  weather: z
    .object({
      condition: z.string().optional(),
      precipProbability: z.number().nullable().optional(),
      tempC: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  time: z.string().optional(),
  useAiReasons: z.boolean().optional().default(true),
});

export type RecommendTransitInput = z.infer<typeof InputSchema>;

export type RecommendTransitResult = {
  legs: TransitLegAdvice[];
  transportTips: string;
};

/** 智慧交通建議：點到點分析（Google Routes API + Roamie 規則 / AI） */
export const recommendTransitLegs = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<RecommendTransitResult> => {
    const { buildTransitLegsForItinerary } = await import("@/lib/transit/build-legs.server");
    const weather = data.weather
      ? {
          ...data.weather,
          isRainy:
            (data.weather.precipProbability ?? 0) >= 40 ||
            (data.weather.condition ?? "").includes("雨"),
        }
      : undefined;

    return buildTransitLegsForItinerary({
      items: data.items,
      destination: data.destination,
      preferences: data.preferences,
      weather,
      time: data.time,
      useAiReasons: data.useAiReasons,
    });
  });
