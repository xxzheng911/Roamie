/** Per-tab: show startup splash at most once */
const SPLASH_SHOWN_KEY = "roamie:bootstrap_splash_shown";

export function shouldShowBootstrapSplash(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SPLASH_SHOWN_KEY) !== "1";
  } catch {
    return false;
  }
}

export function markBootstrapSplashShown(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SPLASH_SHOWN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearBootstrapSplashForDev(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SPLASH_SHOWN_KEY);
  } catch {
    /* ignore */
  }
}
