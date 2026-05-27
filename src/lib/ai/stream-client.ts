import { parsePartialRoamieJson } from "./parse-partial";
import type { RoamieRequestContext } from "./context";
import { normalizeRoamieResponse, type RoamieResponse as RoamieResponseType } from "./types";
import { isLocalhostAppApiUrl, resolveAppApiUrl } from "@/lib/api-base-url";
import { isChatApiUnreachableOnNative } from "@/lib/chat-api-ready";
async function withResolvedPlanTier(ctx: RoamieRequestContext): Promise<RoamieRequestContext> {
  const { applyTierToAiContext } = await import("@/lib/access/context");
  const { resolveEffectivePlanTierWithProfile } = await import("@/lib/access/resolve");
  const planTier = ctx.planTier ?? (await resolveEffectivePlanTierWithProfile());
  return applyTierToAiContext({ ...ctx, planTier }, planTier);
}

function validateAssembledJson(raw: string): RoamieResponseType {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("AI 沒有回應，請再試一次。");
  return normalizeRoamieResponse(JSON.parse(trimmed) as Record<string, unknown>);
}

export type StreamRoamieHandlers = {
  onPartial?: (partial: Partial<RoamieResponseType>) => void;
  onDone?: (full: RoamieResponseType) => void;
  onError?: (message: string) => void;
};

export async function streamRoamieAI(
  ctx: RoamieRequestContext,
  handlers: StreamRoamieHandlers,
  options?: { token?: string; signal?: AbortSignal },
): Promise<RoamieResponseType | null> {
  const enriched = await withResolvedPlanTier(ctx);
  const url = resolveAppApiUrl("/api/roamie");
  console.info("[CHAT_API] stream url=", url);

  if (isChatApiUnreachableOnNative() || isLocalhostAppApiUrl(url)) {
    const msg = "無法連線到 AI 服務（請設定正式 VITE_APP_ORIGIN 後重新 build）。";
    console.warn("[CHAT_API] stream blocked on native", { url });
    handlers.onError?.(msg);
    return null;
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(enriched),
      signal: options?.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CHAT_API] stream network error", { url, msg });
    handlers.onError?.("無法連線到 AI 服務，請確認網路或 VITE_APP_ORIGIN 設定。");
    return null;
  }

  if (!resp.ok || !resp.body) {
    let errMsg = "AI 服務暫時無法使用";
    try {
      const j = (await resp.json()) as { error?: string; code?: string; status?: number };
      console.error("[Roamie AI] stream HTTP error", {
        status: resp.status,
        code: j.code,
        error: j.error,
      });
      if (j.error) errMsg = j.error;
    } catch {
      console.error("[Roamie AI] stream HTTP error", { status: resp.status });
    }
    handlers.onError?.(errMsg);
    return null;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assembled = "";
  let finalFromServer: RoamieResponseType | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let eventEnd: number;
    while ((eventEnd = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, eventEnd);
      buf = buf.slice(eventEnd + 2);

      let eventType = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        if (line.startsWith("data: ")) data = line.slice(6);
      }

      if (eventType === "error") {
        try {
          const payload = JSON.parse(data) as { error?: string; code?: string; status?: number };
          console.error("[Roamie AI] stream SSE error", payload);
          handlers.onError?.(payload.error ?? "AI 服務暫時無法使用");
        } catch {
          console.error("[Roamie AI] stream SSE error (unparseable)", data);
          handlers.onError?.("AI 服務暫時無法使用");
        }
        return null;
      }

      if (eventType === "delta") {
        try {
          const { delta } = JSON.parse(data) as { delta?: string };
          if (delta) {
            assembled += delta;
            handlers.onPartial?.(parsePartialRoamieJson(assembled));
          }
        } catch {
          /* ignore */
        }
      }

      if (eventType === "final") {
        try {
          finalFromServer = normalizeRoamieResponse(JSON.parse(data) as Record<string, unknown>);
        } catch {
          /* ignore */
        }
      }
    }
  }

  try {
    const full = finalFromServer ?? validateAssembledJson(assembled);
    handlers.onDone?.(full);
    return full;
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : "AI 回應格式錯誤");
    return null;
  }
}

/** Non-streaming recommend / itinerary */
export async function fetchRoamieAI(
  ctx: RoamieRequestContext,
  options?: { token?: string },
): Promise<RoamieResponseType> {
  const enriched = await withResolvedPlanTier(ctx);
  const url = resolveAppApiUrl("/api/roamie");
  console.info("[CHAT_API] fetch url=", url);

  if (isChatApiUnreachableOnNative() || isLocalhostAppApiUrl(url)) {
    throw new Error("無法連線到 AI 服務（請設定正式 VITE_APP_ORIGIN 後重新 build）。");
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Roamie-Stream": "false",
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(enriched),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CHAT_API] fetch network error", { url, msg });
    throw new Error("無法連線到 AI 服務，請確認網路或 VITE_APP_ORIGIN 設定。");
  }

  if (!resp.ok) {
    let errMsg = "AI 服務暫時無法使用";
    try {
      const j = (await resp.json()) as { error?: string; code?: string; status?: number };
      console.error("[Roamie AI] fetch HTTP error", {
        status: resp.status,
        code: j.code,
        error: j.error,
      });
      if (j.error) errMsg = j.error;
    } catch {
      console.error("[Roamie AI] fetch HTTP error", { status: resp.status });
    }
    throw new Error(errMsg);
  }

  const json = (await resp.json()) as { data?: RoamieResponseType; error?: string };
  if (json.error) throw new Error(json.error);
  if (!json.data) throw new Error("AI 回應格式錯誤");
  return json.data;
}
