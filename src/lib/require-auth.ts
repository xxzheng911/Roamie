import { redirect } from "@tanstack/react-router";
import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { hasSeenOnboarding } from "@/lib/app-onboarding-storage";
import { shouldShowBootstrapSplash } from "@/lib/bootstrap-splash";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import type { StartupPath } from "@/lib/post-auth-navigation";

/** 僅限已登入 Supabase（訪客不可進 welcome / 帳號設定等） */
export async function requireAuthenticatedRoute(): Promise<void> {
  if (typeof window === "undefined") return;
  if (readGuestFlag()) {
    const next = await resolveStartupPath({ isGuest: true, hasSession: false });
    throw redirect({ to: next });
  }
  const session = await getClientAuthSession();
  if (!session) {
    throw redirect({ to: "/login" });
  }
}

/** 訪客或已登入（例如從個人檔案重作偏好測驗） */
export async function requireGuestOrAuthenticatedRoute(): Promise<void> {
  if (typeof window === "undefined") return;
  if (readGuestFlag()) return;
  const session = await getClientAuthSession();
  if (!session) {
    throw redirect({ to: "/login" });
  }
}

/** 首次使用教學：訪客與登入使用者皆可；未完成前不可跳過 */
export async function requireIntroRouteAccess(): Promise<void> {
  if (typeof window === "undefined") return;

  const guest = readGuestFlag();
  if (!guest) {
    const session = await getClientAuthSession();
    if (!session) throw redirect({ to: "/login" });
  }

  const next = await resolveStartupPath({ isGuest: guest, hasSession: !guest });
  if (next !== "/intro") {
    throw redirect({ to: next });
  }
}

/** 偏好測驗（startup funnel；from=profile 僅需訪客或登入） */
export async function requirePreferenceQuizRouteAccess(fromProfile: boolean): Promise<void> {
  if (typeof window === "undefined") return;

  if (fromProfile) {
    await requireGuestOrAuthenticatedRoute();
    return;
  }

  const guest = readGuestFlag();
  if (!guest) {
    const session = await getClientAuthSession();
    if (!session) throw redirect({ to: "/login" });
  }

  if (!hasSeenOnboarding()) {
    throw redirect({ to: "/intro" });
  }

  const next = await resolveStartupPath({ isGuest: guest, hasSession: !guest });
  if (next !== "/onboarding") {
    throw redirect({ to: next });
  }
}

function redirectToStartupTarget(next: StartupPath): never {
  if (next === "/") {
    throw redirect({ to: "/" });
  }
  if (shouldShowBootstrapSplash()) {
    throw redirect({ to: "/loading", search: { to: next } });
  }
  throw redirect({ to: next });
}

/**
 * 主 App 殼層：訪客與登入使用者皆須完成 onboarding funnel。
 * 未完成時直接導向目標頁（或僅首次經 /loading 顯示 splash），避免 / ↔ /loading 循環。
 */
export async function requireAppShellAccess(): Promise<void> {
  if (typeof window === "undefined") return;

  const guest = readGuestFlag();
  const session = await getClientAuthSession();

  if (!guest && !session) {
    throw redirect({ to: "/login" });
  }

  const next = await resolveStartupPath({ isGuest: guest, hasSession: !!session });
  if (next !== "/") {
    redirectToStartupTarget(next);
  }
}
