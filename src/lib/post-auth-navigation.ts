import { getClientAuthSession } from "@/lib/auth-session";
import { hasSelectedCompanionMode } from "@/lib/companion-mode-storage";
import { isIntroCompleted } from "@/lib/plan-tier";
import { isPreferenceQuizCompleted } from "@/lib/preferences-storage";

export type StartupPath = "/login" | "/welcome" | "/";

export type PostAuthPath = StartupPath;

type StartupOptions = {
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

  let hasSession = options?.hasSession;
  if (hasSession === undefined) {
    hasSession = !!(await getClientAuthSession());
  }

  const quizDone = await withTimeout(isPreferenceQuizCompleted(), false);

  console.info("[Startup] auth status", {
    hasSession,
    loggedIn: hasSession,
  });
  console.info("[Startup] hasSelectedCompanionMode", hasSelectedCompanionMode());
  console.info("[Startup] hasCompletedPreferenceQuiz", quizDone);
  console.info("[Startup] next route", next);
}

/**
 * 冷啟動 / 登入後應前往的路徑：
 * 固定三段式：
 * 1) 未登入 → /login
 * 2) 已登入未選陪伴方式 → /welcome
 * 3) 已登入且已選陪伴方式 → /
 */
export async function resolveStartupPath(options?: StartupOptions): Promise<StartupPath> {
  if (typeof window === "undefined") return "/login";

  let hasSession = options?.hasSession;

  if (hasSession === undefined) {
    hasSession = !!(await getClientAuthSession());
  }

  if (!hasSession) {
    const next: StartupPath = "/login";
    await logStartupState(next, options);
    return next;
  }

  const introDone =
    hasSelectedCompanionMode() || (await withTimeout(isIntroCompleted(), false));
  if (!introDone) {
    const next: StartupPath = "/welcome";
    await logStartupState(next, options);
    return next;
  }

  const next: StartupPath = "/";
  await logStartupState(next, options);
  return next;
}

/** @deprecated 使用 resolveStartupPath；保留給既有登入 callback */
export async function resolveAuthenticatedHomePath(): Promise<PostAuthPath> {
  return resolveStartupPath();
}
