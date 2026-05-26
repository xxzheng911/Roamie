import { detectPlatform } from "@/services/platform";

export type SerializedError = {
  kind: string;
  message: string;
  name?: string;
  stack?: string;
  cause?: string;
  status?: number;
  code?: string;
  raw?: string;
};

/** WKWebView / Capacitor 常把 Error / 物件參數印成 `{}` */
export function serializeError(error: unknown): SerializedError {
  if (error == null) {
    return { kind: "null", message: "(null)" };
  }

  if (error instanceof Error) {
    return {
      kind: "Error",
      name: error.name,
      message: error.message || "(no message)",
      stack: error.stack,
      cause: error.cause != null ? String(error.cause) : undefined,
    };
  }

  if (typeof error === "string") {
    return { kind: "string", message: error };
  }

  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    const message =
      typeof o.message === "string"
        ? o.message
        : typeof o.error === "string"
          ? o.error
          : typeof o.statusText === "string"
            ? o.statusText
            : undefined;

    if (message) {
      return {
        kind: o.constructor?.name ?? "object",
        message,
        name: typeof o.name === "string" ? o.name : undefined,
        stack: typeof o.stack === "string" ? o.stack : undefined,
        status: typeof o.status === "number" ? o.status : undefined,
        code: typeof o.code === "string" ? o.code : undefined,
        raw: safeJson(error),
      };
    }

    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") {
        return { kind: "object", message: json, raw: json };
      }
    } catch {
      /* fall through */
    }

    return {
      kind: "object",
      message: Object.prototype.toString.call(error),
      raw: safeJson(error),
    };
  }

  return { kind: typeof error, message: String(error) };
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return "";
  try {
    return ` | extra=${JSON.stringify(extra)}`;
  } catch {
    return ` | extra=${String(extra)}`;
  }
}

/** 單一字串行 — Capacitor ⚡️ console 只可靠顯示這個 */
export function formatAppErrorLine(
  tag: string,
  error: unknown,
  extra?: Record<string, unknown>,
): string {
  const s = serializeError(error);
  const platform = typeof window !== "undefined" ? detectPlatform() : null;
  const platformBit = platform
    ? `platform=${platform.kind} native=${platform.isCapacitor}`
    : "platform=ssr";

  const stackPart = s.stack ?? s.raw ?? "";
  return [
    tag,
    s.message,
    s.name ? `(${s.name})` : "",
    stackPart ? `stack=${stackPart}` : "",
    platformBit,
    formatExtra(extra),
  ]
    .filter(Boolean)
    .join(" ");
}

/** 是否在錯誤 UI 顯示技術細節（Xcode 真機除錯） */
export function shouldShowErrorDetail(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  return detectPlatform().isCapacitor;
}

export function formatErrorDetail(error: unknown): string | null {
  if (!shouldShowErrorDetail()) return null;
  const s = serializeError(error);
  const parts = [s.message];
  if (s.stack) parts.push(s.stack);
  else if (s.raw && s.raw !== s.message) parts.push(s.raw);
  return parts.filter(Boolean).join("\n\n");
}

/**
 * Capacitor iOS 的 `⚡️ [error] - {}` 來自 console.error 的最後一個物件參數。
 * 一律輸出單一字串，勿傳 Error / plain object。
 */
export function logAppError(tag: string, error: unknown, extra?: Record<string, unknown>): void {
  const line = formatAppErrorLine(tag, error, extra);
  console.error(line);
}

let capacitorConsolePatched = false;

/** 將第三方 console.error(obj) 轉成可讀字串（Capacitor 專用） */
export function installCapacitorConsolePatch(): void {
  if (capacitorConsolePatched || typeof window === "undefined") return;
  const { isCapacitor } = detectPlatform();
  if (!isCapacitor) return;
  capacitorConsolePatched = true;

  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  const flatten = (args: unknown[]): string =>
    args
      .map((arg) => {
        if (arg == null) return String(arg);
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) {
          return [arg.name, arg.message, arg.stack].filter(Boolean).join(" ");
        }
        if (typeof arg === "object") {
          const json = safeJson(arg);
          if (json && json !== "{}") return json;
          return Object.prototype.toString.call(arg);
        }
        return String(arg);
      })
      .join(" | ");

  console.error = (...args: unknown[]) => {
    origError(flatten(args));
  };
  console.warn = (...args: unknown[]) => {
    origWarn(flatten(args));
  };
}

/** 給 capacitor-prepare / index.html 內嵌 script 用（與 TS 邏輯同步） */
export function buildCapacitorEarlyErrorLogScript(): string {
  return `<script>
(function(){
  function roamieLog(tag, reason, source) {
    var msg = "(unknown)";
    var stack = "";
    if (reason instanceof Error) {
      msg = reason.message || String(reason);
      stack = reason.stack || "";
    } else if (reason && typeof reason === "object" && reason.message) {
      msg = String(reason.message);
      stack = reason.stack ? String(reason.stack) : "";
    } else if (reason != null) {
      msg = String(reason);
    }
    try {
      console.error(tag + " " + msg + (stack ? " stack=" + stack : "") + (source ? " source=" + source : ""));
    } catch (_) {}
  }
  window.addEventListener("error", function(e) {
    if (e.target && e.target.tagName === "SCRIPT") {
      roamieLog("APP_SCRIPT_LOAD_ERROR", e.message || "script failed", e.filename || "script");
      return;
    }
    roamieLog("APP_INIT_ERROR", e.error || e.message, e.filename);
  }, true);
  window.addEventListener("unhandledrejection", function(e) {
    roamieLog("APP_UNHANDLED_REJECTION", e.reason, "promise");
  });
})();
</script>`;
}
