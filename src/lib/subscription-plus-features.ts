import { buildAccessSnapshot } from "@/lib/access";
import type { AccessSnapshot } from "@/lib/access/types";
import type { User } from "@supabase/supabase-js";

export function readHasPlusAccessSync(
  email?: string | null,
  options?: { profilePlusActive?: boolean; user?: User | null },
): boolean {
  return buildAccessSnapshot(email, options).hasPlusAccess;
}

export function logSubscriptionModeResolved(
  snapshot: AccessSnapshot,
  reason: string,
): void {
  console.info("[SUBSCRIPTION_MODE_RESOLVED]", {
    effectiveTier: snapshot.effectiveTier,
    devSubscriptionMode: snapshot.devSubscriptionMode,
    testModeOverride: snapshot.testModeOverride,
    hasPlusAccess: snapshot.hasPlusAccess,
    reason,
  });
}

export function logPlusFeatureBlocked(feature: string, reason: string): void {
  console.info("[PLUS_FEATURE_BLOCKED]", { feature, reason });
}

export function logPlusFeatureLoaded(feature: string): void {
  console.info("[PLUS_FEATURE_LOADED]", { feature });
}

export function logTravelPrefSkippedFree(reason: string): void {
  console.info("[TRAVEL_PREF_SKIPPED_FREE]", { reason });
}

export function logTravelPrefLoadedPlus(): void {
  console.info("[TRAVEL_PREF_LOADED_PLUS]");
}
