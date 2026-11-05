import { useI18n } from "@/hooks/use-i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import { AuthSignInError } from "@/components/auth/AuthSignInError";
import { forceNavigateAfterLoginFallback, navigateOnceAfterLogin } from "@/lib/login-navigation";
import { AUTH_CALLBACK_PATH } from "@/constants/auth-redirect";
import { readBrowserPathname } from "@/lib/startup-path";
import { completeSignInAfterAuth } from "@/lib/complete-sign-in";
import { getClientAuthSession } from "@/lib/auth-session";
import { readStashedOAuthRedirectTarget, stripOAuthParamsFromUrl } from "@/lib/auth-oauth";
import { logAuthCallbackOpened, logAuthError, logAuthSessionResult } from "@/lib/auth-debug";
import { resolveSessionFromCallbackUrl } from "@/lib/auth-session-from-url";
import { clearPendingCallbackPath } from "@/lib/auth-oauth-deep-link";
import { clearAuthState, resetToLoginScreen } from "@/lib/clear-auth-state";
import {
  extractOAuthCodeFromPath,
  isOAuthCodeAlreadyConsumed,
  markOAuthCodeConsumed,
} from "@/lib/oauth-callback-guard";
import {
  bindIosInteractiveRoute,
  ensureIosLoginLiveInteraction,
  notifyIosOAuthReturn,
  scheduleIosSnapshotRefreshBurst,
} from "@/lib/ios-snapshot-bridge";

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  component: AuthCallback,
});

/** 登入完成後仍停在 callback 頁超過此時間，且已有 session，就強制導向一次。 */
const AUTH_CALLBACK_STUCK_FALLBACK_MS = 5_000;

/** 每次 AuthCallback 開始處理就遞增；保險 timer 只對最新一次嘗試生效。 */
let callbackAttemptSeq = 0;

function isStillOnCallbackRoute(): boolean {
  return readBrowserPathname() === AUTH_CALLBACK_PATH;
}

/**
 * 只在仍停留 callback 且網址真的帶參數時才清除。
 * stripOAuthParamsFromUrl 會以 history.replaceState 寫回 /auth/callback；TanStack history
 * 攔截 replaceState 後會觸發 router.load()，若此時已開始導向首頁（例如 remount 後的
 * 新 instance 走 skip_existing_session），會把進行中的導向中止並拉回 callback。
 */
function stripOAuthParamsIfStillOnCallback(step: string): void {
  if (typeof window === "undefined") return;
  if (!isStillOnCallbackRoute()) {
    console.info("[AUTH_CALLBACK_STRIP_SKIP]", { step, reason: "left_callback_route" });
    return;
  }
  if (!window.location.search && !window.location.hash) return;
  stripOAuthParamsFromUrl();
}

