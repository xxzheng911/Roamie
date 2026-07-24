import { shouldLogDirectionsDebug } from "@/lib/directions-debug-log";

const loggedOnce = new Set<string>();

export function logRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug()) return;
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.info(message);
}

/** Debug-level once log (same gate as info; not warn). */
export function debugRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug()) return;
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
