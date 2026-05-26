import { isRedirect, redirect } from "@tanstack/react-router";
import { getClientAuthSession } from "@/lib/auth-session";
import { logAppError } from "@/lib/log-error";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import type { StartupPath } from "@/lib/post-auth-navigation";
import { resolveStartupPathFast } from "@/lib/startup-route";

/** 僅限已登入 Supabase（訪客不可進 welcome / 帳號設定等） */
export async function requireAuthenticatedRoute(): Promise<void> {
  if (typeof window === "undefined") return;
  const session = await getClientAuthSession();
  if (!session) {
    throw redirect({ to: "/login" });
  }
}

/** @deprecated 已移除訪客模式，等同 requireAuthenticatedRoute */
export async function requireGuestOrAuthenticatedRoute(): Promise<void> {
  return requireAuthenticatedRoute();
}

/** 偏好測驗：自願進入；需已登入 */
export async function requirePreferenceQuizRouteAccess(from?: string): Promise<void> {
  if (typeof window === "undefined") return;

  await requireAuthenticatedRoute();
}

function redirectToStartupTarget(next: StartupPath): never {
  if (next === "/") {
    throw redirect({ to: "/" });
  }
  throw redirect({ to: next });
}

/**
 * 主 App 殼層：須完成品牌教學；已登入使用者須完成 Plus 導覽。
 * 旅行偏好測驗不在此 gate 內，由使用者自願進入。
 */
const SHELL_GATE_TIMEOUT_MS = 5_000;

export async function requireAppShellAccess(): Promise<void> {
  if (typeof window === "undefined") return;

  const fastNext = resolveStartupPathFast();
  if (fastNext !== "/") {
    redirectToStartupTarget(fastNext);
  }

  try {
    const session = await Promise.race([
      getClientAuthSession(),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), SHELL_GATE_TIMEOUT_MS);
      }),
    ]);

    if (!session) {
      throw redirect({ to: "/login" });
    }

    const next = await Promise.race([
      resolveStartupPath({ hasSession: true }),
      new Promise<StartupPath>((resolve) => {
        window.setTimeout(() => resolve("/"), SHELL_GATE_TIMEOUT_MS);
      }),
    ]);

    if (next !== "/") {
      redirectToStartupTarget(next);
    }
  } catch (e) {
    if (isRedirect(e)) throw e;
    logAppError("[requireAppShellAccess] gate failed", e);
    throw redirect({ to: "/login" });
  }
}
