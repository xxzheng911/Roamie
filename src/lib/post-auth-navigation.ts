import { getClientAuthSession } from "@/lib/auth-session";
import {
  getOnboardingStorageSource,
  isOnboardingCompletedSync,
  loadOnboardingState,
  logSkipOnboarding,
} from "@/lib/onboarding-storage";
import { isPreferenceQuizCompleted } from "@/lib/preferences-storage";
import {
  guardStartupTarget,
  logStartupNavigationContext,
  type StartupNavigationSource,
} from "@/lib/startup-navigation";

export type StartupPath = "/login" | "/welcome" | "/";

export type PostAuthPath = StartupPath;

type StartupOptions = {
  hasSession?: boolean;
  skipLog?: boolean;
  source?: StartupNavigationSource;
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
  const onboardingCompleted = isOnboardingCompletedSync();
  const isFirstLaunch = !onboardingCompleted;

  console.info("[Startup] launch flags", {
    isFirstLaunch,
    onboardingCompleted,
    storageSource: getOnboardingStorageSource(),
  });
  console.info("[Startup] auth status", {
    hasSession,
    loggedIn: hasSession,
    authReady: true,
    session: hasSession ? "present" : "none",
  });
  console.info("[Startup] dev mode", {
    isDev: import.meta.env.DEV,
  });
  console.info("[Startup] hasCompletedPreferenceQuiz", quizDone);
  console.info("[Startup] final route", next);
}

/**
 * 冷啟動 / 登入後應前往的路徑（僅讀本機 onboarding 狀態）：
 * 1) 本機 onboarding 未完成 → /welcome（不受 auth / dev / profile 影響）
 * 2) onboarding 完成且未登入 → /login
 * 3) onboarding 完成且已登入 → /
 */
export async function resolveStartupPath(options?: StartupOptions): Promise<StartupPath> {
  if (typeof window === "undefined") return "/login";

  const source = options?.source ?? "resolveStartupPath";
  let hasSession = options?.hasSession;

  await loadOnboardingState();

  const onboardingCompleted = isOnboardingCompletedSync();

  if (!onboardingCompleted) {
    const next = guardStartupTarget("/welcome", source);
    await logStartupState(next, options);
    await logStartupNavigationContext(source, next);
    return next;
  }

  if (hasSession === undefined) {
    hasSession = !!(await getClientAuthSession());
  }

  if (!hasSession) {
    const next = guardStartupTarget("/login", source);
    await logStartupState(next, options);
    await logStartupNavigationContext(source, next);
    return next;
  }

  logSkipOnboarding(source);

  const next = guardStartupTarget("/", source);
  await logStartupState(next, options);
  await logStartupNavigationContext(source, next);
  return next;
}

/** @deprecated 使用 resolveStartupPath；保留給既有登入 callback */
export async function resolveAuthenticatedHomePath(
  options?: Pick<StartupOptions, "source" | "skipLog">,
): Promise<PostAuthPath> {
  return resolveStartupPath(options);
}
