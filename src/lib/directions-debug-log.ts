import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

/** Xcode / Capacitor 需可見；web dev 亦開啟 */
export function shouldLogDirectionsDebug(): boolean {
  return import.meta.env.DEV || isCapacitorNativeShell();
}

export type DirectionsDebugContext = {
  origin?: string;
  destination?: string;
  hasOrigin?: boolean;
  hasDestination?: boolean;
  mode?: string;
  provider?: string;
  durationMinutes?: number | null;
  error?: string;
  skippedReason?: string;
  force?: boolean;
  legKey?: string;
};

const loggedEvents = new Set<string>();

function eventDedupeKey(event: string, ctx: DirectionsDebugContext): string {
  return [
    event,
    ctx.legKey ?? "",
    ctx.origin ?? "",
    ctx.destination ?? "",
    ctx.mode ?? "",
    ctx.skippedReason ?? "",
    ctx.error ?? "",
    ctx.durationMinutes ?? "",
  ].join("|");
}

export function logDirectionsDebug(event: string, ctx: DirectionsDebugContext = {}): void {
  if (!shouldLogDirectionsDebug()) return;

  const dedupeKey = eventDedupeKey(event, ctx);
  if (loggedEvents.has(dedupeKey)) return;
  loggedEvents.add(dedupeKey);

  const parts = [
    `[Directions] ${event}`,
    ctx.legKey ? `leg=${ctx.legKey}` : "",
    ctx.hasOrigin != null ? `hasOrigin=${ctx.hasOrigin}` : "",
    ctx.hasDestination != null ? `hasDestination=${ctx.hasDestination}` : "",
    ctx.origin ? `origin=${ctx.origin}` : "",
    ctx.destination ? `destination=${ctx.destination}` : "",
    ctx.mode ? `mode=${ctx.mode}` : "",
    ctx.provider ? `provider=${ctx.provider}` : "",
    ctx.force != null ? `force=${ctx.force}` : "",
    ctx.durationMinutes != null ? `durationMinutes=${ctx.durationMinutes}` : "",
    ctx.error ? `error=${ctx.error}` : "",
    ctx.skippedReason ? `skipped=${ctx.skippedReason}` : "",
  ].filter(Boolean);

  if (event.includes("failed") || event.includes("fallback") || ctx.error) {
    console.warn(parts.join(" "));
  } else if (ctx.skippedReason === "scoped_cache_hit" || ctx.skippedReason === "scoped_inflight") {
    // Cache hits are normal — debug only, never warn (avoids Xcode spam).
    if (import.meta.env.DEV) {
      console.debug(parts.join(" "));
    }
  } else if (event.includes("skipped")) {
    console.info(parts.join(" "));
  } else {
    console.info(parts.join(" "));
  }
}

/** 測試／強制重算時清除 dedupe */
export function resetDirectionsDebugLog(): void {
  loggedEvents.clear();
}
