import { getClientAuthSession } from "@/lib/auth-session";
import {
  getOnboardingStorageSource,
  isOnboardingCompletedSync,
  isOnboardingHydrated,
} from "@/lib/onboarding-storage";
import { detectPlatform } from "@/services/platform";
import { readBrowserPathname } from "@/lib/startup-path";

declare global {
  interface Window {
    __ROAMIE_BOOT_LOG__?: { log?: (msg: string, critical?: boolean) => void };
  }
}

/** 教學頁 canonical path（別名 /onboarding 會 redirect 到此） */
export const ONBOARDING_ROUTE = "/welcome";

/** Xcode / WKWebView 預設可見；production quietBoot 不會吃掉 console.log */
export function logAppBoot(message: string, extra?: Record<string, unknown>): void {
  const line = `[APP_BOOT] ${message}`;
  if (extra && Object.keys(extra).length > 0) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
  try {
    window.__ROAMIE_BOOT_LOG__?.log?.(line, true);
  } catch {
    /* ignore */
  }
}

export async function logAppBootSnapshot(targetRoute?: string): Promise<void> {
  const platform = detectPlatform();
  const session = await getClientAuthSession().catch(() => null);
  logAppBoot("snapshot", {
    platform: platform.kind,
    isCapacitor: platform.isCapacitor,
    isIOS: platform.isIOS,
    currentRoute: readBrowserPathname(),
    onboardingHydrated: isOnboardingHydrated(),
    onboardingCompleted: isOnboardingHydrated() ? isOnboardingCompletedSync() : null,
    storageSource: getOnboardingStorageSource(),
    authSession: session?.user ? { userId: session.user.id } : null,
    targetRoute: targetRoute ?? null,
  });
}
