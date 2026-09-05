import { parsePartialRoamieJson } from "./parse-partial";
import type { RoamieRequestContext } from "./context";
import { normalizeRoamieResponse, type RoamieResponse as RoamieResponseType } from "./types";
import { apiEndpointDiagnostic, isApiUrlError, resolveApiUrl } from "@/lib/api-url";
async function withResolvedPlanTier(ctx: RoamieRequestContext): Promise<RoamieRequestContext> {
  const { applyTierToAiContext } = await import("@/lib/access/context");
  const { resolveEffectivePlanTierWithProfile } = await import("@/lib/access/resolve");
  const planTier = ctx.planTier ?? (await resolveEffectivePlanTierWithProfile());
  return applyTierToAiContext({ ...ctx, planTier }, planTier);
}

function validateAssembledJson(raw: string): RoamieResponseType {
  const trimmed = raw.trim();
  if (!trimmed) {
    console.error("[AI_REPLY_RESPONSE] empty_body");
    throw new Error("AI 沒有回應，請再試一次。");
  }
  try {
    return normalizeRoamieResponse(JSON.parse(trimmed) as Record<string, unknown>);
  } catch (e) {
    console.error(
      "[AI_REPLY_RESPONSE] parse_error",
      e instanceof Error ? e.message : String(e),
      `length=${trimmed.length}`,
    );
    throw new Error("AI 回應格式錯誤");
  }
}

export type StreamRoamieHandlers = {
  onPartial?: (partial: Partial<RoamieResponseType>) => void;
  onDone?: (full: RoamieResponseType) => void;
  onError?: (message: string) => void;
};

export type ChatStreamFailureCode =
  | "native_api_origin_missing"
  | "native_api_origin_invalid"
  | "network_error"
  | "http_error"
  | "unexpected_content_type"
  | "empty_stream"
  | "stream_parse_error"
  | "stream_aborted"
  | "provider_error";

export class ChatStreamError extends Error {
  constructor(
    readonly code: ChatStreamFailureCode,
    message: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}

function streamFailureMessage(code: ChatStreamFailureCode): string {
  if (code.startsWith("native_api_origin")) return "App 服務位址尚未正確設定。";
  if (code === "stream_aborted") return "AI 回應逾時，請再試一次。";
  if (code === "provider_error") return "AI 服務暫時無法使用。";
  return "AI 沒有回應，請再試一次。";
}

async function notifyStreamCancellation(
  endpoint: string,
  ctx: RoamieRequestContext,
  token: string | undefined,
  requestId: string,
): Promise<void> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Roamie-Request-Id": requestId,
        "X-Roamie-Cancel": "true",
      },
      body: JSON.stringify(ctx),
    });
    console.info("[CHAT_API_CLIENT_CANCEL]", {
      requestId,
      status: response.status,
      acknowledged: response.ok,
    });
  } catch {
    console.info("[CHAT_API_CLIENT_CANCEL]", {
      requestId,
      status: 0,
      acknowledged: false,
    });
  }
}

