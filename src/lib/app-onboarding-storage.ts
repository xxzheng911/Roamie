import { detectPlatform } from "@/services/platform";

/** Device-local: Capacitor Preferences (UserDefaults) on native; localStorage on web */
export const HAS_SEEN_ONBOARDING_KEY = "roamie:hasSeenOnboarding";

let cachedHasSeen: boolean | null = null;
let hydratePromise: Promise<void> | null = null;

function readLocalHasSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(HAS_SEEN_ONBOARDING_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLocalHasSeen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      localStorage.setItem(HAS_SEEN_ONBOARDING_KEY, "true");
    } else {
      localStorage.removeItem(HAS_SEEN_ONBOARDING_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Only explicit "true" counts as seen; null / missing / "false" = not seen */
async function readPreferencesHasSeen(): Promise<boolean | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key: HAS_SEEN_ONBOARDING_KEY });
    if (value === null || value === undefined || value === "") return null;
    return value === "true";
  } catch {
    return null;
  }
}

async function writePreferencesHasSeen(value: boolean): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { Preferences } = await import("@capacitor/preferences");
    if (value) {
      await Preferences.set({ key: HAS_SEEN_ONBOARDING_KEY, value: "true" });
    } else {
      await Preferences.remove({ key: HAS_SEEN_ONBOARDING_KEY });
    }
  } catch {
    /* web / plugin unavailable */
  }
}

function logOnboardingStorage(source: string, seen: boolean, detail?: Record<string, unknown>): void {
  console.info("[Startup] onboarding storage", { source, seen, ...detail });
}

/** Load onboarding flag before routing — native trusts Preferences only. */
export async function hydrateOnboardingStorage(): Promise<void> {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    if (typeof window === "undefined") {
      cachedHasSeen = false;
      return;
    }

    const { isCapacitor } = detectPlatform();

    if (isCapacitor) {
      const fromPrefs = await readPreferencesHasSeen();
      if (fromPrefs === true) {
        cachedHasSeen = true;
        writeLocalHasSeen(true);
        logOnboardingStorage("preferences", true);
        return;
      }

      // Native reinstall / first launch: Preferences unset → never seen (ignore stale localStorage)
      cachedHasSeen = false;
      writeLocalHasSeen(false);
      if (fromPrefs === false) {
        logOnboardingStorage("preferences", false, { note: "explicit false" });
      } else {
        logOnboardingStorage("preferences", false, { note: "unset — first run" });
      }
      return;
    }

    const fromLocal = readLocalHasSeen();
    cachedHasSeen = fromLocal;
    logOnboardingStorage("localStorage", fromLocal);
    if (fromLocal) {
      await writePreferencesHasSeen(true);
    }
  })();

  return hydratePromise;
}

export function resetOnboardingHydration(): void {
  hydratePromise = null;
  cachedHasSeen = null;
}

export function hasSeenOnboarding(): boolean {
  if (cachedHasSeen !== null) return cachedHasSeen;
  return readLocalHasSeen();
}

export async function markOnboardingSeen(): Promise<void> {
  cachedHasSeen = true;
  writeLocalHasSeen(true);
  await writePreferencesHasSeen(true);
  logOnboardingStorage("markOnboardingSeen", true);
}

export async function clearHasSeenOnboarding(): Promise<void> {
  resetOnboardingHydration();
  cachedHasSeen = false;
  writeLocalHasSeen(false);
  await writePreferencesHasSeen(false);
  logOnboardingStorage("clearHasSeenOnboarding", false);
}

/** Dev-only: reset device onboarding flag */
export async function resetOnboardingForDev(): Promise<void> {
  if (!import.meta.env.DEV) return;
  await clearHasSeenOnboarding();
}
