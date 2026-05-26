export type { AccessSnapshot, SubscriptionState, TestModeOverride, UserRole } from "./types";
export { ACCESS_CHANGED_EVENT, broadcastAccessChange } from "./events";
export {
  readMockSubscriptionTier,
  writeMockSubscriptionTier,
  readTestModeOverride,
  writeTestModeOverride,
  readDeveloperUnlocked,
} from "./storage";
export {
  isDeveloperBuildEnabled,
  isDeveloperAccount,
  unlockDeveloperMode,
  lockDeveloperMode,
  canShowDeveloperTools,
} from "./developer";
export {
  buildAccessSnapshot,
  resolveClientEffectiveTier,
  resolveEffectivePlanTierWithProfile,
  setMockSubscriptionTier,
  setTestModeOverride,
} from "./resolve";
export { applyTierToAiContext } from "./context";
export {
  resetUserMemory,
  resetTravelPreference,
  clearSavedCollections,
  forceOnboarding,
  forceFreeMode,
  forcePlusMode,
  clearTestModeOverride,
  applyMockSubscription,
  applyTestOverride,
} from "./dev-actions";

/** @deprecated Use access test override — kept for migration */
export { readDebugAiMode, writeDebugAiMode } from "@/lib/plan-tier/debug-ai-mode";
