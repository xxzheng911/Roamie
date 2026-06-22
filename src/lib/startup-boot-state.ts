import type { StartupPath } from "@/lib/post-auth-navigation";
import { isOnboardingCompletedSync } from "@/lib/onboarding-storage";
import { readBrowserPathname } from "@/lib/startup-path";

let bootCompleted = false;
let startupResolved = false;
let lastResolvedTarget: StartupPath | null = null;
let lastNavLogKey = "";
let onboardingGateBootStarted = false;
let bootRouteSyncStarted = false;
let bootHydrated = false;
let bootRouteSynced = false;
/** onboarding 未完成且已停在 /welcome — 不需再跑完整 cold-start boot */
let welcomeBootSettled = false;

const loggedAppBootKeys = new Set<string>();
let appBootSnapshotLogged = false;
let appMountedLogged = false;
let onboardingGuardMountedLogged = false;

const remountCounts: Record<string, number> = {};
let routerCreateCount = 0;

function normalizeRoute(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function isBootCompleted(): boolean {
  return bootCompleted;
}

export function markBootCompleted(): void {
  bootCompleted = true;
}

export function hasResolvedStartup(): boolean {
  return startupResolved;
}

export function markStartupResolved(target: StartupPath): void {
  welcomeBootSettled = false;
  startupResolved = true;
  lastResolvedTarget = target;
  bootHydrated = true;
  bootRouteSynced = true;
  markBootCompleted();
}

export function getLastResolvedStartupTarget(): StartupPath | null {
  return lastResolvedTarget;
}

export function isWelcomeBootSettled(): boolean {
  return welcomeBootSettled;
}

export function getBootGateState(): {
  hydrated: boolean;
  routeSynced: boolean;
  target: StartupPath | null;
} {
  return {
    hydrated: bootHydrated || bootCompleted || welcomeBootSettled,
    routeSynced: bootRouteSynced || bootCompleted || welcomeBootSettled,
    target: lastResolvedTarget,
  };
}

/** /welcome 教學頁 idle：已 hydrate + route 正確，但不標記全 app boot 完成 */
export function markWelcomeBootSettled(target: StartupPath = "/welcome"): void {
  welcomeBootSettled = true;
  bootHydrated = true;
  bootRouteSynced = true;
  lastResolvedTarget = target;
  onboardingGateBootStarted = true;
  bootRouteSyncStarted = true;
}

export function resetWelcomeBootForOnboardingReset(): void {
  welcomeBootSettled = false;
  onboardingGateBootStarted = false;
  bootRouteSyncStarted = false;
  bootHydrated = false;
  bootRouteSynced = false;
  lastResolvedTarget = null;
}

export function markBootHydrated(): void {
  bootHydrated = true;
}

export function markBootRouteSynced(
  target: StartupPath,
  options?: { onboardingCompleted?: boolean },
): void {
  bootRouteSynced = true;
  lastResolvedTarget = target;
  const onboardingDone = options?.onboardingCompleted ?? false;
  if (
    !onboardingDone &&
    normalizeRoute(target) === "/welcome" &&
    normalizeRoute(readBrowserPathname()) === "/welcome"
  ) {
    markWelcomeBootSettled(target);
    return;
  }
  markStartupResolved(target);
}

/** OnboardingGate boot effect — once per app session */
export function tryStartOnboardingGateBoot(): boolean {
  if (welcomeBootSettled || onboardingGateBootStarted || bootCompleted) return false;
  onboardingGateBootStarted = true;
  return true;
}

/** 是否應執行完整 startup boot（resolve path + route sync） */
export function shouldRunFullStartupBoot(): boolean {
  if (bootCompleted || welcomeBootSettled) return false;
  const path = normalizeRoute(readBrowserPathname());
  if (path === "/welcome" || path === "/onboarding") {
    // 已完成 onboarding 卻停在 /welcome（常見：Preferences 有旗標但 inline 腳本讀不到）→ 須 AppBootRouteSync
    return isOnboardingCompletedSync();
  }
  return true;
}

/** AppBootRouteSync navigate — once per app session */
export function tryStartBootRouteSync(): boolean {
  if (bootRouteSyncStarted || bootCompleted) return false;
  bootRouteSyncStarted = true;
  return true;
}

export function shouldSkipStartupNavigation(
  current: string,
  target: StartupPath,
): boolean {
  return normalizeRoute(current) === normalizeRoute(target);
}

export function shouldLogStartupNav(
  source: string,
  target: StartupPath,
  userId?: string | null,
): boolean {
  const current = normalizeRoute(readBrowserPathname());
  const key = `${source}|${current}|${target}|${userId ?? ""}`;
  if (key === lastNavLogKey) return false;
  lastNavLogKey = key;
  return true;
}

export function shouldLogAppBoot(key: string): boolean {
  if (loggedAppBootKeys.has(key)) return false;
  loggedAppBootKeys.add(key);
  return true;
}

export function shouldLogAppBootSnapshot(): boolean {
  if (appBootSnapshotLogged) return false;
  appBootSnapshotLogged = true;
  return true;
}

export function shouldLogAppMounted(): boolean {
  if (appMountedLogged) return false;
  appMountedLogged = true;
  return true;
}

export function shouldLogOnboardingGuardMounted(): boolean {
  if (onboardingGuardMountedLogged) return false;
  onboardingGuardMountedLogged = true;
  return true;
}

export function logAppRemountSource(component: string): void {
  const generation = (remountCounts[component] ?? 0) + 1;
  remountCounts[component] = generation;
  if (generation === 1 && welcomeBootSettled && component === "OnboardingGate") {
    return;
  }
  if (generation <= 1 && welcomeBootSettled && component === "App") {
    return;
  }
  console.info("[APP_REMOUNT_SOURCE]", {
    component,
    generation,
    bootCompleted: isBootCompleted(),
    bootGate: getBootGateState(),
    pathname: readBrowserPathname(),
  });
}

export function logOnboardingGateEffectSkip(
  reason: string,
  extra?: Record<string, unknown>,
): void {
  console.info("[ONBOARDING_GATE_EFFECT_SKIP]", {
    reason,
    bootCompleted: isBootCompleted(),
    bootGate: getBootGateState(),
    pathname: readBrowserPathname(),
    ...extra,
  });
}

export function logNavSkipSameRoute(detail: {
  source: string;
  current: string;
  target: StartupPath;
}): void {
  console.info("[NAV_SKIP_SAME_ROUTE]", {
    source: detail.source,
    current: normalizeRoute(detail.current),
    target: normalizeRoute(detail.target),
    pathname: readBrowserPathname(),
  });
}

export function logRouterCreate(reused: boolean): number {
  routerCreateCount += 1;
  console.info("[ROUTER_RECREATE]", {
    attempt: routerCreateCount,
    reused,
    pathname: readBrowserPathname(),
  });
  return routerCreateCount;
}
