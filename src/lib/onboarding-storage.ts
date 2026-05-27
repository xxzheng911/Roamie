import { Preferences } from "@capacitor/preferences";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { detectPlatform } from "@/services/platform";

/** 單一來源 key（Capacitor Preferences + localStorage 鏡像；不用 Keychain） */
export const ONBOARDING_COMPLETED_KEY = "onboarding_completed";

/** @deprecated 僅 reset 時清除 */
export const HAS_SEEN_ONBOARDING_KEY = "hasSeenOnboarding";
/** @deprecated 僅 reset 時清除 */
export const FIRST_LAUNCH_KEY = "firstLaunch";
/** @deprecated 僅 reset 時清除 */
export const SKIP_ONBOARDING_KEY = "skipOnboarding";

const LEGACY_COMPANION_KEY = "roamie:companionModeCompleted";
const LEGACY_NATIVE_PREF_KEY = ONBOARDING_COMPLETED_KEY;

export type OnboardingStorageSource = "preferences" | "localStorage" | "none";

let hydratePromise: Promise<boolean> | null = null;
let hydrated = false;
/** hydrate 後的記憶體快取（isOnboardingCompletedSync 只讀此值） */
let cachedCompleted = false;
let lastStorageSource: OnboardingStorageSource = "none";

function readLocalOnboardingFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLocalOnboardingFlag(completed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (completed) {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    } else {
      localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
      localStorage.removeItem(HAS_SEEN_ONBOARDING_KEY);
      localStorage.removeItem(FIRST_LAUNCH_KEY);
      localStorage.removeItem(SKIP_ONBOARDING_KEY);
      localStorage.removeItem(LEGACY_COMPANION_KEY);
    }
  } catch {
    /* quota / private mode */
  }
}

async function readPreferencesOnboardingFlag(): Promise<boolean | null> {
  const platform = detectPlatform();
  if (!platform.isCapacitor) return null;
  const bridgeReady = await waitForCapacitorBridge(4_000);
  if (!bridgeReady) return null;
  try {
    const { value } = await Preferences.get({ key: ONBOARDING_COMPLETED_KEY });
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  } catch (e) {
    console.warn("[Onboarding] Preferences.get failed", e);
    return null;
  }
}

async function writePreferencesOnboardingFlag(completed: boolean): Promise<void> {
  const platform = detectPlatform();
  if (!platform.isCapacitor) return;
  const bridgeReady = await waitForCapacitorBridge(4_000);
  if (!bridgeReady) return;
  try {
    if (completed) {
      await Preferences.set({ key: ONBOARDING_COMPLETED_KEY, value: "true" });
    } else {
      await Preferences.remove({ key: ONBOARDING_COMPLETED_KEY });
      await Preferences.remove({ key: HAS_SEEN_ONBOARDING_KEY });
      await Preferences.remove({ key: FIRST_LAUNCH_KEY });
      await Preferences.remove({ key: SKIP_ONBOARDING_KEY });
      await Preferences.remove({ key: LEGACY_NATIVE_PREF_KEY });
    }
  } catch (e) {
    console.warn("[Onboarding] Preferences write failed", e);
  }
}

function resolveStorageSource(completed: boolean, fromPrefs: boolean): OnboardingStorageSource {
  if (!completed) {
    lastStorageSource = "none";
    return "none";
  }
  lastStorageSource = fromPrefs ? "preferences" : "localStorage";
  return lastStorageSource;
}

export function getOnboardingStorageSource(): OnboardingStorageSource {
  return lastStorageSource;
}

/** 同步快取（須先 await loadOnboardingState） */
export function isOnboardingCompletedSync(): boolean {
  if (!hydrated) return false;
  return cachedCompleted;
}

export function isOnboardingHydrated(): boolean {
  return hydrated;
}

/** @alias loadOnboardingState */
export async function loadOnboardingCompleted(): Promise<boolean> {
  return loadOnboardingState();
}

/** 啟動時載入 onboarding（App boot 必須 await） */
export async function loadOnboardingState(): Promise<boolean> {
  return hydrateOnboardingStatus();
}

