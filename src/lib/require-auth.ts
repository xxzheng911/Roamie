import { isRedirect, redirect } from "@tanstack/react-router";
import { getClientAuthSession } from "@/lib/auth-session";
import { logAuthFlowMarker } from "@/lib/clear-auth-state";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { logAppError } from "@/lib/log-error";
import { isOnboardingCompletedSync, loadOnboardingState } from "@/lib/onboarding-storage";
import type { StartupPath } from "@/lib/post-auth-navigation";
import {
  invalidateAppShellGateCache,
  markAppShellGatePassed,
  peekAppShellGateCache,
} from "@/lib/app-shell-gate";
import { logStartupNavigationContext } from "@/lib/startup-navigation";
import { buildAccessSnapshot } from "@/lib/access";
import { getUserPlanProfile } from "@/lib/plan-tier/storage";
import { detectPlatform } from "@/services/platform";

const AUTH_ROUTE_TIMEOUT_MS = 4_000;

function blockGuestAccess(reason: string, target: StartupPath = "/login"): never {
  logAuthFlowMarker("[Auth Guard Blocked Guest Access]", { reason, target });
  throw redirect({ to: target });
}

/** 僅限已登入 Supabase */
export async function requireAuthenticatedRoute(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    markBootPhase("gate:requireAuthenticatedRoute:start");
  } catch {
    // ignore
  }
  const session = await Promise.race([
    getClientAuthSession(),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), AUTH_ROUTE_TIMEOUT_MS);
    }),
  ]);
  if (!session?.user) {
    try {
      markBootPhase("gate:requireAuthenticatedRoute:redirect:/login");
    } catch {
      // ignore
    }
    blockGuestAccess("requireAuthenticatedRoute:no-session");
  }
}

const QUIZ_GATE_TIMEOUT_MS = 5_000;

/** 偏好測驗：Plus 專屬；需已登入（與 useAccess / 開發者模式判斷一致） */
export async function requirePreferenceQuizRouteAccess(from?: string): Promise<void> {
  if (typeof window === "undefined") return;

  void from;
  await requireAuthenticatedRoute();

  const session = await Promise.race([
    getClientAuthSession(),
    new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), QUIZ_GATE_TIMEOUT_MS);
    }),
  ]);

  let profilePlusActive = false;
  if (session?.user?.id) {
    try {
      const plan = await Promise.race([
        getUserPlanProfile(session.user.id),
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), QUIZ_GATE_TIMEOUT_MS);
        }),
      ]);
      if (plan) {
        profilePlusActive =
          plan.planTier === "plus" &&
          (plan.subscriptionStatus === "active" || plan.subscriptionStatus === "trialing");
      } else {
        console.warn("[TRAVEL_PREF_TEST] plan profile read timed out");
      }
    } catch (e) {
      console.warn("[TRAVEL_PREF_TEST] plan profile read failed", e);
    }
  }

  const snapshot = buildAccessSnapshot(session?.user?.email ?? null, { profilePlusActive });
  if (!snapshot.hasPlusAccess) {
    console.info("[TRAVEL_PREF_TEST] blocked tier=", snapshot.effectiveTier);
    throw redirect({ to: "/profile", replace: false });
  }
  console.info("[TRAVEL_PREF_TEST] access ok");
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
/** 須 ≥ getClientAuthSession 冷啟動逾時，否則有 token 仍被誤判未登入 */
function shellGateTimeoutMs(): number {
  const { isCapacitor } = detectPlatform();
  return isCapacitor ? 12_000 : 5_000;
}

export async function requireAppShellAccess(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    markBootPhase("gate:requireAppShellAccess:start");
  } catch {
    // ignore
  }

  try {
    await loadOnboardingState();

    if (!isOnboardingCompletedSync()) {
      invalidateAppShellGateCache();
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
      logStartupNavigationContext("requireAppShellAccess", "/welcome", {
        reason: "onboarding_incomplete",
      }).catch(() => {});
      throw redirect({ to: "/welcome" });
    }

    const session = await Promise.race([
      getClientAuthSession(),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), shellGateTimeoutMs());
      }),
    ]);

    if (!session?.user) {
      invalidateAppShellGateCache();
      try {
        markBootPhase("gate:requireAppShellAccess:redirect:/login");
      } catch {
        // ignore
      }
      blockGuestAccess("requireAppShellAccess:no-session");
    }

    if (peekAppShellGateCache(session.user.id)) {
      return;
    }

    markAppShellGatePassed(session.user.id);
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
