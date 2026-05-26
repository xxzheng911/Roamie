import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { LegalDocumentSheet } from "@/components/LegalDocumentSheet";
import { AuthSignInError } from "@/components/auth/AuthSignInError";
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from "@/content/legal";
import { isOAuthProviderEnabled } from "@/constants/auth";
import { signInWithProvider, type OAuthProvider } from "@/lib/auth-oauth";
import { formatSupabaseRedirectAllowListHint } from "@/lib/auth-redirect";
import { finishPostAuthRedirect } from "@/lib/auth-post-redirect";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import { useAuth } from "@/hooks/use-auth";
import { RoamieMascotFigure } from "@/components/onboarding/RoamieMascotFigure";
import { OAUTH_FLOW_EVENT, type OAuthFlowDetail } from "@/lib/auth-debug";

const isDev = import.meta.env.DEV;

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [legalOpen, setLegalOpen] = useState<"terms" | "privacy" | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading || redirectedRef.current) return;
    if (user) {
      redirectedRef.current = true;
      void resolveStartupPath({ hasSession: true }).then((to) => {
        navigate({ to, replace: true });
      });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const onOAuthFlow = (e: Event) => {
      const detail = (e as CustomEvent<OAuthFlowDetail>).detail;
      if (detail.phase === "cancelled") {
        setBusy(null);
        return;
      }
      if (detail.phase === "error") {
        setBusy(null);
        setAuthError(detail.message);
      }
    };
    window.addEventListener(OAUTH_FLOW_EVENT, onOAuthFlow);
    return () => window.removeEventListener(OAUTH_FLOW_EVENT, onOAuthFlow);
  }, []);

  const signIn = async (provider: OAuthProvider) => {
    setAuthError(null);

    if (!isOAuthProviderEnabled(provider)) {
      const msg =
        provider === "apple"
          ? "Apple 登入目前無法使用。請在 iOS App 上重試，或確認 Supabase 已啟用 Apple Provider。"
          : "此登入方式暫時無法使用。";
      setAuthError(msg);
      return;
    }

    setBusy(provider);
    toast.message(
      provider === "google"
        ? "正在開啟 Google 登入…"
        : provider === "apple"
          ? "正在使用 Apple 登入…"
          : "正在登入…",
    );

    try {
      const result = await signInWithProvider(provider);
      if (!result.ok) {
        setBusy(null);
        if (result.cancelled) return;
        let msg = result.message || "登入沒成功，待會再試一次。";
        if (/requested path is invalid|redirect url|nonces?\s*mismatch/i.test(msg)) {
          msg = `${msg}\n\n請確認 Supabase Redirect URLs 已加入：\n${formatSupabaseRedirectAllowListHint()}`;
        }
        setAuthError(msg);
        console.error("[auth] sign-in failed", { provider, message: msg });
        return;
      }

      const { canUseNativeAppleSignIn } = await import("@/lib/auth-apple-native");
      if (provider === "apple" && canUseNativeAppleSignIn()) {
        const next = await resolveStartupPath({ hasSession: true });
        setBusy(null);
        toast.success("登入成功");
        finishPostAuthRedirect(next, (opts) => navigate({ to: opts.to, replace: opts.replace }));
        return;
      }

      /* Google / Web Apple：等待 deep link → /auth/callback；busy 直到 browser 關閉或 callback */
    } catch (e) {
      console.error("[auth] sign-in threw", e);
      setBusy(null);
      setAuthError(e instanceof Error ? e.message : "登入沒成功，待會再試一次。");
    }
  };

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-[max(2.5rem,var(--safe-area-bottom))] pt-[max(2.5rem,var(--safe-area-top))]">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="login-mascot">
            <RoamieMascotFigure pose="wave" variant="quiz" motion="float" />
          </div>
          <h1 className="mt-6 font-display text-[28px] leading-tight">
            慢慢來，<br />
            Roamie 等你。
          </h1>
          <p className="mt-3 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
            登入後，我會記住你喜歡的步調、安靜的角落，還有那些不想被打擾的下午。
          </p>
        </div>

        <div className="space-y-3">
          {authError ? (
            <AuthSignInError
              variant="system"
              title="登入暫時沒有成功"
              message={authError}
              onRetry={() => setAuthError(null)}
              retryLabel="關閉"
            />
          ) : null}

          <button
            type="button"
            onClick={() => signIn("google")}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-4 text-[15px] font-medium text-background transition active:scale-[0.98] disabled:opacity-50"
          >
            <GoogleIcon /> {busy === "google" ? "Google 登入進行中…" : "使用 Google 繼續"}
          </button>

          <button
            type="button"
            onClick={() => signIn("apple")}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-4 text-[15px] font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50"
          >
            <AppleIcon /> {busy === "apple" ? "Apple 登入進行中…" : "以 Apple 登入"}
          </button>

          <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
            繼續即代表同意 Roamie 的
            <button
              type="button"
              onClick={() => setLegalOpen("terms")}
              className="mx-0.5 text-foreground underline underline-offset-2"
            >
              服務條款
            </button>
            與
            <button
              type="button"
              onClick={() => setLegalOpen("privacy")}
              className="mx-0.5 text-foreground underline underline-offset-2"
            >
              隱私權政策
            </button>
            。
          </p>

          {isDev ? (
            <button
              type="button"
              onClick={() => {
                // Dev-only: clear local app state for a clean boot.
                try {
                  localStorage.clear();
                  sessionStorage.clear();
                } catch {
                  /* ignore */
                }
                toast.success("已清除本機狀態");
                window.location.replace("/login");
              }}
              className="mt-2 w-full rounded-full border border-dashed border-border py-3 text-xs text-muted-foreground"
            >
              [Dev] 清除本機狀態
            </button>
          ) : null}
        </div>
      </div>

      <LegalDocumentSheet
        open={legalOpen === "terms"}
        onOpenChange={(o) => !o && setLegalOpen(null)}
        title="Roamie 服務條款"
        content={TERMS_OF_SERVICE}
      />
      <LegalDocumentSheet
        open={legalOpen === "privacy"}
        onOpenChange={(o) => !o && setLegalOpen(null)}
        title="Roamie 隱私權政策"
        content={PRIVACY_POLICY}
      />
    </MobileFrame>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.4 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.3.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9zM14.1 5.4c.6-.7 1-1.7.9-2.8-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-1 2.7 1 .1 2-.5 2.7-1.2z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
