import {
  startGenerationDiagnostics,
  correlateGeneration,
  setGenerationPhase,
  captureGenerationException,
  emitGenerationDiagnostic,
} from "@/lib/itinerary-diagnostics.server";
import { createFileRoute } from "@tanstack/react-router";
import { generateItinerary } from "@/lib/itinerary.functions";
import { authorizeAiUse } from "@/lib/abuse-guard.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";
import { analyticsOperationEventId } from "@/lib/analytics/events";
import { recordAnalyticsEventServer } from "@/lib/analytics/record.server";
import { bindVerifiedUserId } from "@/lib/worker-request-scope";
import { INSUFFICIENT_CREDITS_ERROR_CODE, isInsufficientCreditsError } from "@/lib/credits/errors";
import {
  invalidItineraryDurationFailure,
  itineraryFailureUserMessage,
} from "@/lib/trip/itinerary-guards";
import { isItineraryDurationValidationError } from "@/lib/ai/itinerary-days";

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

        const operationId =
          request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
        startGenerationDiagnostics(request, operationId);
        try {
          const auth = await requireAuthenticatedAiRequest(request);
          if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
          if (!isAbuseGuardEnforcementOn()) {
            const rate = checkRateLimit(
              `itinerary:${auth.userId}:minute`,
              SECURITY_RATE_LIMITS.itineraryPerMinute,
              60_000,
            );
            if (!rate.allowed) {
              return Response.json(
                { error: "rate_limited" },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
              );
            }
          }
          bindVerifiedUserId(auth.userId);
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
          setGenerationPhase("input_validation");
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
            correlateGeneration(correlatedGenerationId);
            payload = { ...(payload as Record<string, unknown>), generationTimingId: operationId };
            const requestBody = payload as Record<string, unknown>;
            const durationFailure = invalidItineraryDurationFailure(requestBody.days);
            if (durationFailure) {
              console.info("[ITINERARY_SERVER_RESULT]", {
                generationId: correlatedGenerationId,
                successDiscriminant: false,
                errorCode: durationFailure.errorCode,
                failureReason: durationFailure.failureReason,
                failedRuleCount: 0,
                tripPresent: false,
                payloadPresent: false,
                transport: "https_api",
              });
              return new Response(JSON.stringify(durationFailure), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
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
          if (isAbuseGuardEnforcementOn()) {
            const fairUse = await authorizeAiUse("itinerary", request, JSON.stringify(payload));
            if (fairUse) return fairUse;
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
            setGenerationPhase("response");
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
            const response = new Response(JSON.stringify(result), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
            emitGenerationDiagnostic("response");
            return response;
          } catch (e) {
            captureGenerationException(e);
            if (
              e instanceof Error &&
              (e.message === "rate_limited" || e.message === "ai_unavailable")
            ) {
              return Response.json(
                { error: e.message },
                {
                  status: e.message === "rate_limited" ? 429 : 503,
                  headers: {
                    "Cache-Control": "no-store",
                    ...(e.message === "rate_limited" ? { "Retry-After": "60" } : {}),
                  },
                },
              );
            }
            const insufficientCredits = isInsufficientCreditsError(e);
            const durationError = isItineraryDurationValidationError(e);
            const classified = durationError
              ? invalidItineraryDurationFailure(Number.NaN)!
              : insufficientCredits
                ? null
                : {
                    success: false as const,
                    errorCode: "generation_unavailable",
                    failureReason: "exception",
                    message: itineraryFailureUserMessage({
                      errorCode: "generation_unavailable",
                      message: e instanceof Error ? e.message : String(e),
                    }),
                  };
            await recordAnalyticsEventServer(
              {
                eventId: analyticsOperationEventId(operationId, "failed"),
                eventName: "itinerary_generation_failed",
                tier: auth.hasPlusAccess ? "plus" : "free",
                failureCode: insufficientCredits
                  ? INSUFFICIENT_CREDITS_ERROR_CODE
                  : durationError
                    ? classified!.errorCode
                    : "server_error",
              },
              auth.userId,
            );
            if (insufficientCredits) {
              return new Response(
                JSON.stringify({
                  error: INSUFFICIENT_CREDITS_ERROR_CODE,
                  requestId: operationId,
                }),
                {
                  status: 402,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            if (durationError && classified) {
              console.info("[ITINERARY_SERVER_RESULT]", {
                generationId:
                  payload && typeof payload === "object" && !Array.isArray(payload)
                    ? ((payload as Record<string, unknown>).generationId ?? operationId)
                    : operationId,
                successDiscriminant: false,
                errorCode: classified.errorCode,
                failureReason: classified.failureReason,
                failedRuleCount: 0,
                tripPresent: false,
                payloadPresent: false,
                transport: "https_api",
              });
              return new Response(JSON.stringify(classified), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            console.info("[ITINERARY_SERVER_RESULT]", {
              generationId:
                payload && typeof payload === "object" && !Array.isArray(payload)
                  ? ((payload as Record<string, unknown>).generationId ?? operationId)
                  : operationId,
              successDiscriminant: false,
              errorCode: "server_error",
              failureReason: "exception",
              failedRuleCount: 0,
              tripPresent: false,
              payloadPresent: false,
              transport: "https_api",
            });
            // The sanitized exception was captured synchronously before analytics/cleanup.
            return new Response(
              JSON.stringify({
                error: "generation_unavailable",
                requestId: operationId,
              }),
              {
                status: 500,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        } catch (error) {
          // Includes auth and analytics failures outside the server-function try block.
          captureGenerationException(error);
          return Response.json(
            { error: "generation_unavailable", requestId: operationId },
            { status: 500 },
          );
        }
      },
    },
  },
});
