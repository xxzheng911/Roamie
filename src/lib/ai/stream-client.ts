import { CapacitorHttp } from "@capacitor/core";
import { parsePartialRoamieJson } from "./parse-partial";
import type { RoamieRequestContext } from "./context";
import { normalizeRoamieResponse, type RoamieResponse as RoamieResponseType } from "./types";
import { isLocalhostAppApiUrl, resolveAppApiUrl } from "@/lib/api-base-url";
import { isChatApiUnreachableOnNative } from "@/lib/chat-api-ready";
import { detectPlatform } from "@/services/platform";

function isNativeCapacitorShell(): boolean {
  if (typeof window === "undefined") return false;
  return (
    detectPlatform().isCapacitor ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "ionic:"
  );
}

async function postRoamieApi(
  url: string,
  body: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  if (isNativeCapacitorShell()) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: JSON.parse(body) as Record<string, unknown>,
      connectTimeout: 60_000,
      readTimeout: 60_000,
    });
    const bodyText =
      typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? {});
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      bodyText,
    };
  }

  const resp = await fetch(url, { method: "POST", headers, body, signal });
  const bodyText = await resp.text();
  return { ok: resp.ok, status: resp.status, bodyText };
}
async function withResolvedPlanTier(ctx: RoamieRequestContext): Promise<RoamieRequestContext> {
  const { applyTierToAiContext } = await import("@/lib/access/context");
  const { resolveEffectivePlanTierWithProfile } = await import("@/lib/access/resolve");
  const planTier = ctx.planTier ?? (await resolveEffectivePlanTierWithProfile());
  return applyTierToAiContext({ ...ctx, planTier }, planTier);
}

/** 避免 initialChatContext 過大導致 JSON.stringify stack overflow */
function serializeRoamieRequest(ctx: RoamieRequestContext): string {
  const slim: RoamieRequestContext = {
    ...ctx,
    initialChatContext: ctx.initialChatContext?.slice(0, 4000),
    planningHints: ctx.planningHints
      ? {
          ...ctx.planningHints,
          initialChatContext: ctx.planningHints.initialChatContext?.slice(0, 1200),
          conversationSummary: ctx.planningHints.conversationSummary?.slice(0, 800),
        }
      : undefined,
    messages: ctx.messages?.slice(-12),
    selectedPlaces: ctx.selectedPlaces?.slice(0, 12),
    plannedStops: ctx.plannedStops?.slice(0, 12),
    recommendedPlaces: ctx.recommendedPlaces?.slice(0, 8),
    recentRecommendationNames: ctx.recentRecommendationNames?.slice(0, 12),
    savedPlaceNames: ctx.savedPlaceNames?.slice(0, 20),
  };
  try {
    return JSON.stringify(slim);
  } catch (e) {
    console.warn("[CHAT_API] request serialize retry with minimal payload", e);
    return JSON.stringify({
      mode: slim.mode,
      mood: slim.mood,
      locale: slim.locale,
      chatInput: slim.chatInput,
      chatPhase: slim.chatPhase,
      aiUserIntent: slim.aiUserIntent,
      messages: slim.messages?.slice(-6),
      location: slim.location,
      weather: slim.weather,
      time: slim.time,
      planTier: slim.planTier,
    });
  }
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

  let status: number;
  let bodyText: string;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    };
    const posted = await postRoamieApi(url, serializeRoamieRequest(enriched), headers, options?.signal);
    status = posted.status;
    bodyText = posted.bodyText;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CHAT_API] stream network error", { url, msg });
    handlers.onError?.("無法連線到 AI 服務，請確認網路或 VITE_APP_ORIGIN 設定。");
    return null;
  }

  if (status < 200 || status >= 300) {
    let errMsg = "AI 服務暫時無法使用";
    try {
      const j = JSON.parse(bodyText) as { error?: string; code?: string; status?: number };
      console.error("[Roamie AI] stream HTTP error", {
        status,
        code: j.code,
        error: j.error,
      });
      if (j.error) errMsg = j.error;
    } catch {
      console.error("[Roamie AI] stream HTTP error", { status });
    }
    handlers.onError?.(errMsg);
    return null;
  }

  const reader = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bodyText));
      controller.close();
    },
  }).getReader();
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
  console.info("[CHAT_API_REQUEST]", { url, mode: enriched.mode, chatPhase: enriched.chatPhase });

  if (isChatApiUnreachableOnNative() || isLocalhostAppApiUrl(url)) {
    throw new Error("無法連線到 AI 服務（請設定正式 VITE_APP_ORIGIN 後重新 build）。");
  }

  let status: number;
  let bodyText: string;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Roamie-Stream": "false",
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    };
    const posted = await postRoamieApi(url, serializeRoamieRequest(enriched), headers);
    status = posted.status;
    bodyText = posted.bodyText;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CHAT_API] fetch network error", { url, msg });
    throw new Error("無法連線到 AI 服務，請確認網路或 VITE_APP_ORIGIN 設定。");
  }

  if (status < 200 || status >= 300) {
    let errMsg = "AI 服務暫時無法使用";
    try {
      const j = JSON.parse(bodyText) as { error?: string; code?: string; status?: number };
      console.error("[CHAT_API_ERROR]", {
        status,
        code: j.code,
        error: j.error,
      });
      if (j.error) errMsg = j.error;
    } catch {
      console.error("[CHAT_API_ERROR]", { status, body: bodyText.slice(0, 200) });
    }
    throw new Error(errMsg);
  }

  const json = JSON.parse(bodyText) as { data?: RoamieResponseType; error?: string };
  if (json.error) {
    console.error("[CHAT_API_ERROR]", { error: json.error });
    throw new Error(json.error);
  }
  if (!json.data) {
    console.error("[CHAT_API_ERROR]", { error: "empty_data" });
    throw new Error("AI 回應格式錯誤");
  }
  console.info("[CHAT_API_RESPONSE]", {
    summaryLen: json.data.summary?.length ?? 0,
    recommendations: json.data.recommendations?.length ?? 0,
  });
  return json.data;
}
