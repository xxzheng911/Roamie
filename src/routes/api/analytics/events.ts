import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ANALYTICS_EVENT_NAMES } from "@/lib/analytics/events";
import { recordAnalyticsEventServer } from "@/lib/analytics/record.server";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";

const ClientNames = [
  "chat_session_started",
  "recommendation_requested",
  "place_card_opened",
  "affiliate_cta_impression",
  "affiliate_cta_clicked",
  "affiliate_outbound_open_succeeded",
] as const;
const Schema = z.object({
  eventId: z.string().min(8).max(200),
  eventName: z.enum(ANALYTICS_EVENT_NAMES),
  occurredAt: z.string().datetime().optional(),
  tier: z.enum(["free", "plus"]).optional(),
  sessionId: z.string().max(160).optional(),
  surface: z
    .enum(["home", "chat", "explore", "selection", "favorites", "itinerary", "map"])
    .optional(),
  placeId: z.string().max(255).optional(),
  recommendationFamily: z.string().max(80).optional(),
  provider: z.string().max(80).optional(),
  failureCode: z.string().max(100).optional(),
});

export const Route = createFileRoute("/api/analytics/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuthenticatedAiRequest(request);
        if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        let event;
        try {
          event = Schema.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid event" }, { status: 400 });
        }
        if (!(ClientNames as readonly string[]).includes(event.eventName))
          return Response.json({ error: "Server-authority event required" }, { status: 403 });
        await recordAnalyticsEventServer(
          { ...event, tier: auth.hasPlusAccess ? "plus" : "free" },
          auth.userId,
        );
        return new Response(null, { status: 204 });
      },
    },
  },
});
