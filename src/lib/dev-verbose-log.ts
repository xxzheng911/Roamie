import { isDebugDiagnosticsEnabled } from "@/lib/debug-flags";

/**
 * Verbose chat / places / AI pipeline tracing.
 * Default off — set VITE_VERBOSE_LOG=1 (or VITE_DEBUG_DIAGNOSTICS=1) to enable in Xcode console.
 */
export function isDevVerboseLog(): boolean {
  return import.meta.env.VITE_VERBOSE_LOG === "1" || isDebugDiagnosticsEnabled();
}

export function devVerboseInfo(...args: unknown[]): void {
  if (!isDevVerboseLog()) return;
  console.info(...args);
}

export function devVerboseWarn(...args: unknown[]): void {
  if (!isDevVerboseLog()) return;
  console.warn(...args);
}
