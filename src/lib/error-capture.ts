// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

import { logAppError, isBenignWebKitNoise } from "@/lib/log-error";

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

function isEmptyWindowError(event: ErrorEvent): boolean {
  const err = event.error;
  const msg = typeof event.message === "string" ? event.message : "";
  return (
    (err == null || err === "") &&
    (!msg || msg === "Script error.")
  );
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => {
    const errEvent = event as ErrorEvent;
    if (errEvent.target instanceof HTMLScriptElement) return;
    if (isEmptyWindowError(errEvent)) return;
    const err = errEvent.error ?? errEvent.message;
    record(err);
    if (!isBenignWebKitNoise(err, { source: "globalThis.error" })) {
      logAppError("APP_INIT_ERROR", err, {
        source: "globalThis.error",
        filename: errEvent.filename,
        lineno: errEvent.lineno,
        colno: errEvent.colno,
      });
    }
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    record(reason);
    if (!isBenignWebKitNoise(reason, { source: "globalThis.unhandledrejection" })) {
      logAppError("APP_UNHANDLED_REJECTION", reason, {
        source: "globalThis.unhandledrejection",
      });
    }
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
