/** SPA router bridge for OAuth deep links (Capacitor /auth/callback?code=…) */

import { AUTH_CALLBACK_PATH } from "@/constants/auth-redirect";
import { detectPlatform } from "@/services/platform";

export type OAuthAppNavigate = (path: string) => void | Promise<void>;

let navigateImpl: OAuthAppNavigate | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNavigateImpl(maxMs = 8_000): Promise<OAuthAppNavigate | null> {
  if (navigateImpl) return navigateImpl;
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (navigateImpl) return navigateImpl;
    await sleep(50);
  }
  return null;
}

export function registerOAuthAppNavigate(fn: OAuthAppNavigate): () => void {
  navigateImpl = fn;
  return () => {
    if (navigateImpl === fn) navigateImpl = null;
  };
}

export function parseOAuthAppPath(path: string): {
  pathname: string;
  search: string;
  hash: string;
  href: string;
  searchRecord: Record<string, string>;
} {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://localhost";
  const resolved = new URL(path, origin);
  const search = resolved.search || "";
  const hash = resolved.hash || "";
  const searchRecord: Record<string, string> = {};
  resolved.searchParams.forEach((value, key) => {
    searchRecord[key] = value;
  });
  return {
    pathname: resolved.pathname.replace(/\/+$/, "") || "/",
    search,
    hash,
    href: `${resolved.pathname}${search}${hash}`,
    searchRecord,
  };
}

function toAbsoluteHref(href: string): string {
  if (typeof window === "undefined") return href;
  if (href.startsWith("http")) return href;
  return `${window.location.origin}${href}`;
}

function callbackUrlLooksReady(pathname: string, search: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized !== AUTH_CALLBACK_PATH) return false;
  return search.includes("code=") || search.includes("error=");
}

/**
 * OAuth callback must stay in-SPA on Capacitor — `location.replace` reloads index.html,
 * causes APP_SCRIPT_LOAD_ERROR, and leaves iOS mirror stuck on the boot splash.
 */
export async function navigateOAuthAppPath(path: string): Promise<"router" | "history" | "reload"> {
  const { href, pathname, search } = parseOAuthAppPath(path);
  const platform = detectPlatform();
  const absoluteHref = toAbsoluteHref(href);

  const navigate = navigateImpl ?? (await waitForNavigateImpl());
  if (navigate) {
    try {
      await navigate(path);
      if (
        platform.isCapacitor &&
        callbackUrlLooksReady(window.location.pathname, window.location.search)
      ) {
        return "router";
      }
      if (!platform.isCapacitor || pathname !== AUTH_CALLBACK_PATH) {
        return "router";
      }
    } catch {
      // fall through to history navigation
    }
  }

  window.history.replaceState(window.history.state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (callbackUrlLooksReady(pathname, search)) {
    return "history";
  }

  if (platform.isCapacitor && pathname === AUTH_CALLBACK_PATH) {
    console.warn("[auth] oauth callback router not ready — retrying history only", { href });
  }
  return "history";
}
