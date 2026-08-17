import type { Session } from "@supabase/supabase-js";
import { isRedirect, redirect } from "@tanstack/react-router";
import { getClientAuthSession } from "@/lib/auth-session";
import { logAuthRedirectLogin } from "@/lib/auth-boot-log";
import { logAuthFlowMarker } from "@/lib/clear-auth-state";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { logAppError } from "@/lib/log-error";
import { isOnboardingCompletedSync, loadOnboardingState } from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import type { StartupPath } from "@/lib/post-auth-navigation";
import {
  authRestoreTimeoutMs,
  authShellGateTimeoutMs,
  decideAppShellAfterAuthRestore,
} from "@/lib/auth-restore";
import { guardStartupTarget, logStartupNavigationContext } from "@/lib/startup-navigation";
import {
  isBootCompleted,
  markStartupResolved,
  shouldSkipStartupNavigation,
} from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { detectPlatform } from "@/services/platform";

function blockGuestAccess(reason: string, target: StartupPath = "/login"): never {
  logAuthRedirectLogin(reason, { target });
  logAuthFlowMarker("[Auth Guard Blocked Guest Access]", { reason, target });
  throw redirect({ to: target });
}

async function resolveAppShellSession(timeoutMs: number): Promise<Session | null> {
  const session = await getClientAuthSession({ timeoutMs });
  return session?.user ? session : null;
}

/** 僅限已登入 Supabase */
export async function requireAuthenticatedRoute(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    markBootPhase("gate:requireAuthenticatedRoute:start");
  } catch {
    // ignore
  }
  const session = await resolveAppShellSession(authRestoreTimeoutMs(detectPlatform().isCapacitor));
  if (!session?.user) {
    try {
      markBootPhase("gate:requireAuthenticatedRoute:redirect:/login");
    } catch {
      // ignore
    }
    blockGuestAccess("requireAuthenticatedRoute:no-session");
  }
}

/** 偏好測驗：自願進入；需已登入 */
export async function requirePreferenceQuizRouteAccess(from?: string): Promise<void> {
  if (typeof window === "undefined") return;

  void from;
  await requireAuthenticatedRoute();
}

function redirectToStartupTarget(next: StartupPath): never {
  if (next === "/") {
    throw redirect({ to: "/" });
  }
  throw redirect({ to: next });
}

/**
 * 主 App 殼層：須有有效 Supabase session；未登入一律 /login。
 * 不以 localStorage 快取或 companion 本機旗標代替登入。
 */
export async function requireAppShellAccess(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    markBootPhase("gate:requireAppShellAccess:start");
  } catch {
    // ignore
  }

  try {
    if (detectPlatform().isCapacitor) {
      await warmSupabaseAuthStorage();
    }
    await loadOnboardingState();

    if (!isOnboardingCompletedSync()) {
      try {
        markBootPhase("gate:requireAppShellAccess:redirect:/welcome");
      } catch {
        // ignore
      }
      console.log("[ONBOARDING_GUARD] blocked home redirect", {
        source: "requireAppShellAccess",
        targetRoute: "/welcome",
        reason: "onboarding_incomplete",
      });
      void logStartupNavigationContext("requireAppShellAccess", "/welcome", {
        reason: "onboarding_incomplete",
      });
      throw redirect({ to: "/welcome" });
    }

    const gateTimeout = authShellGateTimeoutMs(detectPlatform().isCapacitor);
    const session = await resolveAppShellSession(gateTimeout);
    const decision = decideAppShellAfterAuthRestore({
      onboardingCompleted: true,
      hasSessionUser: Boolean(session?.user),
    });

    if (decision.kind === "login") {
      try {
        markBootPhase("gate:requireAppShellAccess:redirect:/login");
      } catch {
        // ignore
      }
      blockGuestAccess(
        isBootCompleted()
          ? "requireAppShellAccess:boot-completed-signed-out"
          : "requireAppShellAccess:no-session",
      );
    }

    const bootCompleted = isBootCompleted();

    // 冷啟動已完成：App 內導覽（首頁 → 聊天／心情）不再跑 startup redirect
    if (bootCompleted) {
      try {
        markBootPhase("gate:requireAppShellAccess:skip:in-app-nav");
      } catch {
        // ignore
      }
      return;
    }

    const currentPath = readBrowserPathname();
    if (shouldSkipStartupNavigation(currentPath, "/")) {
      markStartupResolved("/");
      try {
        markBootPhase("gate:requireAppShellAccess:skip:already-home");
      } catch {
        // ignore
      }
      return;
    }

    const next = guardStartupTarget(
      await resolveStartupPath({ hasSession: true, source: "requireAppShellAccess" }),
      "requireAppShellAccess",
    );

    if (next !== "/") {
      try {
        markBootPhase(`gate:requireAppShellAccess:redirect:${next}`);
      } catch {
        // ignore
      }
      redirectToStartupTarget(next);
    }

    markStartupResolved("/");
  } catch (e) {
    if (isRedirect(e)) throw e;
    logAppError("[requireAppShellAccess] gate failed", e);
    try {
      markBootPhase("gate:requireAppShellAccess:error->/login");
    } catch {
      // ignore
    }
    blockGuestAccess("requireAppShellAccess:error");
  }
}
