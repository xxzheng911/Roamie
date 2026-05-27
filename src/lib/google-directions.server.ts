import { fetchLegDurationsFromRoutes } from "@/lib/google-routes.server";
import type { LegDurationEstimate } from "@/lib/routes/types";

export type DistanceMatrixMode = "walking" | "driving" | "transit";

/**
 * 點對點路程時間（Google Routes API）
 * https://developers.google.com/maps/documentation/routes
 */
export async function fetchLegDurations(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<LegDurationEstimate> {
  try {
    return await fetchLegDurationsFromRoutes(origin, destination);
  } catch (e) {
    console.warn("[Roamie Routes] fetchLegDurations failed", e);
    return { distanceMeters: 0 };
  }
}
