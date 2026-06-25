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
import { guardStartupTarget, logStartupNavigationContext } from "@/lib/startup-navigation";
import {
  isBootCompleted,
  markStartupResolved,
  shouldSkipStartupNavigation,
} from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { hasLikelyPersistedSession } from "@/lib/startup-route";
import { detectPlatform } from "@/services/platform";

const AUTH_ROUTE_TIMEOUT_MS = 4_000;
const NATIVE_SHELL_GATE_TIMEOUT_MS = 12_000;

function blockGuestAccess(reason: string, target: StartupPath = "/login"): never {
  logAuthRedirectLogin(reason, { target });
  logAuthFlowMarker("[Auth Guard Blocked Guest Access]", { reason, target });
  throw redirect({ to: target });
}

async function raceSessionRead(timeoutMs: number): Promise<Session | null> {
  return Promise.race([
    getClientAuthSession({ timeoutMs }),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs);
    }),
  ]);
}

/** 讀取 session；本機有 token 時重試，避免 timeout 誤判未登入 */
async function resolveAppShellSession(timeoutMs: number): Promise<Session | null> {
  let session = await raceSessionRead(timeoutMs);
  if (session?.user) return session;

  if (!hasLikelyPersistedSession()) return null;

  if (detectPlatform().isCapacitor) {
    await warmSupabaseAuthStorage();
  }
  const retryTimeout = Math.max(timeoutMs, NATIVE_SHELL_GATE_TIMEOUT_MS);
  session = await raceSessionRead(retryTimeout);
  return session?.user ? session : null;
}

function shouldDeferLoginRedirect(): boolean {
  return hasLikelyPersistedSession();
}

/** 僅限已登入 Supabase */
export async function requireAuthenticatedRoute(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    markBootPhase("gate:requireAuthenticatedRoute:start");
  } catch {
    // ignore
  }
  const session = await resolveAppShellSession(AUTH_ROUTE_TIMEOUT_MS);
  if (!session?.user) {
    if (shouldDeferLoginRedirect()) {
      console.warn("[requireAuthenticatedRoute] session read pending — defer login redirect");
      return;
    }
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
function shellGateTimeoutMs(): number {
  return detectPlatform().isCapacitor ? NATIVE_SHELL_GATE_TIMEOUT_MS : 5_000;
}

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

    const gateTimeout = shellGateTimeoutMs();
    const session = await resolveAppShellSession(gateTimeout);
    const bootCompleted = isBootCompleted();

    // 冷啟動已完成：App 內導覽（首頁 → 聊天／心情）不再跑 startup redirect
    if (bootCompleted) {
      if (session?.user) {
        try {
          markBootPhase("gate:requireAppShellAccess:skip:in-app-nav");
        } catch {
          // ignore
        }
        return;
      }
      if (shouldDeferLoginRedirect()) {
        console.warn(
          "[requireAppShellAccess] boot-completed: persisted session — allow in-app navigation",
        );
        return;
      }
      try {
        markBootPhase("gate:requireAppShellAccess:redirect:/login");
      } catch {
        // ignore
      }
      blockGuestAccess("requireAppShellAccess:boot-completed-signed-out");
    }

    const currentPath = readBrowserPathname();
    if (shouldSkipStartupNavigation(currentPath, "/")) {
      if (session?.user) {
        markStartupResolved("/");
        try {
          markBootPhase("gate:requireAppShellAccess:skip:already-home");
        } catch {
          // ignore
        }
        return;
      }
    }

    if (!session?.user) {
      if (shouldDeferLoginRedirect()) {
        console.warn(
          "[requireAppShellAccess] cold-start: session initializing — defer login redirect",
        );
        markStartupResolved("/");
        return;
      }
      try {
        markBootPhase("gate:requireAppShellAccess:redirect:/login");
      } catch {
        // ignore
      }
      blockGuestAccess("requireAppShellAccess:no-session");
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
    if (isBootCompleted() && shouldDeferLoginRedirect()) {
      console.warn("[requireAppShellAccess] gate error with persisted session — allow navigation");
      return;
    }
    try {
      markBootPhase("gate:requireAppShellAccess:error->/login");
    } catch {
      // ignore
    }
    blockGuestAccess("requireAppShellAccess:error");
  }
}
