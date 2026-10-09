import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { GenerateOutfitSuggestionResult } from "@/lib/outfit/generate-trip-outfit.server";
import { requireSupabasePlus } from "@/integrations/supabase/security-middleware";

const ItemSchema = z.object({
  date: z.string(),
  time: z.string(),
  title: z.string(),
  description: z.string(),
  placeName: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  address: z.string().optional(),
});

const InputSchema = z.object({
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  destination: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  dayCount: z.number().int().min(1).max(14),
  items: z.array(ItemSchema),
  transport: z.enum(["walk", "scooter", "drive", "transit"]).optional().nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  timezone: z.string().optional(),
  utcOffsetMinutes: z.number().nullable().optional(),
  mood: z.string().optional(),
});

export const generateTripOutfitSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabasePlus])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateOutfitSuggestionResult> => {
    const { generateOutfitSuggestion } = await import("@/lib/outfit/generate-trip-outfit.server");
    const { getWeatherSourceAvailability } = await import("@/lib/weather/visual-crossing.server");
    return { ...await generateOutfitSuggestion(data), weatherSourceAvailability: getWeatherSourceAvailability() };
  });

/** Capability check only: no provider, AI or DO calls. Same existing access policy. */
export const getTripWeatherSourceAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabasePlus])
  .handler(async () => {
    const { getWeatherSourceAvailability } = await import("@/lib/weather/visual-crossing.server");
    return getWeatherSourceAvailability();
  });
