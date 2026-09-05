import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { parseRoamieRequest, streamRoamieAI } from "@/lib/ai/service.server";
import {
  requireAuthenticatedAiRequest,
  reserveServerCredits,
  settleServerCredits,
} from "@/lib/ai/endpoint-guard.server";

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
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
      POST: async ({ request }) => {
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
          const credits = await reserveServerCredits(auth, "PLACE_RECOMMENDATION", request);
          if (credits.response || !credits.reservation) return credits.response!;
          const reservation = credits.reservation;
          request.signal.addEventListener(
            "abort",
            () => void settleServerCredits(auth, reservation, false),
            { once: true },
          );
          const { stream: bodyStream, getAssembled } = streamRoamieAI(ctx);

          (async () => {
            try {
              if (!auth) return;
              const raw = await getAssembled();
              if (!raw.trim() || !lastUser) {
                await settleServerCredits(auth, reservation, false);
                return;
              }
              await settleServerCredits(auth, reservation, true);
              await auth.client.from("chat_messages").insert({
                user_id: auth.userId,
                role: "user",
                content: lastUser.content,
              });
              await auth.client.from("chat_messages").insert({
                user_id: auth.userId,
                role: "assistant",
                content: raw.trim(),
              });
            } catch (e) {
              await settleServerCredits(auth, reservation, false);
              console.error("chat persist failed:", e);
            }
          })();

          return new Response(bodyStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "AI 服務暫時無法使用";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