export async function hydrateOnboardingStatus(): Promise<boolean> {
  if (hydrated) return cachedCompleted;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    console.info("[Onboarding Status Loading]");

    const fromPrefs = await readPreferencesOnboardingFlag();
    const fromLocal = readLocalOnboardingFlag();
    const completed = fromPrefs === true || (fromPrefs === null && fromLocal);
    cachedCompleted = completed;

    if (completed) {
      writeLocalOnboardingFlag(true);
      await writePreferencesOnboardingFlag(true);
    }

    const source = resolveStorageSource(completed, fromPrefs === true);
    hydrated = true;

    console.info("[Onboarding Hydrated]", {
      onboardingCompleted: completed,
      storageSource: source,
      preferencesValue: fromPrefs,
      localStorageValue: fromLocal,
      currentRoute:
        typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") || "/" : null,
    });
    return completed;
  })();

  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

export function markOnboardingCompletedSync(): void {
  cachedCompleted = true;
  hydrated = true;
  writeLocalOnboardingFlag(true);
  void writePreferencesOnboardingFlag(true);
  resolveStorageSource(true, detectPlatform().isCapacitor);
  console.info("[Onboarding Marked Completed]", { storageSource: lastStorageSource });
}

export async function markOnboardingCompleted(): Promise<void> {
  markOnboardingCompletedSync();
}

export async function clearOnboardingCompleted(): Promise<void> {
  cachedCompleted = false;
  writeLocalOnboardingFlag(false);
  await writePreferencesOnboardingFlag(false);
  hydrated = false;
  lastStorageSource = "none";
  console.info("[Onboarding] cleared");
}

const PROFILE_CACHE_KEYS = ["roamie:user-profile", "roamie:profile-settings"] as const;

const EXTRA_ONBOARDING_KEYS = [
  ONBOARDING_COMPLETED_KEY,
  HAS_SEEN_ONBOARDING_KEY,
  FIRST_LAUNCH_KEY,
  SKIP_ONBOARDING_KEY,
  LEGACY_COMPANION_KEY,
  "roamie:onboarding",
  "roamie:firstLaunch",
] as const;

/**
 * Dev-only：清除所有 onboarding 相關本機／Preferences 狀態。
 * Console: `await __ROAMIE_DEV__.resetOnboarding()`
 */
export async function resetOnboardingState(): Promise<void> {
  cachedCompleted = false;
  hydrated = false;
  lastStorageSource = "none";

  if (typeof window !== "undefined") {
    try {
      for (const key of EXTRA_ONBOARDING_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
      for (const key of PROFILE_CACHE_KEYS) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }

  const platform = detectPlatform();
  if (platform.isCapacitor) {
    const bridgeReady = await waitForCapacitorBridge(4_000);
    if (bridgeReady) {
      for (const key of EXTRA_ONBOARDING_KEYS) {
        try {
          await Preferences.remove({ key });
        } catch {
          /* ignore */
        }
      }
    }
  }

  const { clearCompanionModeSelection } = await import("@/lib/companion-mode-storage");
  clearCompanionModeSelection();

  console.info("[ONBOARDING_RESET] completed");
}

export function installDevOnboardingGlobals(): void {
  if (typeof window === "undefined") return;
  const w = window as Window & {
    __ROAMIE_DEV__?: {
      resetOnboarding: () => Promise<void>;
      resetOnboardingState: () => Promise<void>;
      resetFirstLaunch: () => Promise<void>;
      loadOnboardingState: () => Promise<boolean>;
    };
  };
  w.__ROAMIE_DEV__ = {
    resetOnboarding: () => resetOnboardingState(),
    resetOnboardingState: () => resetOnboardingState(),
    resetFirstLaunch: () => resetOnboardingState(),
    loadOnboardingState: () => loadOnboardingState(),
  };
  if (import.meta.env.DEV) {
    console.info("[Onboarding] dev helpers: await __ROAMIE_DEV__.resetOnboardingState()");
  }
}

export function logSkipOnboarding(reason: string): void {
  console.info("[Skip Onboarding]", { reason });
}

export function logShowOnboardingFirstLaunch(): void {
  console.info("[Show Onboarding First Launch Only]");
}
