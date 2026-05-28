// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

import { isGoogleMapsSdkInternalError } from "@/lib/maps-runtime-diagnostics";
import { logAppError, isBenignWebKitNoise } from "@/lib/log-error";

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => {
    const ev = event as ErrorEvent;
    const err = ev.error ?? ev.message;
    const eventMessage = ev.message?.trim() ?? "";
    record(err);
    if (
      isGoogleMapsSdkInternalError(
        err,
        { source: "globalThis.error", eventMessage, filename: ev.filename },
        eventMessage,
      )
    ) {
      return;
    }
    if (!isBenignWebKitNoise(err, { source: "globalThis.error" })) {
      logAppError("APP_INIT_ERROR", err, { source: "globalThis.error" });
    }
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    record(reason);
    if (isGoogleMapsSdkInternalError(reason, { source: "globalThis.unhandledrejection" })) {
      return;
    }
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
