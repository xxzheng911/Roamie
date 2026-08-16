/** Perf / diagnostic logs for user media loading. */
import { devVerboseInfo } from "@/lib/dev-verbose-log";

const loggedOnce = new Set<string>();

export function logUserMedia(
  tag: string,
  fields: Record<string, string | number | boolean | null | undefined>,
  opts?: { onceKey?: string },
): void {
  if (opts?.onceKey) {
    const key = `${tag}:${opts.onceKey}`;
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
  }
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  if (tag.endsWith("_FAILED") || tag.endsWith("_ERROR")) {
    console.warn(`[${tag}]`, ...parts);
    return;
  }
  devVerboseInfo(`[${tag}]`, ...parts);
}

export function resetUserMediaLogOnce(): void {
  loggedOnce.clear();
}
