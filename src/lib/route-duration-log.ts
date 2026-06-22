import { shouldLogDirectionsDebug } from "@/lib/directions-debug-log";

const loggedOnce = new Set<string>();

export function logRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug()) return;
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.info(message);
}

export function warnRouteOnce(key: string, message: string): void {
  if (!shouldLogDirectionsDebug()) return;
  if (loggedOnce.has(key)) return;
  loggedOnce.add(key);
  console.warn(message);
}
