import { Preferences } from "@capacitor/preferences";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { detectPlatform } from "@/services/platform";

/** 本機持久化：完成教學 / 陪伴方式選擇（裝置級，登出不清除） */
export const ONBOARDING_COMPLETED_KEY = "onboarding_completed";

const LEGACY_COMPANION_KEY = "roamie:companionModeCompleted";

let hydratePromise: Promise<boolean> | null = null;
let hydrated = false;

function readLocalOnboardingFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true") return true;
    if (localStorage.getItem(LEGACY_COMPANION_KEY) === "true") return true;
    return false;
  } catch {
    return false;
  }
}

function writeLocalOnboardingFlag(completed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (completed) {
      localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
      localStorage.setItem(LEGACY_COMPANION_KEY, "true");
    } else {
      localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
      localStorage.removeItem(LEGACY_COMPANION_KEY);
    }
  } catch {
    /* quota / private mode */
  }
}

async function readNativeOnboardingFlag(): Promise<boolean | null> {
  const platform = detectPlatform();
  if (!platform.isCapacitor) return null;
  const bridgeReady = await waitForCapacitorBridge(8_000);
  if (!bridgeReady) {
    console.warn("[Onboarding] Preferences skipped — Capacitor bridge not ready");
    return null;
  }
  try {
    const { value } = await Preferences.get({ key: ONBOARDING_COMPLETED_KEY });
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
  } catch (e) {
    console.warn("[Onboarding] Preferences read failed", e);
    return null;
  }
}

async function writeNativeOnboardingFlag(completed: boolean): Promise<void> {
  const platform = detectPlatform();
  if (!platform.isCapacitor) return;
  const bridgeReady = await waitForCapacitorBridge(8_000);
  if (!bridgeReady) return;
  try {
    await Preferences.set({
      key: ONBOARDING_COMPLETED_KEY,
      value: completed ? "true" : "false",
    });
  } catch (e) {
    console.warn("[Onboarding] Preferences write failed", e);
  }
}

/** 同步快取（hydrate 後可靠；亦供 cold-start 同步路徑） */
export function isOnboardingCompletedSync(): boolean {
  return readLocalOnboardingFlag();
}

export function isOnboardingHydrated(): boolean {
  return hydrated;
}

/** 啟動時從 Preferences 同步到 localStorage，再決定是否顯示教學 */
export async function hydrateOnboardingStatus(): Promise<boolean> {
  if (hydrated) return isOnboardingCompletedSync();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    console.info("[Onboarding Status Loading]");
    const local = readLocalOnboardingFlag();
    const native = await readNativeOnboardingFlag();
    const completed = native === true || (native === null && local) || local;

    if (completed) {
      writeLocalOnboardingFlag(true);
      await writeNativeOnboardingFlag(true);
      if (typeof window !== "undefined") {
        const path = window.location.pathname.replace(/\/+$/, "") || "/";
        if (path === "/welcome") {
          try {
            window.history.replaceState(window.history.state, "", "/");
          } catch {
            /* ignore */
          }
        }
      }
    }

    hydrated = true;
    console.info(`[Onboarding Completed: ${completed}]`);
    return completed;
  })();

  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

/** 完成教學後立即寫入（同步 local + 非阻塞 native） */
export function markOnboardingCompletedSync(): void {
  writeLocalOnboardingFlag(true);
  void writeNativeOnboardingFlag(true);
  console.info("[Onboarding Marked Completed]");
}

export async function markOnboardingCompleted(): Promise<void> {
  markOnboardingCompletedSync();
  await writeNativeOnboardingFlag(true);
}

/** 僅 __DEV__ / developer tools */
export async function clearOnboardingCompleted(): Promise<void> {
  writeLocalOnboardingFlag(false);
  await writeNativeOnboardingFlag(false);
  hydrated = false;
  console.info("[Onboarding] cleared (dev reset)");
}

export function logSkipOnboarding(reason: string): void {
  console.info("[Skip Onboarding]", { reason });
}

export function logShowOnboardingFirstLaunch(): void {
  console.info("[Show Onboarding First Launch Only]");
}
