import { parsePartialRoamieJson } from "./parse-partial";
import type { RoamieRequestContext } from "./context";
import { normalizeRoamieResponse, type RoamieResponse as RoamieResponseType } from "./types";

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
  const resp = await fetch("/api/roamie", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify(ctx),
    signal: options?.signal,
  });

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
    }
  }

  try {
    const full = validateAssembledJson(assembled);
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
  const resp = await fetch("/api/roamie", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Roamie-Stream": "false",
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify(ctx),
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
