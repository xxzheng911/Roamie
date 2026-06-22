import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RoutesTravelMode } from "@/lib/routes/types";

const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const TravelModeSchema = z.enum(["WALK", "DRIVE", "TRANSIT", "BICYCLE", "TWO_WHEELER"]);

export const routesComputeDuration = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        origin: LatLngSchema,
        destination: LatLngSchema,
        travelMode: TravelModeSchema,
        departureTime: z.string().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getRouteDuration } = await import("@/lib/google-routes.server");
    return getRouteDuration(
      data.origin,
      data.destination,
      data.travelMode,
      data.departureTime,
    );
  });

export const routesComputeDistance = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        origin: LatLngSchema,
        destination: LatLngSchema,
        travelMode: TravelModeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getRouteDistance } = await import("@/lib/google-routes.server");
    return getRouteDistance(data.origin, data.destination, data.travelMode);
  });

export const routesComputeTripLegs = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        places: z.array(LatLngSchema).min(2).max(30),
        travelMode: TravelModeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { getTripLegsWithDurations } = await import("@/lib/google-routes.server");
    return getTripLegsWithDurations(data.places, data.travelMode);
  });

export const routesComputeLegEstimates = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        origin: LatLngSchema,
        destination: LatLngSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { fetchLegDurationsFromRoutes } = await import("@/lib/google-routes.server");
    const estimates = await fetchLegDurationsFromRoutes(data.origin, data.destination);
    if (
      estimates.walk == null &&
      estimates.drive == null &&
      estimates.transit == null
    ) {
      return {
        ok: false as const,
        statusCode: 0,
        message: "all_modes_failed",
      };
    }
    return { ok: true as const, data: estimates };
  });

export const routesTestConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { testRoutesApiConnection } = await import("@/lib/google-routes.server");
  return testRoutesApiConnection();
});

export type { RoutesTravelMode };
