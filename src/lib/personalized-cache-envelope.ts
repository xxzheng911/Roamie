import type { PlanTier } from "@/lib/plan-tier/types";

export const PERSONALIZED_CACHE_SCHEMA_VERSION = 1;

export type PersonalizedCacheEnvelope<T> = {
  ownerUserId: string;
  tier: PlanTier | "unknown";
  schemaVersion: number;
  updatedAt: string;
  payload: T;
};

export function wrapPersonalizedCache<T>(
  ownerUserId: string,
  payload: T,
  tier: PlanTier | "unknown" = "unknown",
): PersonalizedCacheEnvelope<T> {
  return {
    ownerUserId,
    tier,
    schemaVersion: PERSONALIZED_CACHE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    payload,
  };
}

export function readOwnedPersonalizedCache<T>(
  raw: string | null,
  currentUserId: string | null,
): T | null {
  if (!raw || !currentUserId) return null;
  try {
    const value = JSON.parse(raw) as Partial<PersonalizedCacheEnvelope<T>>;
    if (
      value.schemaVersion !== PERSONALIZED_CACHE_SCHEMA_VERSION ||
      value.ownerUserId !== currentUserId
    )
      return null;
    return value.payload ?? null;
  } catch {
    return null;
  }
}
