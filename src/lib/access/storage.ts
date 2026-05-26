import type { SubscriptionState, TestModeOverride } from "./types";

const MOCK_TIER_KEY = "roamie:mock-subscription-tier";
const DEV_UNLOCK_KEY = "roamie:developer-unlocked";
const TEST_OVERRIDE_KEY = "roamie:test-mode-override";

export function readMockSubscriptionTier(): SubscriptionState {
  if (typeof window === "undefined") return "free";
  const raw = localStorage.getItem(MOCK_TIER_KEY);
  return raw === "plus" ? "plus" : "free";
}

export function writeMockSubscriptionTier(tier: SubscriptionState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MOCK_TIER_KEY, tier);
}

export function readDeveloperUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEV_UNLOCK_KEY) === "1";
}

export function writeDeveloperUnlocked(unlocked: boolean): void {
  if (typeof window === "undefined") return;
  if (unlocked) localStorage.setItem(DEV_UNLOCK_KEY, "1");
  else localStorage.removeItem(DEV_UNLOCK_KEY);
}

export function readTestModeOverride(): TestModeOverride {
  if (typeof window === "undefined") return "none";
  const raw = localStorage.getItem(TEST_OVERRIDE_KEY);
  if (raw === "force-free" || raw === "force-plus") return raw;
  return "none";
}

export function writeTestModeOverride(mode: TestModeOverride): void {
  if (typeof window === "undefined") return;
  if (mode === "none") localStorage.removeItem(TEST_OVERRIDE_KEY);
  else localStorage.setItem(TEST_OVERRIDE_KEY, mode);
}
