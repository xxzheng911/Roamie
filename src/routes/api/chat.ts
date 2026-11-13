import { encodeGeneratedChatContent } from "@/lib/generated-locale";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { parseRoamieRequest, streamRoamieAI } from "@/lib/ai/service.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import {
  beginAiRequest,
  createServerCreditSettlement,
  requireAuthenticatedAiRequest,
  reserveServerCredits,
} from "@/lib/ai/endpoint-guard.server";
import { checkRateLimit, SECURITY_RATE_LIMITS } from "@/lib/rate-limit.server";
import { waitUntilFromContext } from "@/lib/server-request-context";

const BodySchema = z.object({
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40)
    // Rejected (400) before any credit reservation: a chat turn needs a user message.
    .refine((messages) => messages.some((m) => m.role === "user")),
  preferences: z.record(z.unknown()).optional(),
  mood: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number(), city: z.string().optional() }).optional(),
  weather: z.record(z.unknown()).nullable().optional(),
  time: z.string().optional(),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true;
  try {
    return new URL(request.url).host === new URL(origin).host;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        if (!isAllowedOrigin(request)) {
          return new Response(JSON.stringify({ error: "Forbidden" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid request" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
        const ctx = parseRoamieRequest({
          mode: "chat",
          locale: body.locale,
          messages: body.messages,
          chatInput: lastUser?.content,
          preferences: body.preferences,
          mood: body.mood,
          location: body.location,
          weather: body.weather,
          time: body.time ?? new Date().toISOString(),
        });

        try {
          const auth = await requireAuthenticatedAiRequest(request);
          if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
          const credits = isAbuseGuardEnforcementOn()
            ? await beginAiRequest(
                auth,
                "PLACE_RECOMMENDATION",
                "chat",
                request,
                JSON.stringify(body),
              )
            : await (async () => {
                const rate = checkRateLimit(
                  `chat:${auth.userId}:minute`,
                  SECURITY_RATE_LIMITS.chatPerMinute,
                  60_000,
                );
                if (!rate.allowed) {
                  return {
                    reservation: null,
                    response: Response.json(
                      { error: "rate_limited" },
                      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
                    ),
                  };
                }
                return reserveServerCredits(auth, "PLACE_RECOMMENDATION", request);
              })();
          if (credits.response || !credits.reservation) return credits.response!;
          // Settlement RPCs survive a disconnect via ctx.waitUntil.
          const credit = createServerCreditSettlement(auth, credits.reservation, (p) =>
            waitUntilFromContext(context, p),
          );
          // Rule A': before the first content delta (and before the provider
          // finished): refund. After either: content was delivered, commit.
          request.signal.addEventListener("abort", credit.onClientAbort, { once: true });
          // Disconnected while the reservation was pending: the abort event already
          // fired and is not replayed. Release now and do not start generation.
          if (request.signal.aborted) {
            // Provider never started: await the release before responding so the
            // Worker does not drop the pending rollback after the 499 is sent.
            await credit.settle(false);
            return Response.json({ error: "client_closed_request" }, { status: 499 });
          }
          const { stream: bodyStream } = streamRoamieAI(ctx, {
            // Disconnect before the provider finished stops generation (refund
            // unless content was already sent); after it finished, still commits.
            signal: request.signal,
            onProviderComplete: credit.markProviderFinished,
            onFirstContentDelta: credit.markContentDelivered,
            // Runs before final/done: a failed commit withholds the result
            // (service.server sends an error event instead).
            onComplete: async ({ assembled: raw, success, clientAbortedAfterContent }) => {
              // Rule A': disconnected after content was sent → charge, persist nothing.
              if (clientAbortedAfterContent) {
                await credit.settle(true);
                return false;
              }
              // Rule A': provider/server failure (or nothing generated) → refund,
              // unless the provider succeeded and content already reached the client.
              const delivered = success && credit.hasDeliveredContent();
              if (!delivered && (!success || !raw.trim())) {
                await credit.settle(false);
                return false;
              }
              if (!(await credit.settle(true))) return false;
              // lastUser only decides persistence, never the refund.
              if (!lastUser || !raw.trim()) return true;
              try {
                await auth.client.from("chat_messages").insert({
                  user_id: auth.userId,
                  role: "user",
                  content: lastUser.content,
                });
                await auth.client.from("chat_messages").insert({
                  user_id: auth.userId,
                  role: "assistant",
                  content: encodeGeneratedChatContent(raw.trim(), ctx.locale ?? "zh-TW"),
                });
              } catch (e) {
                // Already charged: persistence problems never withhold the result.
                console.error("chat persist failed:", e);
              }
              return true;
            },
          });

          return new Response(bodyStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        } catch (e) {
          const requestId =
            request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
          console.error("[CHAT_API_ERROR]", {
            requestId,
            error: e instanceof Error ? e.message : "unknown_error",
          });
          return new Response(JSON.stringify({ error: "service_unavailable", requestId }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
