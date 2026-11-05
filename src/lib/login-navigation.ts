import {
  finishPostAuthRedirect,
  getLastPostAuthDestination,
  type PostAuthRedirectSource,
} from "@/lib/auth-post-redirect";
import { loadOnboardingState } from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import {
  markStartupResolved,
  shouldSkipStartupNavigation,
} from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";
import { guardStartupTarget } from "@/lib/startup-navigation";
import { consumeAdminReturn } from "@/lib/admin/admin-route-boundary";
import { isSafeAppReturnPath, peekPendingAuthAction, resolvePendingAuthReturnPath, splitAppReturnPath } from "@/lib/auth-pending-action";

type RouterNavigate = (opts: {
  to: string;
  search?: Record<string, string>;
  replace?: boolean;
}) => void;

let postLoginNavigationCommitted = false;

/** 診斷：登入後跳轉被略過的原因（僅原因字串，不含使用者資料）。 */
function logPostLoginNavigationSkip(source: string, reason: string): void {
  console.info("[POST_LOGIN_NAV_SKIP]", { source, reason });
}

export function isPostLoginNavigationCommitted(): boolean {
  return postLoginNavigationCommitted;
}

export function resetPostLoginNavigation(): void {
  postLoginNavigationCommitted = false;
}

/**
 * 登入成功後唯一導向入口；同步先 commit，避免 useEffect 與 native sign-in 雙重 navigate。
 */
export async function navigateOnceAfterLogin(
  navigate: RouterNavigate,
  source: PostAuthRedirectSource,
): Promise<void> {
  if (postLoginNavigationCommitted) {
    logPostLoginNavigationSkip(source, "already_committed");
    return;
  }
  postLoginNavigationCommitted = true;

  const onboardingCompleted = await loadOnboardingState();

  const adminReturn = consumeAdminReturn();
  const pendingReturn = peekPendingAuthAction()?.sourcePath;
  const safePending = onboardingCompleted && pendingReturn && isSafeAppReturnPath(pendingReturn)
    ? resolvePendingAuthReturnPath(pendingReturn, onboardingCompleted, true)
    : null;
  const target =
    adminReturn ??
    safePending ??
    guardStartupTarget(
      await resolveStartupPath({ hasSession: true, skipLog: true, source }),
      source,
    );
  const { pathname, search } = splitAppReturnPath(target);

  const current = readBrowserPathname();
  if (shouldSkipStartupNavigation(current, pathname)) {
    logPostLoginNavigationSkip(source, "already_on_target");
    if (pathname === "/") {
      markStartupResolved("/");
    }
    return;
  }

  finishPostAuthRedirect(pathname, navigate, source, search);
  if (pathname === "/") {
    markStartupResolved("/");
  }
}

/**
 * 保險：登入已完成卻仍停在 callback 頁時，略過 once-commit 旗標強制導向一次。
 * 目標沿用最近一次的 post-auth target（含 search）；沒有時依 onboarding 狀態決定首頁或教學頁。
 * 不重新消費 pending action / admin return（第一次導向時已處理）。
 */
export function forceNavigateAfterLoginFallback(
  navigate: RouterNavigate,
  source: PostAuthRedirectSource,
): string {
  postLoginNavigationCommitted = true;
  const last = getLastPostAuthDestination();
  const target = last?.pathname ?? guardStartupTarget("/", source);
  finishPostAuthRedirect(target, navigate, source, last?.search);
  if (target === "/") {
    markStartupResolved("/");
  }
  return target;
}
