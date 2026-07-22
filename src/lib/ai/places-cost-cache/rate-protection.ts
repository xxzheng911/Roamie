/**
 * Places Rate Protection — when rate-limited / quota near limit,
 * stop new Places calls and force cache-only (no retry).
 */
import {
  isPlacesRateLimited,
  getPlacesApiCallStats,
} from "@/lib/places-api-guard";
import { logPlacesRateProtection } from "@/lib/ai/places-cost-cache/log";
import { logPlacesSearchSkipped } from "@/lib/ai/places-cost-cache/log";

/** Soft quota: if blocked count rises sharply in this generation, lock. */
const BLOCKED_LOCK_THRESHOLD = 3;

let rateProtectionActive = false;
let rateProtectionReason = "";
let rateProtectionUntil = 0;

export function activatePlacesRateProtection(params: {
  reason: string;
  ttlMs?: number;
}): void {
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

  // Auto-arm from Places guard signal
  if (isPlacesRateLimited(now)) {
    activatePlacesRateProtection({ reason: "PLACES_RATE_LIMIT_BLOCKED", ttlMs: 30_000 });
    return true;
  }

  const stats = getPlacesApiCallStats();
  if (stats.blocked >= BLOCKED_LOCK_THRESHOLD || stats.textRateLimited >= BLOCKED_LOCK_THRESHOLD) {
    activatePlacesRateProtection({
      reason: "quota_near_limit",
      ttlMs: 45_000,
    });
    return true;
  }

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
