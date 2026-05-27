import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { MobileFrame } from "@/components/MobileFrame";
import { AuthSignInError } from "@/components/auth/AuthSignInError";
import { finishPostAuthRedirect } from "@/lib/auth-post-redirect";
import { completeSignInAfterAuth } from "@/lib/complete-sign-in";
import { resolveAuthenticatedHomePath } from "@/lib/post-auth-navigation";
import { getClientAuthSession } from "@/lib/auth-session";
import {
  readStashedOAuthRedirectTarget,
  stripOAuthParamsFromUrl,
} from "@/lib/auth-oauth";
import {
  logAuthCallbackOpened,
  logAuthError,
  logAuthSessionResult,
} from "@/lib/auth-debug";
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

function AuthCallback() {
  const routeSearch = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState("正在完成登入…");
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  const runCallback = async () => {
    const stashed = readStashedOAuthRedirectTarget();
    logAuthCallbackOpened();
    logAuthSessionResult(true, {
      step: "callback.begin",
      stashedRedirect: stashed,
    });

    const existing = await getClientAuthSession();
    if (existing?.user) {
      logAuthSessionResult(true, { step: "callback.skip_existing_session", userId: existing.user.id });
      clearPendingCallbackPath();
      stripOAuthParamsFromUrl();
      const next = await resolveAuthenticatedHomePath();
      finishPostAuthRedirect(next, (opts) => navigate({ to: opts.to, replace: opts.replace }));
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
      stripOAuthParamsFromUrl();
      const next = await resolveAuthenticatedHomePath();
      finishPostAuthRedirect(next, (opts) => navigate({ to: opts.to, replace: opts.replace }));
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

    stripOAuthParamsFromUrl();

    setStatus("正在建立個人資料…");
    await completeSignInAfterAuth(session.user.id);

    logAuthSessionResult(true, {
      provider: session.user.app_metadata?.provider ?? "oauth",
      method,
      userId: session.user.id,
      email: session.user.email ?? "(none)",
    });

    await getClientAuthSession();

    const next = await resolveAuthenticatedHomePath();
    logAuthSessionResult(true, { step: "navigate", next });
    finishPostAuthRedirect(next, (opts) => navigate({ to: opts.to, replace: opts.replace }));
    clearPendingCallbackPath();
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

    void (async () => {
      try {
        await runCallback();
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
            hint="請確認 Supabase Redirect URLs 已加入 roamie://auth/callback（與本機開發用 http://localhost:8080/auth/callback）"
            onRetry={() => {
              void resetToLoginScreen({
                reason: "oauth-callback-return-login",
                navigate: (opts) => navigate({ to: opts.to, replace: opts.replace ?? true }),
              });
            }}
            retryLabel="返回登入"
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
