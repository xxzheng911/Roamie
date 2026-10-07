import { isDevVerboseLog } from "@/lib/dev-verbose-log";
import { shouldLogDirectionsDebug } from "@/lib/directions-debug-log";

const loggedOnce = new Set<string>();

/** Preserve failure diagnostics even when their caller historically used info/debug. */
function shouldLogClientRouteMessage(message: string): boolean {
  return typeof window === "undefined" || isDevVerboseLog() ||
    /error|fail|unavailable|exception|fallback|zero_results|not_found|denied|invalid|429|503|TRANSIT_JAPAN_MAPS|http_status=(?:0\b|[45]\d\d)|body_status=(?!OK(?:\s|$))/i.test(
      message.replace(/error_message=none/g, ""),
    );
}

export function logRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug() || !shouldLogClientRouteMessage(message)) return;
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.info(message);
}

/** Debug-level once log (same gate as info; not warn). */
export function debugRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug() || !shouldLogClientRouteMessage(message)) return;
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.debug(message);
}

export function warnRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug()) return;
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.warn(message);
}

export function hasRouteLogKey(key: string): boolean {
  return loggedOnce.has(key);
}
