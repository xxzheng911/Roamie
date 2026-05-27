/** 舊版冷啟動路由（onboarding 請走 /welcome，勿併入 /） */
const LEGACY_STARTUP_PATHS = new Set(["/loading", "/intro", "/splash"]);

/** Capacitor bundled index.html mounts React into #root (no SSR document shell). */
export function isCapacitorSpaMount(): boolean {
  return typeof document !== "undefined" && document.getElementById("root") != null;
}

/**
 * Capacitor bundled WebView may open file:// or https://localhost/index.html.
 * Normalize entry path so router mounts correctly.
 */
export function normalizeCapacitorEntryPath(): void {
  if (typeof window === "undefined") return;

  const { pathname, search, hash } = window.location;
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized === "/index.html" || normalized.endsWith("/index.html")) {
    window.history.replaceState(window.history.state, "", `/${search}${hash}`);
    return;
  }

  if (normalized === "/onboarding") {
    window.history.replaceState(window.history.state, "", `/welcome${search}${hash}`);
    return;
  }

  if (LEGACY_STARTUP_PATHS.has(normalized)) {
    window.history.replaceState(window.history.state, "", `/${search}${hash}`);
  }
}
