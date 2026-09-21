/**
 * Places Rate Protection — when rate-limited / quota near limit,
 * stop new Places calls and force cache-only (no retry).
 */
import { logPlacesRateProtection } from "@/lib/ai/places-cost-cache/log";
import { logPlacesSearchSkipped } from "@/lib/ai/places-cost-cache/log";

let rateProtectionActive = false;
let rateProtectionReason = "";
let rateProtectionUntil = 0;

export function activatePlacesRateProtection(params: { reason: string; ttlMs?: number }): void {
  rateProtectionActive = true;
  rateProtectionReason = params.reason;
  rateProtectionUntil = Date.now() + (params.ttlMs ?? 60_000);
  logPlacesRateProtection({
    active: true,
    reason: params.reason,
    until: rateProtectionUntil,
  });
}

export function clearPlacesRateProtection(): void {
  rateProtectionActive = false;
  rateProtectionReason = "";
  rateProtectionUntil = 0;
}

export function isPlacesRateProtectionActive(now = Date.now()): boolean {
  if (rateProtectionActive && now >= rateProtectionUntil) {
    clearPlacesRateProtection();
    return false;
  }
  if (rateProtectionActive) return true;

  // Client window fullness is admitted in places-api-guard.
  // A hot window must not sticky-lock the next foreground user action.
  // HTTP 429 and explicit activatePlacesRateProtection still set this flag.
  return false;
}

/**
 * Hard gate for planning / chat Places — prefer cache, never retry.
 */
export function shouldBlockNewPlacesCalls(opts?: {
  logSkip?: boolean;
  destination?: string;
  query?: string;
}): boolean {
  if (!isPlacesRateProtectionActive()) return false;
  if (opts?.logSkip !== false) {
    logPlacesSearchSkipped({
      reason: "rate_protection",
      protectionReason: rateProtectionReason || "unknown",
      destination: opts?.destination ?? "",
      query: opts?.query ?? "",
    });
  }
  return true;
}

export function getPlacesRateProtectionState(): {
  active: boolean;
  reason: string;
  until: number;
} {
  return {
    active: isPlacesRateProtectionActive(),
    reason: rateProtectionReason,
    until: rateProtectionUntil,
  };
}
