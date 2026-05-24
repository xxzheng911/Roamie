import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { LegalDocumentSheet } from "@/components/LegalDocumentSheet";
import { TERMS_OF_SERVICE, PRIVACY_POLICY } from "@/content/legal";
import { isOAuthProviderEnabled } from "@/constants/auth";
import { startOAuthSignIn, type OAuthProvider } from "@/lib/auth-oauth";
import { useAuth } from "@/hooks/use-auth";
import { hasSeenOnboarding } from "@/lib/app-onboarding-storage";
import { shouldShowBootstrapSplash } from "@/lib/bootstrap-splash";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import traveler from "@/assets/roamie-traveler.jpg";

const isDev = import.meta.env.DEV;

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    if (!hasSeenOnboarding()) {
      if (shouldShowBootstrapSplash()) {
        throw redirect({ to: "/loading", search: { to: "/intro" } });
      }
      throw redirect({ to: "/intro" });
    }
  },
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { user, loading, isGuest, enterGuestMode } = useAuth();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [legalOpen, setLegalOpen] = useState<"terms" | "privacy" | null>(null);
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (loading || redirectedRef.current) return;
    if (user && !isGuest) {
      redirectedRef.current = true;
      void resolveStartupPath({ isGuest: false, hasSession: true }).then((to) => {
        if (shouldShowBootstrapSplash() && to !== "/login") {
          navigate({ to: "/loading", search: { to }, replace: true });
          return;
        }
        navigate({ to, replace: true });
      });
    }
  }, [user, loading, isGuest, navigate]);

  const signIn = async (provider: OAuthProvider) => {
    if (!isOAuthProviderEnabled(provider)) {
      toast.message("Apple 登入即將開放，請先使用 Google 或訪客模式體驗。");
      return;
    }

    setBusy(provider);
    toast.message(provider === "google" ? "正在跳轉至 Google…" : "正在跳轉至 Apple…");

    try {
      const result = await startOAuthSignIn(provider);
      if (!result.ok) {
        toast.error(result.message || "登入沒成功，待會再試一次。");
        setBusy(null);
      }
    } catch (e) {
      console.error("[oauth] sign-in threw", e);
      toast.error("登入沒成功，待會再試一次。");
      setBusy(null);
    }
  };

  const startGuest = async () => {
    enterGuestMode();
    const to = await resolveStartupPath({ isGuest: true, hasSession: false });
    if (shouldShowBootstrapSplash()) {
      navigate({ to: "/loading", search: { to }, replace: true });
      return;
    }
    navigate({ to, replace: true });
  };

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col px-6 pb-[max(2.5rem,var(--safe-area-bottom))] pt-[max(2.5rem,var(--safe-area-top))]">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="h-24 w-24 overflow-hidden rounded-[2rem] border-4 border-card shadow-soft">
            <img src={traveler} alt="" className="h-full w-full object-cover" />
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
          {isGuest ? (
            <p className="rounded-2xl border border-border/80 bg-card/70 px-4 py-3 text-center text-sm leading-relaxed text-muted-foreground">
              登入後可同步本裝置的訪客行程與收藏至雲端。
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => signIn("google")}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-4 text-[15px] font-medium text-background transition active:scale-[0.98] disabled:opacity-50"
          >
            <GoogleIcon /> 使用 Google 繼續
          </button>

          <button
            type="button"
            onClick={() => signIn("apple")}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-4 text-[15px] font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50"
          >
            <AppleIcon /> 以 Apple 登入
          </button>

          <button
            type="button"
            onClick={startGuest}
            disabled={busy !== null}
            className="flex w-full items-center justify-center rounded-full border border-border/80 bg-cream py-4 text-[15px] font-medium text-foreground/90 transition active:scale-[0.98] disabled:opacity-50"
          >
            訪客模式先體驗
          </button>

          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
            訪客資料僅保存在本裝置，登入後可同步至雲端。
          </p>

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
                void import("@/lib/dev-first-run-reset").then(({ resetFirstRunForDev }) =>
                  resetFirstRunForDev().then(() => {
                    toast.success("已重置首次使用流程");
                    navigate({ to: "/loading", search: { to: "/intro" }, replace: true });
                  }),
                );
              }}
              className="mt-2 w-full rounded-full border border-dashed border-border py-3 text-xs text-muted-foreground"
            >
              [Dev] 重置 Onboarding
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