function AuthCallback() {
  const { t: uiT } = useI18n();

  const routeSearch = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState("正在完成登入…");
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);
  const stuckTimerRef = useRef<number | null>(null);

  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (stuckTimerRef.current != null) {
        window.clearTimeout(stuckTimerRef.current);
        stuckTimerRef.current = null;
      }
    };
  }, []);

  const finishAuthRedirect = async (step: string) => {
    logAuthSessionResult(true, { step: `callback.redirect.${step}` });
    await navigateOnceAfterLogin(
      (opts) => navigate({ to: opts.to, search: opts.search, replace: opts.replace }),
      "auth-callback",
    );
  };

  const runCallback = async () => {
    const stashed = readStashedOAuthRedirectTarget();
    logAuthCallbackOpened();
    logAuthSessionResult(true, {
      step: "callback.begin",
      stashedRedirect: stashed,
    });

    const existing = await getClientAuthSession();
    if (existing?.user) {
      logAuthSessionResult(true, {
        step: "callback.skip_existing_session",
        userId: existing.user.id,
      });
      clearPendingCallbackPath();
      stripOAuthParamsIfStillOnCallback("skip_existing_session");
      await finishAuthRedirect("skip_existing_session");
      return;
    }

    const code =
      routeSearch.code ??
      (typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("code")
        : null);
    if (code && isOAuthCodeAlreadyConsumed(code)) {
      logAuthSessionResult(true, { step: "callback.skip_consumed_code" });
      clearPendingCallbackPath();
      stripOAuthParamsIfStillOnCallback("skip_consumed_code");
      await finishAuthRedirect("skip_consumed_code");
      return;
    }

    setStatus("正在驗證登入…");
    const { session, method } = await resolveSessionFromCallbackUrl(routeSearch);

    if (code) {
      markOAuthCodeConsumed(code);
    } else {
      const fromPath = extractOAuthCodeFromPath(window.location.pathname + window.location.search);
      if (fromPath) markOAuthCodeConsumed(fromPath);
    }

    stripOAuthParamsIfStillOnCallback("oauth_exchanged");

    setStatus("正在建立個人資料…");
    await completeSignInAfterAuth(session.user.id);

    logAuthSessionResult(true, {
      provider: session.user.app_metadata?.provider ?? "oauth",
      method,
      userId: session.user.id,
      email: session.user.email ?? "(none)",
    });

    await getClientAuthSession();

    // 導向前先清 pending：離開 callback 時整棵 AppProviders 會 remount，
    // OAuthRouterBridge 重新掛載時不能再讀到這筆 pending 而把路由拉回 callback。
    clearPendingCallbackPath();
    await finishAuthRedirect("oauth_complete");
  };

  const scheduleStuckFallback = (attemptId: number) => {
    // runCallback 可能在元件卸載後才 resolve；此時 cleanup 已跑過，排了也清不到。
    if (!mountedRef.current) return;
    if (attemptId !== callbackAttemptSeq) return;
    if (stuckTimerRef.current != null) return;
    const startedAt = Date.now();
    const isSameAttempt = () => mountedRef.current && attemptId === callbackAttemptSeq;
    stuckTimerRef.current = window.setTimeout(() => {
      stuckTimerRef.current = null;
      if (!isSameAttempt()) return;
      if (!isStillOnCallbackRoute()) return;
      void (async () => {
        const session = await getClientAuthSession().catch(() => null);
        if (!isSameAttempt()) return;
        if (!isStillOnCallbackRoute()) return;
        if (!session?.user) {
          // 沒有 session 不假裝成功：維持原畫面，由既有錯誤／重試流程處理。
          console.info("[AUTH_CALLBACK_STUCK_FALLBACK_SKIP]", { reason: "no_session" });
          return;
        }
        const target = forceNavigateAfterLoginFallback(
          (opts) => navigate({ to: opts.to, search: opts.search, replace: opts.replace }),
          "auth-callback",
        );
        console.warn("[AUTH_CALLBACK_STUCK_FALLBACK]", {
          elapsedMs: Date.now() - startedAt,
          targetRoute: target,
        });
      })();
    }, AUTH_CALLBACK_STUCK_FALLBACK_MS);
  };

  useLayoutEffect(() => {
    notifyIosOAuthReturn();
    return bindIosInteractiveRoute("auth-callback");
  }, []);

  useLayoutEffect(() => {
    if (!error) return;
    notifyIosOAuthReturn();
    ensureIosLoginLiveInteraction();
    scheduleIosSnapshotRefreshBurst("auth-callback-error");
  }, [error]);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    let cancelled = false;

    const attemptId = ++callbackAttemptSeq;

    void (async () => {
      try {
        await runCallback();
        scheduleStuckFallback(attemptId);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "登入失敗，請再試一次。";
        logAuthError("callback.failed", e, { stashedRedirect: readStashedOAuthRedirectTarget() });
        await clearAuthState({
          reason: "oauth-callback-failed",
        });
        setError(msg);
        setStatus("");
        clearPendingCallbackPath();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <MobileFrame>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
          <AuthSignInError
            message={error}
            hint={uiT("productionUi.signInRetryHint")}
            onRetry={() => {
              void resetToLoginScreen({
                reason: "oauth-callback-return-login",
                navigate: (opts) => navigate({ to: opts.to, replace: opts.replace ?? true }),
              });
            }}
            retryLabel={uiT("productionUi.pedccf5e77a")}
          />
        </div>
      </MobileFrame>
    );
  }

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </MobileFrame>
  );
}