export async function streamRoamieAI(
  ctx: RoamieRequestContext,
  handlers: StreamRoamieHandlers,
  options?: { token?: string; signal?: AbortSignal; requestId?: string },
): Promise<RoamieResponseType | null> {
  const enriched = await withResolvedPlanTier(ctx);
  const requestId = options?.requestId ?? crypto.randomUUID();
  let endpoint: string;
  try {
    endpoint = resolveApiUrl("/api/roamie");
  } catch (error) {
    const code: ChatStreamFailureCode =
      isApiUrlError(error) && error.code === "native_api_origin_missing"
        ? "native_api_origin_missing"
        : "native_api_origin_invalid";
    throw new ChatStreamError(code, streamFailureMessage(code), undefined, requestId);
  }
  const endpointDiagnostic = apiEndpointDiagnostic(endpoint);
  console.info("[CHAT_API_CLIENT_REQUEST]", {
    requestId,
    transport: endpoint.startsWith("/") ? "web" : "capacitor",
    ...endpointDiagnostic,
    route: "/api/roamie",
  });

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
        "X-Roamie-Request-Id": requestId,
      },
      body: JSON.stringify(enriched),
      signal: options?.signal,
    });
  } catch (error) {
    const aborted = options?.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const code: ChatStreamFailureCode = aborted ? "stream_aborted" : "network_error";
    if (aborted) {
      await notifyStreamCancellation(endpoint, enriched, options?.token, requestId);
    }
    console.info("[CHAT_API_CLIENT_RESPONSE]", {
      requestId, status: 0, ok: false, contentType: "", contentLength: null,
      rawBytesReceived: 0, deltaEventCount: 0, finalEventCount: 0,
      errorEventCount: 0, doneEventCount: 0, failureCode: code,
    });
    throw new ChatStreamError(code, streamFailureMessage(code), undefined, requestId);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  const contentLength = resp.headers.get("content-length");

  if (!resp.ok) {
    let errMsg = "AI 服務暫時無法使用";
    let failureCode = "http_error";
    try {
      const j = (await resp.json()) as { error?: string; code?: string; status?: number };
      console.error("[Roamie AI] stream HTTP error", {
        status: resp.status,
        code: j.code,
        error: j.error,
      });
      if (j.error) errMsg = j.error;
      failureCode = j.code ?? j.error ?? failureCode;
    } catch {
      console.error("[Roamie AI] stream HTTP error", { status: resp.status });
    }
    console.info("[CHAT_API_CLIENT_RESPONSE]", {
      requestId, status: resp.status, ok: false, contentType, contentLength,
      rawBytesReceived: 0, deltaEventCount: 0, finalEventCount: 0,
      errorEventCount: 0, doneEventCount: 0, failureCode,
    });
    handlers.onError?.(errMsg);
    return null;
  }

  if (!contentType.toLowerCase().includes("text/event-stream")) {
    console.info("[CHAT_API_CLIENT_RESPONSE]", {
      requestId, status: resp.status, ok: true, contentType, contentLength,
      rawBytesReceived: 0, deltaEventCount: 0, finalEventCount: 0,
      errorEventCount: 0, doneEventCount: 0, failureCode: "unexpected_content_type",
    });
    throw new ChatStreamError("unexpected_content_type", streamFailureMessage("unexpected_content_type"), resp.status, requestId);
  }
  if (!resp.body) {
    throw new ChatStreamError("empty_stream", streamFailureMessage("empty_stream"), resp.status, requestId);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assembled = "";
  let finalFromServer: RoamieResponseType | null = null;
  let rawBytesReceived = 0;
  let deltaEventCount = 0;
  let finalEventCount = 0;
  let errorEventCount = 0;
  let doneEventCount = 0;
  let parseErrorCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rawBytesReceived += value?.byteLength ?? 0;
      buf += decoder.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, "\n");

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
          errorEventCount += 1;
          try {
            const payload = JSON.parse(data) as { error?: string; code?: string; status?: number };
            console.error("[Roamie AI] stream SSE error", payload);
            handlers.onError?.(payload.error ?? "AI 服務暫時無法使用");
          } catch {
            console.error("[Roamie AI] stream SSE error (unparseable)", data);
            handlers.onError?.("AI 服務暫時無法使用");
          }
          console.info("[CHAT_API_CLIENT_RESPONSE]", {
            requestId, status: resp.status, ok: true, contentType, contentLength,
            rawBytesReceived, deltaEventCount, finalEventCount, errorEventCount,
            doneEventCount, failureCode: "provider_error",
          });
          return null;
        }

        if (eventType === "delta") {
          deltaEventCount += 1;
          try {
            const { delta } = JSON.parse(data) as { delta?: string };
            if (delta) {
              assembled += delta;
              handlers.onPartial?.(parsePartialRoamieJson(assembled));
            }
          } catch {
            parseErrorCount += 1;
          }
        }

        if (eventType === "final") {
          finalEventCount += 1;
          try {
            finalFromServer = normalizeRoamieResponse(JSON.parse(data) as Record<string, unknown>);
          } catch {
            parseErrorCount += 1;
          }
        }
        if (eventType === "done") doneEventCount += 1;
      }
    }
  } catch (error) {
    const aborted =
      options?.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    if (!aborted) throw error;
    await notifyStreamCancellation(endpoint, enriched, options?.token, requestId);
    console.info("[CHAT_API_CLIENT_RESPONSE]", {
      requestId, status: resp.status, ok: false, contentType, contentLength,
      rawBytesReceived, deltaEventCount, finalEventCount, errorEventCount,
      doneEventCount, failureCode: "stream_aborted",
    });
    throw new ChatStreamError(
      "stream_aborted",
      streamFailureMessage("stream_aborted"),
      resp.status,
      requestId,
    );
  }

  const failureCode: ChatStreamFailureCode | undefined =
    !finalFromServer && !assembled.trim()
      ? "empty_stream"
      : parseErrorCount > 0 && !finalFromServer
        ? "stream_parse_error"
        : undefined;
  console.info("[CHAT_API_CLIENT_RESPONSE]", {
    requestId, status: resp.status, ok: true, contentType, contentLength,
    rawBytesReceived, deltaEventCount, finalEventCount, errorEventCount,
    doneEventCount, failureCode,
  });
  if (failureCode) {
    throw new ChatStreamError(failureCode, streamFailureMessage(failureCode), resp.status, requestId);
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
  options?: { token?: string; requestId?: string },
): Promise<RoamieResponseType> {
  const enriched = await withResolvedPlanTier(ctx);
  const resp = await fetch(resolveApiUrl("/api/roamie"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Roamie-Stream": "false",
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      "X-Roamie-Request-Id": options?.requestId ?? crypto.randomUUID(),
    },
    body: JSON.stringify(enriched),
  });

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
