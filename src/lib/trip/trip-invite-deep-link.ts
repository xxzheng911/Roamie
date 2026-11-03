import { App } from "@capacitor/app";
import { APP_SCHEME } from "@/constants/app";
import { detectPlatform } from "@/services/platform";
import { logAppError } from "@/lib/log-error";
import { waitForCapacitorBridge } from "@/lib/capacitor-bridge-ready";
import { stashTripInviteToken } from "@/lib/trip/trip-collab";

const TRIP_INVITE_HOST = "trip-invite";
const TRIP_INVITE_PATH_PREFIX = "/trip-invite/";
/** Universal Link 網域（含 www） */
const TRIP_INVITE_WEB_HOSTS = new Set(["roamie.tw", "www.roamie.tw"]);

function tokenFromInvitePath(pathname: string): string | null {
  if (!pathname.startsWith(TRIP_INVITE_PATH_PREFIX)) return null;
  const raw = pathname.slice(TRIP_INVITE_PATH_PREFIX.length).replace(/\/+$/, "");
  if (!raw || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return null;
  }
}

export function parseTripInviteTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === TRIP_INVITE_HOST) {
      // 與 https 規則一致：只允許單一 token 段（可帶尾斜線／query），多段路徑一律拒絕。
      return tokenFromInvitePath(`/trip-invite${parsed.pathname.startsWith("/") ? "" : "/"}${parsed.pathname}`);
    }
    if (parsed.protocol === "https:" && TRIP_INVITE_WEB_HOSTS.has(parsed.hostname.toLowerCase())) {
      return tokenFromInvitePath(parsed.pathname);
    }
    if (typeof window !== "undefined") {
      const origin = window.location.origin;
      if (parsed.origin === origin) {
        return tokenFromInvitePath(parsed.pathname);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function tripInvitePathFromToken(token: string): string {
  return `/trip-invite/${encodeURIComponent(token)}`;
}

let listenerAttached = false;

async function navigateToTripInvite(token: string, source: string): Promise<void> {
  stashTripInviteToken(token);
  const path = tripInvitePathFromToken(token);
  console.info("[TRIP_INVITE] deep link", {
    source,
    tokenPresent: true,
    tokenLength: token.length,
  });
  try {
    const { navigateOAuthAppPath } = await import("@/lib/oauth-app-navigate");
    await navigateOAuthAppPath(path);
  } catch (error) {
    logAppError("TRIP_INVITE_NAV", error, { source, tokenPresent: true });
    if (typeof window !== "undefined") {
      window.location.href = path;
    }
  }
}

function handleTripInviteUrl(url: string, source: string): boolean {
  const token = parseTripInviteTokenFromUrl(url);
  if (!token) return false;
  void navigateToTripInvite(token, source);
  return true;
}

export function attachTripInviteDeepLinkListener(): () => void {
  if (typeof window === "undefined") return () => {};
  const info = detectPlatform();
  if (!info.isCapacitor) return () => {};
  if (listenerAttached) return () => {};

  listenerAttached = true;
  const subs: Array<{ remove: () => Promise<void> | void }> = [];

  void (async () => {
    await waitForCapacitorBridge();
    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) handleTripInviteUrl(launch.url, "getLaunchUrl");
    } catch {
      // optional
    }

    try {
      subs.push(
        await App.addListener("appUrlOpen", (event) => {
          if (handleTripInviteUrl(event.url, "appUrlOpen")) return;
        }),
      );
    } catch (error) {
      listenerAttached = false;
      logAppError("TRIP_INVITE_LISTENER", error);
    }
  })();

  return () => {
    listenerAttached = false;
    for (const sub of subs) void sub.remove();
  };
}
