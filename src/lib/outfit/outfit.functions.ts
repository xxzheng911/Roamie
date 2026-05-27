import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { GenerateOutfitSuggestionResult } from "@/lib/outfit/generate-trip-outfit.server";
import type { TripLocation } from "@/lib/location/types";

const ItemSchema = z.object({
  date: z.string().optional(),
  time: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  placeName: z.string().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  address: z.string().optional(),
});

const LocationSchema = z
  .object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    formattedName: z.string().optional(),
    displayLabel: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  })
  .nullable()
  .optional();

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
  destinationLocation: LocationSchema,
});

function normalizeOutfitItems(items: z.infer<typeof ItemSchema>[]): RoamieItineraryItem[] {
  return items.map((item) => ({
    date: item.date?.trim() || new Date().toISOString().slice(0, 10),
    time: item.time?.trim() || "10:00",
    title: item.title?.trim() || item.placeName?.trim() || "地點",
    description: item.description?.trim() || "",
    placeName: item.placeName?.trim() || item.title?.trim() || "地點",
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    address: item.address,
  }));
}

export const generateTripOutfitSuggestion = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateOutfitSuggestionResult> => {
    const { generateOutfitSuggestion } = await import("@/lib/outfit/generate-trip-outfit.server");
    return generateOutfitSuggestion({
      destination: data.destination,
      destinationLocation: data.destinationLocation as TripLocation | null | undefined,
      startDate: data.startDate,
      endDate: data.endDate,
      dayCount: data.dayCount,
      items: normalizeOutfitItems(data.items),
      transport: data.transport,
      lat: data.lat,
      lng: data.lng,
      mood: data.mood,
    });
  });
