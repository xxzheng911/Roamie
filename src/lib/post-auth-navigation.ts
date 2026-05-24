import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { hasSeenOnboarding, hydrateOnboardingStorage } from "@/lib/app-onboarding-storage";
import { isIntroCompleted } from "@/lib/plan-tier";
import { isPreferenceQuizCompleted } from "@/lib/preferences-storage";

export type StartupPath = "/login" | "/intro" | "/onboarding" | "/welcome" | "/";

export type PostAuthPath = StartupPath;

type StartupOptions = {
  isGuest?: boolean;
  hasSession?: boolean;
  skipLog?: boolean;
};

const ASYNC_STEP_TIMEOUT_MS = 4_000;

async function withTimeout<T>(promise: Promise<T>, fallback: T, ms = ASYNC_STEP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function logStartupState(next: StartupPath, options?: StartupOptions): Promise<void> {
  if (options?.skipLog) return;
  if (typeof window === "undefined") return;

  await hydrateOnboardingStorage();

  const guest = options?.isGuest ?? readGuestFlag();
  let hasSession = options?.hasSession;
  if (hasSession === undefined) {
    hasSession = guest ? false : !!(await getClientAuthSession());
  }

  const quizDone = await withTimeout(isPreferenceQuizCompleted(), false);

  console.info("[Startup] auth status", {
    guest,
    hasSession,
    loggedIn: hasSession && !guest,
  });
  console.info("[Startup] hasSeenOnboarding", hasSeenOnboarding());
  console.info("[Startup] hasCompletedPreferenceQuiz", quizDone);
  console.info("[Startup] next route", next);
}

/**
 * 冷啟動 / 登入後應前往的路徑：
 * 首次教學 (/intro) → 登入/訪客 → Plus 導覽（已登入）→ 首頁
 * 旅行偏好測驗為自願功能，不在啟動流程中強制出現。
 */
export async function resolveStartupPath(options?: StartupOptions): Promise<StartupPath> {
  if (typeof window === "undefined") return "/intro";

  await hydrateOnboardingStorage();

  if (!hasSeenOnboarding()) {
    const next: StartupPath = "/intro";
    await logStartupState(next, options);
    return next;
  }

  const guest = options?.isGuest ?? readGuestFlag();
  let hasSession = options?.hasSession;

  if (hasSession === undefined) {
    hasSession = guest ? false : !!(await getClientAuthSession());
  }

  if (!guest && !hasSession) {
    const next: StartupPath = "/login";
    await logStartupState(next, options);
    return next;
  }

  if (!guest && hasSession) {
    const introDone = await withTimeout(isIntroCompleted(), false);
    if (!introDone) {
      const next: StartupPath = "/welcome";
      await logStartupState(next, options);
      return next;
    }
  }

  const next: StartupPath = "/";
  await logStartupState(next, options);
  return next;
}

/** @deprecated 使用 resolveStartupPath；保留給既有登入 callback */
export async function resolveAuthenticatedHomePath(): Promise<PostAuthPath> {
  return resolveStartupPath();
}
