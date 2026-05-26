import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { OAUTH_PENDING_CALLBACK_KEY } from "@/lib/auth-oauth-deep-link";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
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

    setStatus("正在驗證登入…");
    const { session, method } = await resolveSessionFromCallbackUrl();

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
    try {
      sessionStorage.removeItem(OAUTH_PENDING_CALLBACK_KEY);
    } catch {
      // ignore
    }
  };

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
        setError(msg);
        setStatus("");
        try {
          sessionStorage.removeItem(OAUTH_PENDING_CALLBACK_KEY);
        } catch {
          // ignore
        }
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
            onRetry={() => navigate({ to: "/login", replace: true })}
            retryLabel="返回登入"
          />
          <Link
            to="/"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            先以訪客模式逛逛
          </Link>
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
