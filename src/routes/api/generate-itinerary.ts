import { createFileRoute } from "@tanstack/react-router";
import { generateItinerary } from "@/lib/itinerary.functions";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { analyticsOperationEventId } from "@/lib/analytics/events";
import { recordAnalyticsEventServer } from "@/lib/analytics/record.server";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";
import { INSUFFICIENT_CREDITS_ERROR_CODE, isInsufficientCreditsError } from "@/lib/credits/errors";

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "capacitor:" && parsed.hostname === "localhost") return true;
    return new URL(request.url).host === parsed.host;
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
        const rate = checkRateLimit(
          `itinerary:${auth.userId}:minute`,
          SECURITY_RATE_LIMITS.itineraryPerMinute,
          60_000,
        );
        if (!rate.allowed)
          return Response.json(
            { error: "rate_limited" },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
          );
        const operationId =
          request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
        let correlatedGenerationId = operationId;
        request.signal.addEventListener(
          "abort",
          () => {
            console.info("[ITINERARY_SERVER_RESULT]", {
              generationId: correlatedGenerationId,
              successDiscriminant: false,
              errorCode: "request_aborted",
              failureReason: "abort",
              failedRuleCount: 0,
              tripPresent: false,
              payloadPresent: false,
              transport: "https_api",
            });
          },
          { once: true },
        );
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          correlatedGenerationId =
            typeof (payload as Record<string, unknown>).generationId === "string"
              ? ((payload as Record<string, unknown>).generationId as string)
              : operationId;
          payload = { ...(payload as Record<string, unknown>), generationTimingId: operationId };
          const requestBody = payload as Record<string, unknown>;
          console.info("[ITINERARY_DAYS_AUTHORITY]", {
            generationId: correlatedGenerationId,
            stage: "api_request",
            explicitDays: typeof requestBody.days === "number" ? requestBody.days : null,
            derivedDays: null,
            effectiveDays: typeof requestBody.days === "number" ? requestBody.days : null,
            startDatePresent: Boolean(
              typeof requestBody.startDate === "string" && requestBody.startDate.trim(),
            ),
            endDatePresent: Boolean(
              typeof requestBody.endDate === "string" && requestBody.endDate.trim(),
            ),
            source: typeof requestBody.days === "number" ? "explicit_days" : "none",
          });
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
          const insufficientCredits = isInsufficientCreditsError(e);
          await recordAnalyticsEventServer(
            {
              eventId: analyticsOperationEventId(operationId, "failed"),
              eventName: "itinerary_generation_failed",
              tier: auth.hasPlusAccess ? "plus" : "free",
              failureCode: insufficientCredits ? INSUFFICIENT_CREDITS_ERROR_CODE : "server_error",
            },
            auth.userId,
          );
          const status = insufficientCredits ? 402 : 500;
          console.info("[ITINERARY_SERVER_RESULT]", {
            generationId:
              payload && typeof payload === "object" && !Array.isArray(payload)
                ? ((payload as Record<string, unknown>).generationId ?? operationId)
                : operationId,
            successDiscriminant: false,
            errorCode: insufficientCredits ? INSUFFICIENT_CREDITS_ERROR_CODE : "server_error",
            failureReason: insufficientCredits ? "insufficient_credits" : "exception",
            failedRuleCount: 0,
            tripPresent: false,
            payloadPresent: false,
            transport: "https_api",
          });
          if (!insufficientCredits) console.error("[generate-itinerary] failed:", e);
          return new Response(
            JSON.stringify({
              error: insufficientCredits
                ? INSUFFICIENT_CREDITS_ERROR_CODE
                : "generation_unavailable",
              requestId: operationId,
            }),
            {
              status,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});
