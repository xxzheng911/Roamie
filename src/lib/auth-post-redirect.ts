import { markSessionBootstrapped } from "@/components/StartupGate";
import { scheduleIosSnapshotRefreshBurst } from "@/lib/ios-snapshot-bridge";
import { ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import { canNavigateToHome } from "@/lib/startup-navigation";
import { detectPlatform } from "@/services/platform";

function toAbsoluteAppPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;
  return `${window.location.origin}${normalized}`;
}

type RouterNavigate = (opts: { to: string; replace?: boolean }) => void;

export type PostAuthRedirectSource =
  | "auth-post-redirect"
  | "auth-callback"
  | "login-session-restore";

/**
 * OAuth 完成後導向。Capacitor 優先用 in-app router，避免整頁 reload 白屏。
 * 主頁導向須本機 onboarding 已完成。
 */
export function finishPostAuthRedirect(
  path: string,
  navigate?: RouterNavigate,
  source: PostAuthRedirectSource = "auth-post-redirect",
): void {
  markSessionBootstrapped();

  const normalized = path.startsWith("/") ? path : `/${path}`;
  const currentRoute =
    typeof window !== "undefined"
      ? window.location.pathname.replace(/\/+$/, "") || "/"
      : normalized;

  if (normalized === "/" && !canNavigateToHome()) {
    console.log("[ONBOARDING_GUARD] blocked home redirect", {
      source,
      trigger: "finishPostAuthRedirect",
      attemptedRoute: normalized,
      redirectedTo: ONBOARDING_ROUTE,
      currentRoute,
      onboardingCompleted: false,
      reason: "onboarding_not_completed",
    });
    path = ONBOARDING_ROUTE;
  } else {
    console.info("[Startup Navigation Trigger]", {
      source,
      currentRoute,
      targetRoute: normalized,
      onboardingCompleted: canNavigateToHome(),
      trigger: "finishPostAuthRedirect",
    });
  }

  const target = path.startsWith("/") ? path : `/${path}`;
  const platform = detectPlatform();

  if (platform.isCapacitor && navigate) {
    if (platform.isIOS) {
      scheduleIosSnapshotRefreshBurst("post-auth");
    }
    navigate({ to: target, replace: true });
    return;
  }

  const url = toAbsoluteAppPath(target);
  if (platform.isCapacitor) {
    window.location.replace(url);
    return;
  }

  window.location.assign(url);
}
