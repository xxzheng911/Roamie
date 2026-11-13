import { encodeGeneratedChatContent } from "@/lib/generated-locale";
import { createFileRoute } from "@tanstack/react-router";
import { callRoamieAI, parseRoamieRequest, streamRoamieAI } from "@/lib/ai/service.server";
import { applyTierToAiContext } from "@/lib/access/context";
import type { RoamieAIErrorDetail } from "@/lib/ai/errors";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { aiSurfaceForMode } from "@/lib/abuse-guard-policy";
import {
  beginAiRequest,
  requireAuthenticatedAiRequest,
  reserveServerCredits,
  settleServerCredits,
} from "@/lib/ai/endpoint-guard.server";
import { AI_RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit.server";
import { analyticsOperationEventId } from "@/lib/analytics/events";
import { recordAnalyticsEventServer } from "@/lib/analytics/record.server";
import { waitUntilFromContext } from "@/lib/server-request-context";

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
      POST: async ({ request, context }) => {
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
        const featureType =
          ctx.mode === "itinerary" ? "ITINERARY_GENERATION" : "PLACE_RECOMMENDATION";

        // Cancel notice only: never refunds (the original stream settles its own
        // reservation) and never falls through to a full generation.
        if (request.headers.get("x-roamie-cancel") === "true") {
          console.info("[CHAT_CREDIT_LIFECYCLE]", {
            requestId: operationId,
            tier,
            featureType,
            reserved: false,
            committed: false,
            rolledBack: false,
            failureReason: "client_abort_notice",
          });
          return new Response(null, { status: 204 });
        }

        const credits = isAbuseGuardEnforcementOn()
          ? await beginAiRequest(
              auth,
              featureType,
              aiSurfaceForMode(ctx.mode),
              request,
              JSON.stringify(body),
            )
          : await (async () => {
              const rateKey = auth?.userId ?? request.headers.get("cf-connecting-ip") ?? "anon";
              const minuteLimit = checkRateLimit(
                `ai:${rateKey}:min`,
                AI_RATE_LIMITS.chatPerMinute,
                60_000,
              );
              if (!minuteLimit.allowed) {
                return {
                  reservation: null,
                  response: new Response(
                    JSON.stringify({
                      error: "Too many requests",
                      retryAfterSec: minuteLimit.retryAfterSec,
                    }),
                    { status: 429, headers: { "Content-Type": "application/json" } },
                  ),
                };
              }
              return reserveServerCredits(auth, featureType, request);
            })();
        if (credits.response || !credits.reservation) {
          console.info("[CHAT_CREDIT_LIFECYCLE]", { requestId: operationId, tier, reserved: false, committed: false, rolledBack: false, failureReason: "reservation_rejected" });
          return credits.response!;
        }
        const reservation = credits.reservation;
        /** First settlement wins; later calls reuse it. */
        let settlement: { success: boolean; result: Promise<boolean> } | null = null;
        /** Set once the provider produced the full answer (abort then commits). */
        let providerFinished = false;
        /** Rule A': set once the first content delta reached the client (abort then commits). */
        let contentDelivered = false;
        const runCommit = async (): Promise<boolean> => {
          let settled = await settleServerCredits(auth, reservation, true);
          // rpc_error: the DB may already have charged; commit is idempotent, retry once.
          if (!settled.ok && settled.reason === "rpc_error") {
            settled = await settleServerCredits(auth, reservation, true);
          }
          let releaseFailure = "";
          if (!settled.ok && settled.reason === "rpc_error") {
            // Outcome unknown after two RPC errors: release the hold instead of
            // leaving it for the 5-minute auto-release. Safe against double refund
            // / double charge: rollback of a committed row returns already_committed
            // (no refund), of a rolled_back row is idempotent; commit is idempotent.
            // (ok:false from credits_commit only means not_found: nothing to release.)
            const released = await settleServerCredits(auth, reservation, false);
            if (!released.ok) releaseFailure = `;rollback_failed:${released.reason}`;
          }
          console.info("[CHAT_CREDIT_LIFECYCLE]", {
            requestId: operationId,
            tier,
            reserved: !reservation.skipped,
            committed: settled.ok && !reservation.skipped,
            rolledBack: false,
            failureReason: settled.ok ? "" : `commit_failed:${settled.reason}${releaseFailure}`,
          });
          return settled.ok;
        };
        const runRollback = async (failureReason: string): Promise<boolean> => {
          const settled = await settleServerCredits(auth, reservation, false);
          console.info("[CHAT_CREDIT_LIFECYCLE]", {
            requestId: operationId,
            tier,
            reserved: !reservation.skipped,
            committed: false,
            rolledBack: settled.ok && !reservation.skipped,
            failureReason: settled.ok ? failureReason : `rollback_failed:${settled.reason}`,
          });
          return true;
        };
        /**
         * success=true resolves false when the commit failed (result must not be
         * delivered or persisted), or when the reservation was already released.
         */
        const settleCredits = (success: boolean, failureReason = ""): Promise<boolean> => {
          if (settlement) {
            // Wait for the in-flight settlement instead of resolving early.
            if (!success) return settlement.result.then(() => true);
            return settlement.success ? settlement.result : Promise.resolve(false);
          }
          settlement = {
            success,
            result: success ? runCommit() : runRollback(failureReason),
          };
          // Survives a client disconnect / response end (Workers ctx.waitUntil).
          waitUntilFromContext(context, settlement.result);
          return settlement.result;
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
          // After the provider finished, or once the first content delta was sent
          // (rule A'), the client holds content: a disconnect commits, not refunds.
          () =>
            void (providerFinished || contentDelivered
              ? settleCredits(true)
              : settleCredits(false, "client_abort")),
          { once: true },
        );
        // Disconnected while the reservation / analytics was pending: the abort
        // event already fired and is not replayed. Release now, do not generate.
        if (request.signal.aborted) {
          await settleCredits(false, "client_abort");
          return Response.json({ error: "client_closed_request" }, { status: 499 });
        }

        if (!stream) {
          try {
            const data = await callRoamieAI(ctx, {
              signal: request.signal,
              // Before merge / enrichment: a disconnect from here on commits.
              onProviderComplete: () => {
                providerFinished = true;
              },
            });
            providerFinished = true;
            // A rejected commit is a failure: the result is not delivered.
            if (!(await settleCredits(true))) throw new Error("AI 服務暫時無法使用");
            try {
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
                  content: encodeGeneratedChatContent(JSON.stringify(data), ctx.locale ?? "zh-TW"),
                });
              }
            } catch (error) {
              // Already charged (same rule as the stream path): analytics /
              // persistence problems never withhold the result.
              console.error(
                "[CHAT_NONSTREAM_PERSIST] failed",
                error instanceof Error ? error.message : "unknown_error",
              );
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
          const { stream: bodyStream } = streamRoamieAI(ctx, {
            signal: request.signal,
            requestId: operationId,
            onProviderComplete: () => {
              providerFinished = true;
            },
            onFirstContentDelta: () => {
              contentDelivered = true;
            },
            onComplete: async ({ assembled: raw, success, failureReason, clientAbortedAfterContent }) => {
              if (!success || !raw.trim()) {
                const resolvedFailure = failureReason || "empty_response";
                // Rule A': disconnected after content was sent → charge, persist nothing.
                if (clientAbortedAfterContent) await settleCredits(true);
                else await settleCredits(false, resolvedFailure);
                if (ctx.mode === "itinerary")
                  await recordAnalyticsEventServer(
                    {
                      eventId: analyticsOperationEventId(operationId, "failed"),
                      eventName: "itinerary_generation_failed",
                      tier,
                      failureCode: resolvedFailure,
                    },
                    auth.userId,
                  );
                return false;
              }
              // Commit before final/done: a failed commit withholds the result.
              if (!(await settleCredits(true))) {
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
                return false;
              }
              try {
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
                  content: encodeGeneratedChatContent(raw.trim(), ctx.locale ?? "zh-TW"),
                });
              } catch (error) {
                // Already charged: persistence problems never withhold the result.
                console.error(
                  "[CHAT_STREAM_PERSIST] failed",
                  error instanceof Error ? error.message : "unknown_error",
                );
              }
              return true;
            },
          });

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
