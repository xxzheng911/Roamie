import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { callRoamieAI, parseRoamieRequest, streamRoamieAI } from "@/lib/ai/service.server";
import type { RoamieAIErrorDetail } from "@/lib/ai/errors";

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return true;
  try {
    return new URL(request.url).host === new URL(origin).host;
  } catch {
    return false;
  }
}

async function resolveUser(authHeader: string | null) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const client = createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id, client };
}

export const Route = createFileRoute("/api/roamie")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        const auth = await resolveUser(request.headers.get("authorization"));

        if (!stream) {
          try {
            const data = await callRoamieAI(ctx);
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
            const detail = errorDetailFromThrown(e);
            console.error("[Roamie AI] /api/roamie non-stream failed", detail);
            return new Response(JSON.stringify(detail), {
              status: detail.status ?? 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }

        try {
          const { stream: bodyStream, getAssembled } = streamRoamieAI(ctx);

          (async () => {
            try {
              if (!auth) return;
              const raw = await getAssembled();
              if (!raw.trim()) return;
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
              console.error("roamie persist failed:", e);
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
