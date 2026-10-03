import { finishPostAuthRedirect, type PostAuthRedirectSource } from "@/lib/auth-post-redirect";
import { loadOnboardingState } from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import {
  markStartupResolved,
  shouldSkipStartupNavigation,
} from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";
import { guardStartupTarget } from "@/lib/startup-navigation";
import { consumeAdminReturn } from "@/lib/admin/admin-route-boundary";
import { isSafeAppReturnPath, peekPendingAuthAction, splitAppReturnPath } from "@/lib/auth-pending-action";

type RouterNavigate = (opts: {
  to: string;
  search?: Record<string, string>;
  replace?: boolean;
}) => void;

let postLoginNavigationCommitted = false;

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
  if (postLoginNavigationCommitted) return;
  postLoginNavigationCommitted = true;

  await loadOnboardingState();

  const adminReturn = consumeAdminReturn();
  const pendingReturn = peekPendingAuthAction()?.sourcePath;
  const safePending = pendingReturn && isSafeAppReturnPath(pendingReturn) ? pendingReturn : null;
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
