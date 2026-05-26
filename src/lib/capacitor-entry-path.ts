/** 舊版冷啟動／onboarding 路由（已移除，須導回根路徑由 React gate 決定去向） */
const LEGACY_STARTUP_PATHS = new Set(["/loading", "/intro", "/splash", "/onboarding"]);

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

  if (LEGACY_STARTUP_PATHS.has(normalized)) {
    window.history.replaceState(window.history.state, "", `/${search}${hash}`);
  }
}
