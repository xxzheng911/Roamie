import { isGoogleMapsSdkInternalError } from "@/lib/maps-runtime-diagnostics";
import { detectPlatform } from "@/services/platform";
import { isQaBuildEnabled } from "@/lib/qa-auth/build";

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

/** iOS 26 WebKit / GPU 系統層雜訊 — 不應觸發 App 錯誤 UI */
const WEBKIT_NOISE_PATTERNS: RegExp[] = [
  /sandbox extension/i,
  /system wide server/i,
  /-25204/,
  /carenderserver/i,
  /application environment context/i,
  /device context/i,
  /hide query parameters/i,
  /webprocessproxy/i,
  /didbecomeunresponsive/i,
  /bootstrap lookup/i,
  /xpc_user_sessions_get_foreground_uid/i,
  /xpc_user_sessions/i,
  /_axaddtoelementcache/i,
  /wkaccessibilitywebpageobject/i,
  /makeimageplus/i,
  /'webp'\._reader/i,
  /initimage\[0\] failed err=-50/i,
];

/** WKWebView 有時只提供 lineno/colno，error 與 message 皆為空 */
export function errorFromErrorEvent(event: ErrorEvent): unknown {
  if (event.error != null) return event.error;
  const message = event.message?.trim();
  if (message) return new Error(message);
  const at = `${event.filename || "unknown"}:${event.lineno ?? 0}:${event.colno ?? 0}`;
  return new Error(`runtime error at ${at}`);
}

export function isBenignWebKitNoise(
  error: unknown,
  extra?: Record<string, unknown>,
): boolean {
  const line = formatAppErrorLine("noise", error, extra);
  return WEBKIT_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function isScriptLoadFailure(extra?: Record<string, unknown>): boolean {
  return extra?.script === true;
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
  const eventMessage =
    typeof extra?.eventMessage === "string" ? extra.eventMessage : undefined;
  if (isGoogleMapsSdkInternalError(error, extra, eventMessage)) {
    if (tag === "APP_INIT_ERROR") {
      console.info(
        "[MAP_FALLBACK] suppressed APP_INIT_ERROR (maps_js_noise)",
        extra?.filename ?? "",
        eventMessage ?? "",
      );
    }
    return;
  }
  if (!import.meta.env.DEV && isBenignWebKitNoise(error, extra)) return;
  const s = serializeError(error);
  console.error("[APP_ERROR] source=", tag);
  console.error("[APP_ERROR] message=", s.message);
  console.error("[APP_ERROR] stack=", s.stack ?? s.raw ?? "");
  const line = formatAppErrorLine(tag, error, extra);
  console.error(line);
}

/** 是否應顯示 Capacitor 全屏 fatal overlay（正式版僅 script 載入失敗） */
export function shouldShowCapacitorFatalOverlay(
  error: unknown,
  extra?: Record<string, unknown>,
): boolean {
  if (isBenignWebKitNoise(error, extra) || isGoogleMapsSdkInternalError(error, extra)) {
    return false;
  }
  if (isScriptLoadFailure(extra)) return true;
  return import.meta.env.DEV;
}

let capacitorConsolePatched = false;

/** 將第三方 console.error(obj) 轉成可讀字串（Capacitor 專用） */
export function installCapacitorConsolePatch(): void {
  if (capacitorConsolePatched || typeof window === "undefined") return;
  if (
    !import.meta.env.DEV &&
    !isQaBuildEnabled() &&
    import.meta.env.VITE_DEBUG_DIAGNOSTICS !== "1"
  ) {
    return;
  }
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
  function isMapsSdkNoise(text) {
    if (!text) return false;
    return /sdkError\\.sessionStatus/i.test(text)
      || /Evaluating ['"]?[^'"]*sdkError/i.test(text)
      || /Google Maps JavaScript API error/i.test(text)
      || /InvalidKeyMapError/i.test(text)
      || /RefererNotAllowedMapError/i.test(text);
  }
  function isAmbiguousWebKitUndefined(e, reason) {
    if ((e.message || "") !== "undefined") return false;
    if (e.error != null && reason && reason.message && reason.message !== "undefined") return false;
    var f = e.filename || "";
    if (f.indexOf("maps.googleapis.com") >= 0) return true;
    if (!document.querySelector('script[data-roamie-maps="1"]')) return false;
    return f.indexOf("/assets/index-") >= 0
      || f.indexOf("capacitor://localhost/assets/index-") >= 0;
  }
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
    var reason = e.error;
    if (reason == null) {
      var msg = (e.message || "").trim();
      reason = msg
        ? new Error(msg)
        : new Error(
            "runtime@" + (e.filename || "unknown") + ":" + (e.lineno || 0) + ":" + (e.colno || 0),
          );
    }
    var line = (e.message || "") + " " + (reason && reason.message ? reason.message : "");
    if (isMapsSdkNoise(line) || isAmbiguousWebKitUndefined(e, reason)) {
      try {
        window.__roamieMapsAuthFailure = { message: "Google 地圖無法載入（Maps JS 授權）" };
        console.info("[MAP_FALLBACK] reason=maps_js_sdk_error (early)");
      } catch (_) {}
      return;
    }
    roamieLog("APP_INIT_ERROR", reason, e.filename || "");
  }, true);
  window.addEventListener("unhandledrejection", function(e) {
    var reason = e.reason;
    if (reason == null) reason = new Error("unhandled rejection (reason was undefined)");
    roamieLog("APP_UNHANDLED_REJECTION", reason, "promise");
  });
})();
</script>`;
}
