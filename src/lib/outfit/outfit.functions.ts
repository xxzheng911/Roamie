import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { GenerateOutfitSuggestionResult } from "@/lib/outfit/generate-trip-outfit.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parsePlusEntitlementSnapshot } from "@/lib/plan-tier/entitlement";

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
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GenerateOutfitSuggestionResult> => {
    const { generateOutfitSuggestion } = await import("@/lib/outfit/generate-trip-outfit.server");
    const { getWeatherSourceAvailability } = await import("@/lib/weather/visual-crossing.server");
    // Only the authenticated server resolver may grant AI access. Client tier flags
    // are neither accepted nor forwarded. Resolver failure keeps basic weather usable.
    let allowAi = false;
    try {
      const { data: entitlement, error } = await context.supabase.rpc("resolve_user_plus_entitlement", {
        p_user_id: context.userId,
      });
      allowAi = !error && parsePlusEntitlementSnapshot(entitlement).hasPlus;
    } catch { /* Fail closed for AI, retain rule-based weather guidance. */ }
    return { ...await generateOutfitSuggestion(data, { allowAi }), weatherSourceAvailability: getWeatherSourceAvailability() };
  });

/** Capability check only: no provider, AI or DO calls. Authenticated basic weather access; no Plus requirement. */
export const getTripWeatherSourceAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getWeatherSourceAvailability } = await import("@/lib/weather/visual-crossing.server");
    return getWeatherSourceAvailability();
  });
