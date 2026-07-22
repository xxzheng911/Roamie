/** Official AI Credits costs — do not add other feature types. */

export const CREDITS_FEATURE_TYPES = [
  "PLACE_RECOMMENDATION",
  "ITINERARY_GENERATION",
] as const;

export type CreditsFeatureType = (typeof CREDITS_FEATURE_TYPES)[number];

export const CREDITS_COSTS: Record<CreditsFeatureType, number> = {
  /** One successful recommendation batch (any card count) = 1 credit */
  PLACE_RECOMMENDATION: 1,
  /** Full itinerary generation success = 7 credits (entire planning flow) */
  ITINERARY_GENERATION: 7,
};

/** Free plan: natural month allotment (no rollover) */
export const FREE_MONTHLY_CREDITS = 20;

/** Debug Override presets for greeting / gate testing */
export const DEBUG_CREDIT_PRESETS = [20, 15, 14, 8, 7, 1, 0] as const;

/** Server also auto-rollbacks reserved rows older than this */
export const CREDITS_RESERVE_STALE_MAX_AGE_MS = 5 * 60 * 1000;

export type CreditsGreetingStage = 1 | 2 | 3 | 4;

/**
 * Stage 1: 15–20
 * Stage 2: 8–14
 * Stage 3: 1–7
 * Stage 4: 0
 */
export function resolveCreditsGreetingStage(
  availableCredits: number,
  opts?: { isPlus?: boolean; creditsEnabled?: boolean },
): CreditsGreetingStage {
  if (opts?.isPlus || opts?.creditsEnabled === false) return 1;
  const n = Math.max(0, Math.floor(availableCredits));
  if (n <= 0) return 4;
  if (n <= 7) return 3;
  if (n <= 14) return 2;
  return 1;
}
