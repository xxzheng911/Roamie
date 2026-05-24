import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { hasSeenOnboarding } from "@/lib/app-onboarding-storage";
import { isIntroCompleted } from "@/lib/plan-tier";
import { isPreferenceQuizCompleted } from "@/lib/preferences-storage";

export type StartupPath = "/login" | "/intro" | "/onboarding" | "/welcome" | "/";

export type PostAuthPath = StartupPath;

type StartupOptions = {
  isGuest?: boolean;
  hasSession?: boolean;
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

/**
 * 冷啟動 / 登入後應前往的路徑：
 * 首次教學 (/intro) → 偏好測驗 (/onboarding) → 登入/訪客 → Free/Plus 導覽 → 首頁
 */
export async function resolveStartupPath(options?: StartupOptions): Promise<StartupPath> {
  if (typeof window === "undefined") return "/intro";

  if (!hasSeenOnboarding()) return "/intro";

  const quizDone = await withTimeout(isPreferenceQuizCompleted(), false);
  if (!quizDone) return "/onboarding";

  const guest = options?.isGuest ?? readGuestFlag();
  let hasSession = options?.hasSession;

  if (hasSession === undefined) {
    hasSession = guest ? false : !!(await getClientAuthSession());
  }

  if (!guest && !hasSession) return "/login";

  if (!guest && hasSession) {
    const introDone = await withTimeout(isIntroCompleted(), false);
    if (!introDone) return "/welcome";
  }

  return "/";
}

/** @deprecated 使用 resolveStartupPath；保留給既有登入 callback */
export async function resolveAuthenticatedHomePath(): Promise<PostAuthPath> {
  return resolveStartupPath();
}
