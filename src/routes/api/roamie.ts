import { createFileRoute } from "@tanstack/react-router";
import { callRoamieAI, parseRoamieRequest, streamRoamieAI } from "@/lib/ai/service.server";
import { applyTierToAiContext } from "@/lib/access/context";
import type { RoamieAIErrorDetail } from "@/lib/ai/errors";
import { AI_RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit.server";
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
    const parsed = new URL(origin);
    if (parsed.protocol === "capacitor:" && parsed.hostname === "localhost") return true;
    return new URL(request.url).host === parsed.host;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/roamie")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const operationId =
          request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
        if (!isAllowedOrigin(request)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        let ctx;
        try {
          ctx = parseRoamieRequest(body);
        } catch {
          return new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const stream = request.headers.get("X-Roamie-Stream") !== "false";
        const auth = await requireAuthenticatedAiRequest(request);
        if (!auth) {
          console.info("[CHAT_API_REQUEST]", { requestId: operationId, authenticated: false, tier: "unknown", route: "/api/roamie" });
          return Response.json({ error: "Unauthorized", code: "auth_failed" }, { status: 401 });
        }
        const tier = auth.hasPlusAccess ? "plus" : "free";
        console.info("[CHAT_API_REQUEST]", { requestId: operationId, authenticated: true, tier, route: "/api/roamie" });
        ctx = applyTierToAiContext(ctx, tier);

        const rateKey = auth?.userId ?? request.headers.get("cf-connecting-ip") ?? "anon";
        const minuteLimit = checkRateLimit(
          `ai:${rateKey}:min`,
          AI_RATE_LIMITS.chatPerMinute,
          60_000,
        );
        if (!minuteLimit.allowed) {
          return new Response(
            JSON.stringify({
              error: "Too many requests",
              retryAfterSec: minuteLimit.retryAfterSec,
            }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          );
        }
        const credits = await reserveServerCredits(
          auth,
          ctx.mode === "itinerary" ? "ITINERARY_GENERATION" : "PLACE_RECOMMENDATION",
          request,
        );
        if (credits.response || !credits.reservation) {
          console.info("[CHAT_CREDIT_LIFECYCLE]", { requestId: operationId, tier, reserved: false, committed: false, rolledBack: false, failureReason: "reservation_rejected" });
          return credits.response!;
        }
        const reservation = credits.reservation;
        let creditSettled = false;
        const settleCredits = async (success: boolean, failureReason = "") => {
          if (creditSettled) return;
          creditSettled = true;
          await settleServerCredits(auth, reservation, success);
          console.info("[CHAT_CREDIT_LIFECYCLE]", {
            requestId: operationId,
            tier,
            reserved: !reservation.skipped,
            committed: success && !reservation.skipped,
            rolledBack: !success && !reservation.skipped,
            failureReason,
          });
        };
        console.info("[CHAT_CREDIT_LIFECYCLE]", { requestId: operationId, tier, reserved: !reservation.skipped, committed: false, rolledBack: false, failureReason: "" });
        if (ctx.mode === "itinerary") {
          await recordAnalyticsEventServer(
            {
              eventId: analyticsOperationEventId(operationId, "started"),
              eventName: "itinerary_generation_started",
              tier,
            },
            auth.userId,
          );
        }
        request.signal.addEventListener(
          "abort",
          () => void settleCredits(false, "client_abort"),
          { once: true },
        );

        if (!stream) {
          try {
            const data = await callRoamieAI(ctx);
            await settleCredits(true);
            await recordAnalyticsEventServer(
              {
                eventId: analyticsOperationEventId(
                  operationId,
                  ctx.mode === "itinerary" ? "succeeded" : "surfaced",
                ),
                eventName:
                  ctx.mode === "itinerary"
                    ? "itinerary_generation_succeeded"
                    : "recommendation_surfaced",
                tier,
              },
              auth.userId,
            );
            if (auth && ctx.chatInput?.trim()) {
              await auth.client.from("chat_messages").insert({
                user_id: auth.userId,
                role: "user",
                content: ctx.chatInput.trim(),
              });
              await auth.client.from("chat_messages").insert({
                user_id: auth.userId,
                role: "assistant",
                content: JSON.stringify(data),
              });
            }
            return new Response(JSON.stringify({ data }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          } catch (e) {
            await settleCredits(false, "server_error");
            if (ctx.mode === "itinerary")
              await recordAnalyticsEventServer(
                {
                  eventId: analyticsOperationEventId(operationId, "failed"),
                  eventName: "itinerary_generation_failed",
                  tier,
                  failureCode: "server_error",
                },
                auth.userId,
              );
            const detail = errorDetailFromThrown(e);
            console.error("[Roamie AI] /api/roamie non-stream failed", detail);
            return new Response(JSON.stringify(detail), {
              status: detail.status ?? 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        try {
          const { stream: bodyStream, getAssembled } = streamRoamieAI(ctx, {
            signal: request.signal,
            requestId: operationId,
          });

          (async () => {
            try {
              if (!auth) return;
              const raw = await getAssembled();
              if (!raw.trim()) {
                await settleCredits(false, "empty_response");
                if (ctx.mode === "itinerary")
                  await recordAnalyticsEventServer(
                    {
                      eventId: analyticsOperationEventId(operationId, "failed"),
                      eventName: "itinerary_generation_failed",
                      tier,
                      failureCode: "empty_response",
                    },
                    auth.userId,
                  );
                return;
              }
              await settleCredits(true);
              await recordAnalyticsEventServer(
                {
                  eventId: analyticsOperationEventId(
                    operationId,
                    ctx.mode === "itinerary" ? "succeeded" : "surfaced",
                  ),
                  eventName:
                    ctx.mode === "itinerary"
                      ? "itinerary_generation_succeeded"
                      : "recommendation_surfaced",
                  tier,
                },
                auth.userId,
              );
              const lastUser =
                ctx.chatInput?.trim() ||
                [...(ctx.messages ?? [])].reverse().find((m) => m.role === "user")?.content;
              if (lastUser) {
                await auth.client.from("chat_messages").insert({
                  user_id: auth.userId,
                  role: "user",
                  content: lastUser,
                });
              }
              await auth.client.from("chat_messages").insert({
                user_id: auth.userId,
                role: "assistant",
                content: raw.trim(),
              });
            } catch (e) {
              await settleCredits(false, "stream_failed");
              if (ctx.mode === "itinerary")
                await recordAnalyticsEventServer(
                  {
                    eventId: analyticsOperationEventId(operationId, "failed"),
                    eventName: "itinerary_generation_failed",
                    tier,
                    failureCode: "stream_failed",
                  },
                  auth.userId,
                );
              console.error("roamie persist failed:", e);
            }
          })();

          return new Response(bodyStream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        } catch (e) {
          await settleCredits(false, "stream_setup_failed");
          if (ctx.mode === "itinerary")
            await recordAnalyticsEventServer(
              {
                eventId: analyticsOperationEventId(operationId, "failed"),
                eventName: "itinerary_generation_failed",
                tier,
                failureCode: "stream_setup_failed",
              },
              auth.userId,
            );
          const detail = errorDetailFromThrown(e);
          console.error("[Roamie AI] /api/roamie stream setup failed", detail);
          return new Response(JSON.stringify(detail), {
            status: detail.status ?? 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

function errorDetailFromThrown(e: unknown): RoamieAIErrorDetail & { error: string } {
  if (e instanceof Error) {
    const roamie = (e as Error & { roamie?: RoamieAIErrorDetail }).roamie;
    if (roamie) return { ...roamie, error: roamie.message };
    return { error: e.message, message: e.message };
  }
  return { error: "AI 服務暫時無法使用", message: "AI 服務暫時無法使用" };
}
