import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { LegDurationEstimate } from "@/lib/routes/types";

const InputSchema = z.object({
  originLat: z.number(),
  originLng: z.number(),
  destLat: z.number(),
  destLng: z.number(),
});

export const fetchPlaceTravelDurations = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(
    async ({ data }): Promise<{ durations: LegDurationEstimate | null; error: string | null }> => {
      try {
        const { fetchLegDurations } = await import("@/lib/google-directions.server");
        const durations = await fetchLegDurations(
          { lat: data.originLat, lng: data.originLng },
          { lat: data.destLat, lng: data.destLng },
        );
        return { durations, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "無法取得路線時間";
        console.warn("[Roamie] fetchPlaceTravelDurations", msg);
        return { durations: null, error: msg };
      }
    },
  );
