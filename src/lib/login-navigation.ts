import { finishPostAuthRedirect, type PostAuthRedirectSource } from "@/lib/auth-post-redirect";
import { loadOnboardingState } from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import {
  markStartupResolved,
  shouldSkipStartupNavigation,
} from "@/lib/startup-boot-state";
import { readBrowserPathname } from "@/lib/startup-path";
import { guardStartupTarget } from "@/lib/startup-navigation";

type RouterNavigate = (opts: { to: string; replace?: boolean }) => void;

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

  const target = guardStartupTarget(
    await resolveStartupPath({ hasSession: true, skipLog: true, source }),
    source,
  );

  const current = readBrowserPathname();
  if (shouldSkipStartupNavigation(current, target)) {
    if (target === "/") {
      markStartupResolved("/");
    }
    return;
  }

  finishPostAuthRedirect(target, navigate, source);
  if (target === "/") {
    markStartupResolved("/");
  }
}
