import { FREE_TIER_LIMITS, FEATURE_TIER_MAP } from "@/constants/subscription";
import type {
  FeatureGateResult,
  SubscriptionFeature,
  SubscriptionStatus,
  UsageCounters,
} from "./types";

export function tierRank(tier: SubscriptionStatus["tier"]): number {
  return tier === "plus" || tier === "premium" ? 1 : 0;
}

export function hasTier(
  status: SubscriptionStatus,
  required: SubscriptionStatus["tier"],
): boolean {
  return tierRank(status.tier) >= tierRank(required);
}

export function canUseFeature(
  status: SubscriptionStatus,
  usage: UsageCounters,
  feature: SubscriptionFeature,
): FeatureGateResult {
  const requiredTier = FEATURE_TIER_MAP[feature];
  if (!hasTier(status, requiredTier)) {
    return { allowed: false, reason: "premium_required", feature };
  }

  if (status.tier === "plus" || status.tier === "premium") return { allowed: true };

  switch (feature) {
    case "ai_chat":
      if (usage.aiChatsToday >= FREE_TIER_LIMITS.aiChatsPerDay) {
        return { allowed: false, reason: "limit_reached", feature };
      }
      break;
    case "itinerary_generate":
      if (usage.itineraryGenerationsToday >= FREE_TIER_LIMITS.itineraryGenerationsPerDay) {
        return { allowed: false, reason: "limit_reached", feature };
      }
      break;
    case "hidden_locals":
    case "advanced_travel_modes":
    case "ai_memory":
    case "smart_itinerary":
    case "weather_planning":
    case "unlimited_ai":
      return { allowed: false, reason: "premium_required", feature };
    default:
      break;
  }

  return { allowed: true };
}

export function defaultFreeStatus(): SubscriptionStatus {
  return {
    tier: "free",
    isActive: true,
    expiresAt: null,
    productId: null,
    willRenew: false,
    source: "local",
  };
}

export function defaultUsage(): UsageCounters {
  const today = new Date().toISOString().slice(0, 10);
  return {
    aiChatsToday: 0,
    itineraryGenerationsToday: 0,
    advancedRecommendationsToday: 0,
    resetAt: today,
  };
}

const USAGE_KEY = "roamie:usage-counters";

export function readLocalUsage(): UsageCounters {
  if (typeof window === "undefined") return defaultUsage();
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return defaultUsage();
    const parsed = JSON.parse(raw) as UsageCounters;
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.resetAt !== today) return defaultUsage();
    return parsed;
  } catch {
    return defaultUsage();
  }
}

export function writeLocalUsage(usage: UsageCounters): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

export function incrementUsage(
  feature: SubscriptionFeature,
  usage: UsageCounters,
): UsageCounters {
  const today = new Date().toISOString().slice(0, 10);
  const base = usage.resetAt === today ? usage : defaultUsage();
  const next = { ...base, resetAt: today };
  if (feature === "ai_chat" || feature === "unlimited_ai") next.aiChatsToday += 1;
  if (feature === "itinerary_generate" || feature === "smart_itinerary") {
    next.itineraryGenerationsToday += 1;
  }
  if (feature === "hidden_locals" || feature === "advanced_travel_modes") {
    next.advancedRecommendationsToday += 1;
  }
  writeLocalUsage(next);
  return next;
}
