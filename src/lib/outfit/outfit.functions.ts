import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
type GenerateOutfitSuggestionResult = {
  suggestion: string;
  source: "ai" | "fallback";
  generatedAt: string;
};

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
  destination: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  dayCount: z.number().int().min(1).max(14),
  items: z.array(ItemSchema),
  transport: z.enum(["walk", "scooter", "drive", "transit"]).optional().nullable(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  mood: z.string().optional(),
});

export const generateTripOutfitSuggestion = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateOutfitSuggestionResult> => {
    const { generateOutfitSuggestion } = await import("@/lib/outfit/generate-trip-outfit.server");
    return generateOutfitSuggestion(data);
  });
