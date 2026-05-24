import { redirect } from "@tanstack/react-router";
import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { hasSeenOnboarding, hydrateOnboardingStorage } from "@/lib/app-onboarding-storage";
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

  await hydrateOnboardingStorage();

  if (hasSeenOnboarding()) {
    const guest = readGuestFlag();
    const session = guest ? null : await getClientAuthSession();
    const next = await resolveStartupPath({
      isGuest: guest,
      hasSession: !!session,
    });
    throw redirect({ to: next });
  }
}

/** 偏好測驗：自願進入；須先完成品牌教學，from=profile 另需訪客或登入 */
export async function requirePreferenceQuizRouteAccess(from?: string): Promise<void> {
  if (typeof window === "undefined") return;

  if (from === "profile") {
    await requireGuestOrAuthenticatedRoute();
    return;
  }

  await hydrateOnboardingStorage();

  if (!hasSeenOnboarding()) {
    throw redirect({ to: "/intro" });
  }
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
export async function requireAppShellAccess(): Promise<void> {
  if (typeof window === "undefined") return;

  await hydrateOnboardingStorage();

  const guest = readGuestFlag();
  const session = await getClientAuthSession();

  const next = await resolveStartupPath({ isGuest: guest, hasSession: !!session });
  if (next !== "/") {
    redirectToStartupTarget(next);
  }
}
