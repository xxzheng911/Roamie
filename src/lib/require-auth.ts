import { isRedirect, redirect } from "@tanstack/react-router";
import { getClientAuthSession } from "@/lib/auth-session";
import { logAuthFlowMarker } from "@/lib/clear-auth-state";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { logAppError } from "@/lib/log-error";
import { hydrateOnboardingStatus } from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import type { StartupPath } from "@/lib/post-auth-navigation";

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
const SHELL_GATE_TIMEOUT_MS = 5_000;

export async function requireAppShellAccess(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    markBootPhase("gate:requireAppShellAccess:start");
  } catch {
    // ignore
  }

  try {
    const session = await Promise.race([
      getClientAuthSession(),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), SHELL_GATE_TIMEOUT_MS);
      }),
    ]);

    if (!session?.user) {
      try {
        markBootPhase("gate:requireAppShellAccess:redirect:/login");
      } catch {
        // ignore
      }
      blockGuestAccess("requireAppShellAccess:no-session");
    }

    await hydrateOnboardingStatus();

    const next = await Promise.race([
      resolveStartupPath({ hasSession: true }),
      new Promise<StartupPath>((resolve) => {
        window.setTimeout(() => resolve("/login"), SHELL_GATE_TIMEOUT_MS);
      }),
    ]);

    if (next !== "/") {
      try {
        markBootPhase(`gate:requireAppShellAccess:redirect:${next}`);
      } catch {
        // ignore
      }
      redirectToStartupTarget(next);
    }
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
