/** Device-local: survives logout; cleared on reinstall / app data wipe */
export const HAS_SEEN_ONBOARDING_KEY = "roamie:hasSeenOnboarding";

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(HAS_SEEN_ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HAS_SEEN_ONBOARDING_KEY, "true");
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearHasSeenOnboarding(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(HAS_SEEN_ONBOARDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Dev-only: reset device onboarding flag */
export function resetOnboardingForDev(): void {
  if (!import.meta.env.DEV) return;
  clearHasSeenOnboarding();
}
