export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** True only for offline / fetch failure / transport-level errors — not logic or empty AI replies. */
export function isNetworkFailureError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;

  const msg = errorMessage(error);
  const name = error instanceof Error ? error.name : "";

  if (name === "ReferenceError" || name === "SyntaxError") return false;
  if (/before initialization/i.test(msg)) return false;
  if (/AI 沒有回應|AI 回應格式錯誤|AI 服務暫時無法使用/.test(msg)) return false;

  const lower = msg.toLowerCase();
  return (
    /fetch failed/i.test(msg) ||
    /failed to fetch/i.test(lower) ||
    /network error/i.test(lower) ||
    /networkrequestfailed/i.test(lower) ||
    /load failed/i.test(lower) ||
    /econnrefused|enotfound|etimedout|enetunreach/i.test(lower) ||
    (name === "TypeError" && /fetch|network|load failed/i.test(msg))
  );
}

export function isProgrammaticError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const msg = errorMessage(error);
  return (
    name === "ReferenceError" ||
    name === "SyntaxError" ||
    /before initialization/i.test(msg) ||
    /cannot access '.+' before initialization/i.test(msg)
  );
}

/** Explore map search — never expose minified ReferenceError text to users. */
export function resolveExploreSearchUserMessage(
  error: unknown,
  searchFailedLabel: string,
  networkFailedLabel?: string,
): string {
  if (isNetworkFailureError(error)) {
    return networkFailedLabel ?? searchFailedLabel;
  }
  if (isProgrammaticError(error)) {
    return searchFailedLabel;
  }
  const msg = errorMessage(error);
  if (/AI 沒有回應|請再試一次/.test(msg)) return msg;
  if (/cannot access|referenceerror|before initialization/i.test(msg)) {
    return searchFailedLabel;
  }
  return searchFailedLabel;
}

/** Chat final fallback when local planning fallback also fails. */
export function resolveChatConnectionFallbackMessage(error: unknown): string {
  if (isNetworkFailureError(error)) {
    return "我這邊連線有點不穩，但我還記得你的行程需求，可以再說一次想調整什麼。";
  }
  const msg = errorMessage(error);
  if (msg.includes("AI 沒有回應")) return msg;
  if (msg.includes("AI 回應格式錯誤")) return msg;
  if (msg.includes("AI 服務暫時無法使用")) return msg;
  return "目前無法完成回覆，請稍後再試。";
}
