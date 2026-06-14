/**
 * 定位協調器（single source of truth）
 * - 首頁：getCurrentPosition 一次，禁止 watchPosition
 * - 導航：僅在明確進入導航模式時才允許定位更新
 */

let homeRouteActive = false;
let homeLocationBootstrapped = false;
let navigationModeActive = false;

export function enterHomeLocationMode(): void {
  homeRouteActive = true;
  console.info("[LOCATION_HOME_ACTIVE]", { bootstrapped: homeLocationBootstrapped });
}

export function leaveHomeLocationMode(): void {
  homeRouteActive = false;
}

export function isHomeLocationMode(): boolean {
  return homeRouteActive;
}

export function markHomeLocationBootstrapped(): void {
  homeLocationBootstrapped = true;
}

export function isHomeLocationBootstrapped(): boolean {
  return homeLocationBootstrapped;
}

export function enterNavigationLocationMode(): void {
  navigationModeActive = true;
}

export function leaveNavigationLocationMode(): void {
  navigationModeActive = false;
}

export function isNavigationLocationMode(): boolean {
  return navigationModeActive;
}

/** 首頁停留中禁止建立 watchPosition */
export function canStartLocationWatch(reason: string): boolean {
  if (homeRouteActive && !navigationModeActive) {
    console.info("[LOCATION_WATCH_SKIP_ALREADY_ACTIVE]", {
      reason,
      blocked: "home_route_active",
    });
    return false;
  }
  if (!navigationModeActive) {
    console.info("[LOCATION_WATCH_SKIP_ALREADY_ACTIVE]", {
      reason,
      blocked: "navigation_mode_inactive",
    });
    return false;
  }
  return true;
}
