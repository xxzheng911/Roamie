import { createFileRoute } from "@tanstack/react-router";
import { generateItinerary } from "@/lib/itinerary.functions";
import {
  requireAuthenticatedAiRequest,
  reserveServerCredits,
  settleServerCredits,
} from "@/lib/ai/endpoint-guard.server";
import { analyticsOperationEventId } from "@/lib/analytics/events";
import { recordAnalyticsEventServer } from "@/lib/analytics/record.server";

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true;
  try {
    return new URL(request.url).host === new URL(origin).host;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/generate-itinerary")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAllowedOrigin(request)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        const auth = await requireAuthenticatedAiRequest(request);
        if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const credits = await reserveServerCredits(auth, "ITINERARY_GENERATION", request);
        if (credits.response || !credits.reservation) return credits.response!;
        const reservation = credits.reservation;
        request.signal.addEventListener(
          "abort",
          () => void settleServerCredits(auth, reservation, false),
          { once: true },
        );
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          await settleServerCredits(auth, reservation, false);
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const operationId =
          request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          payload = { ...(payload as Record<string, unknown>), generationTimingId: operationId };
        }
        await recordAnalyticsEventServer(
          {
            eventId: analyticsOperationEventId(operationId, "started"),
            eventName: "itinerary_generation_started",
            tier: auth.hasPlusAccess ? "plus" : "free",
          },
          auth.userId,
        );
        try {
          // generateItinerary is a createServerFn — validates input via zod
          // and reads OPENAI_API_KEY from process.env on the server only.
          const result = await generateItinerary({ data: payload as never });
          const succeeded = Boolean((result as { success?: boolean }).success);
          await settleServerCredits(auth, reservation, succeeded);
          await recordAnalyticsEventServer(
            {
              eventId: analyticsOperationEventId(operationId, succeeded ? "succeeded" : "failed"),
              eventName: succeeded
                ? "itinerary_generation_succeeded"
                : "itinerary_generation_failed",
              tier: auth.hasPlusAccess ? "plus" : "free",
              failureCode: succeeded
                ? undefined
                : ((result as { errorCode?: string }).errorCode ?? "planner_failed"),
            },
            auth.userId,
          );
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          await settleServerCredits(auth, reservation, false);
          await recordAnalyticsEventServer(
            {
              eventId: analyticsOperationEventId(operationId, "failed"),
              eventName: "itinerary_generation_failed",
              tier: auth.hasPlusAccess ? "plus" : "free",
              failureCode: "server_error",
            },
            auth.userId,
          );
          const message = e instanceof Error ? e.message : "AI 服務暫時無法使用。";
          const status = /OPENAI_API_KEY/i.test(message) ? 500 : 400;
          console.error("[generate-itinerary] failed:", e);
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
