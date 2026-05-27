import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { removeStaticBootPlaceholder } from "@/main";
import { MobileFrame } from "@/components/MobileFrame";
import { AuthSignInError } from "@/components/auth/AuthSignInError";
import { isOAuthProviderEnabled } from "@/constants/auth";
import { hasPendingOAuthCallback, readPendingCallbackPath } from "@/lib/auth-oauth-deep-link";
import { shouldSkipOAuthCallbackNavigation } from "@/lib/oauth-callback-guard";
import { clearAuthState } from "@/lib/clear-auth-state";
import { getClientAuthSession } from "@/lib/auth-session";
import { hasLikelyPersistedSession } from "@/lib/startup-route";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { logGoogleOAuthMarker } from "@/lib/auth-debug";
import { signInWithProvider, type OAuthProvider } from "@/lib/auth-oauth";
import { formatSupabaseRedirectAllowListHint } from "@/lib/auth-redirect";
import { finishPostAuthRedirect } from "@/lib/auth-post-redirect";
import {
  ensureIosLoginLiveInteraction,
  notifyIosOAuthOpen,
  notifyIosOAuthReturn,
  scheduleIosSnapshotRefreshBurst,
  setIosLegalOverlayOpen,
  setIosSnapshotLiveInteractionForced,
} from "@/lib/ios-snapshot-bridge";
import { detectPlatform } from "@/services/platform";
import { loadOnboardingState } from "@/lib/onboarding-storage";
import { resolveStartupPath } from "@/lib/post-auth-navigation";
import { resolveStartupPathFast } from "@/lib/startup-route";
import {
  guardStartupTarget,
  isOnWelcomeRoute,
  logStartupNavigationContext,
} from "@/lib/startup-navigation";
import { isOnboardingCompletedSync } from "@/lib/onboarding-storage";
import { useAuth } from "@/hooks/use-auth";
import { emitOAuthFlow, OAUTH_FLOW_EVENT, type OAuthFlowDetail } from "@/lib/auth-debug";
import { navigateOAuthAppPath } from "@/lib/oauth-app-navigate";
import { QaTestLoginButton } from "@/components/qa/QaTestLoginButton";

const RoamieMascotFigure = lazy(() =>
  import("@/components/onboarding/RoamieMascotFigure").then((m) => ({
    default: m.RoamieMascotFigure,
  })),
);
function LegalDocumentOverlayLazy({
  doc,
  onClose,
}: {
  doc: "terms" | "privacy";
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const title = doc === "terms" ? "Roamie 服務條款" : "Roamie 隱私權政策";

  useEffect(() => {
    void import("@/content/legal").then((m) => {
      setContent(doc === "terms" ? m.TERMS_OF_SERVICE : m.PRIVACY_POLICY);
    });
  }, [doc]);

  if (!content) {
    return (
      <div className="absolute inset-0 z-[200] flex items-center justify-center bg-background/95">
        <p className="text-sm text-muted-foreground">載入中…</p>
      </div>
    );
  }

  return <LazyLegalDocumentOverlay title={title} content={content} onClose={onClose} />;
}

const LazyLegalDocumentOverlay = lazy(() =>
  import("@/components/LegalDocumentOverlay").then((m) => ({
    default: m.LegalDocumentOverlay,
  })),
);

const isDev = import.meta.env.DEV;
const OAUTH_BUSY_TIMEOUT_MS = 120_000;
const APPLE_BUSY_TIMEOUT_MS = 90_000;

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    await loadOnboardingState();
    if (!isOnboardingCompletedSync()) {
      console.log("[ONBOARDING_GUARD] blocked home redirect", {
        source: "login-beforeLoad",
        targetRoute: "/welcome",
      });
      throw redirect({ to: "/welcome" });
    }
  },
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLegalPage = pathname.replace(/\/+$/, "").startsWith("/login/legal");
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [legalOpen, setLegalOpen] = useState<"terms" | "privacy" | null>(null);
  const redirectedRef = useRef(false);
  const oauthBusyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOAuthBusyTimer = () => {
    if (oauthBusyTimerRef.current != null) {
      window.clearTimeout(oauthBusyTimerRef.current);
      oauthBusyTimerRef.current = null;
    }
  };

  const startOAuthBusyTimer = (ms = OAUTH_BUSY_TIMEOUT_MS, message?: string) => {
    clearOAuthBusyTimer();
    oauthBusyTimerRef.current = window.setTimeout(() => {
      oauthBusyTimerRef.current = null;
      setBusy(null);
      setAuthError(
        message ?? "登入逾時，請再試一次。若已看到 Google 登入完成，請關閉瀏覽器視窗後重試。",
      );
    }, ms);
  };
  const closeLegal = () => {
    setLegalOpen(null);
  };

  const openLegal = (doc: "terms" | "privacy") => {
    if (detectPlatform().isCapacitor && detectPlatform().isIOS) {
      void navigate({ to: "/login/legal", search: { doc }, replace: false }).catch(() => {
        window.location.assign(`/login/legal?doc=${doc}`);
      });
      return;
    }
    setLegalOpen(doc);
  };

  useLayoutEffect(() => {
    if (isLegalPage) return;
    removeStaticBootPlaceholder();
  }, [isLegalPage]);

  useIosInteractiveRoute(isLegalPage ? "__skip__" : "login");

  useEffect(() => {
    if (isLegalPage) return;
    if (detectPlatform().isCapacitor) {
      void warmSupabaseAuthStorage();
    }
  }, [isLegalPage]);

  useEffect(() => {
    if (isLegalPage || loading || user) return;
    if (hasPendingOAuthCallback()) return;
    if (!hasLikelyPersistedSession()) return;
    void (async () => {
      const session = await getClientAuthSession();
      if (!session?.user) {
        await clearAuthState({ reason: "login-stale-local-session" });
      }
    })();
  }, [isLegalPage, loading, user]);

  useEffect(() => {
    if (loading || redirectedRef.current) return;
    if (user) {
      redirectedRef.current = true;
      void loadOnboardingState().then(async () => {
        if (!isOnboardingCompletedSync()) {
          const fastTo = guardStartupTarget("/welcome", "login-session-restore");
          console.log("[ONBOARDING_GUARD] blocked home redirect", {
            source: "login-session-restore",
            targetRoute: fastTo,
          });
          await logStartupNavigationContext("login-session-restore", fastTo, {
            reason: "onboarding_incomplete",
            trigger: "Login.useEffect(user)->onboarding_incomplete",
          });
          navigate({ to: fastTo, replace: true });
          return;
        }

        if (isOnWelcomeRoute()) {
          console.info("[Startup Navigation Skipped]", {
            source: "login-session-restore",
            reason: "onboarding_in_progress_on_welcome",
            currentRoute: "/welcome",
          });
          return;
        }

        const fastTo = guardStartupTarget(resolveStartupPathFast(), "login-session-restore");
        await logStartupNavigationContext("login-session-restore", fastTo);
        navigate({ to: fastTo, replace: true });
        void resolveStartupPath({
          hasSession: true,
          skipLog: true,
          source: "login-session-restore",
        }).then((to) => {
          const guarded = guardStartupTarget(to, "login-session-restore");
          if (guarded !== fastTo) navigate({ to: guarded, replace: true });
        });
      });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const onOAuthFlow = (e: Event) => {
      const detail = (e as CustomEvent<OAuthFlowDetail>).detail;
      if (detail.phase === "return") {
        clearOAuthBusyTimer();
        setBusy(null);
        setLegalOpen(null);
        notifyIosOAuthReturn();
        if (detail.path) {
          void navigateOAuthAppPath(detail.path);
        }
        return;
      }
      if (detail.phase === "cancelled") {
        clearOAuthBusyTimer();
        setBusy(null);
        return;
      }
      if (detail.phase === "error") {
        clearOAuthBusyTimer();
        setBusy(null);
        void clearAuthState({ reason: "oauth-flow-error" });
        setAuthError(detail.message);
      }
    };
    const onNativeCancelled = () => {
      clearOAuthBusyTimer();
      setBusy(null);
      emitOAuthFlow({ phase: "cancelled" });
    };
    const onNativeError = (e: Event) => {
      clearOAuthBusyTimer();
      setBusy(null);
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setAuthError(detail?.message ?? "無法開啟 Google 登入視窗");
    };

    window.addEventListener(OAUTH_FLOW_EVENT, onOAuthFlow);
    window.addEventListener("roamie-oauth-native-cancelled", onNativeCancelled);
    window.addEventListener("roamie-oauth-native-error", onNativeError);
    return () => {
      window.removeEventListener(OAUTH_FLOW_EVENT, onOAuthFlow);
      window.removeEventListener("roamie-oauth-native-cancelled", onNativeCancelled);
      window.removeEventListener("roamie-oauth-native-error", onNativeError);
      clearOAuthBusyTimer();
    };
  }, []);

  useEffect(() => {
    const platform = detectPlatform();
    if (!platform.isCapacitor) return;

    let removeAppListener: (() => void) | undefined;

    void import("@capacitor/app").then(({ App }) => {
      void App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        const pending = readPendingCallbackPath();
        if (!pending) return;
        void (async () => {
          if (await shouldSkipOAuthCallbackNavigation(pending)) {
            clearOAuthBusyTimer();
            setBusy(null);
            return;
          }
          clearOAuthBusyTimer();
          setBusy(null);
          notifyIosOAuthReturn();
          await navigateOAuthAppPath(pending);
        })();
      }).then((handle) => {
        removeAppListener = () => {
          void handle.remove();
        };
      });
    });

    return () => {
      removeAppListener?.();
    };
  }, []);

  const signIn = async (provider: OAuthProvider) => {
    if (provider === "google") {
      logGoogleOAuthMarker("clicked");
    }
    setAuthError(null);
    clearOAuthBusyTimer();

    const platform = detectPlatform();
    if (platform.isCapacitor && platform.isIOS) {
      ensureIosLoginLiveInteraction();
      if (provider === "google") {
        notifyIosOAuthOpen();
      }
    }

    if (!isOAuthProviderEnabled(provider)) {
      const msg =
        provider === "apple"
          ? "Apple 登入目前無法使用。請在 iOS App 上重試，或確認 Supabase 已啟用 Apple Provider。"
          : "此登入方式暫時無法使用。";
      setAuthError(msg);
      return;
    }

    setLegalOpen(null);
    setIosLegalOverlayOpen(false);
    setBusy(provider);
    if (provider === "google") {
      startOAuthBusyTimer();
    } else if (provider === "apple") {
      startOAuthBusyTimer(
        APPLE_BUSY_TIMEOUT_MS,
        "Apple 登入逾時，請再試一次。若已完成 Face ID，請稍候或重新開啟 App。",
      );
    }
    const { toast } = await import("sonner");
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
        clearOAuthBusyTimer();
        setBusy(null);
        if (result.cancelled) return;
        if (provider === "google") {
          logGoogleOAuthMarker("failed", { message: result.message });
          await clearAuthState({ reason: "google-sign-in-failed" });
        }
        let msg = result.message || "登入沒成功，待會再試一次。";
        if (/requested path is invalid|redirect url|nonces?\s*mismatch|pkce/i.test(msg)) {
          msg = `${msg}\n\n請確認 Supabase Redirect URLs 已加入：\n${formatSupabaseRedirectAllowListHint()}`;
        }
        setAuthError(msg);
        console.error("[auth] sign-in failed", { provider, message: msg });
        return;
      }

      const { canUseNativeAppleSignIn } = await import("@/lib/auth-apple-native");
      if (provider === "apple" && canUseNativeAppleSignIn()) {
        clearOAuthBusyTimer();
        setBusy(null);
        setIosLegalOverlayOpen(false);
        setIosSnapshotLiveInteractionForced(true);
        notifyIosOAuthReturn();
        scheduleIosSnapshotRefreshBurst("apple-sign-in");

        const next = guardStartupTarget(
          await resolveStartupPath({ hasSession: true, source: "login-session-restore" }),
          "login-session-restore",
        );
        const { toast } = await import("sonner");
        toast.success("登入成功");
        finishPostAuthRedirect(
          next,
          (opts) => navigate({ to: opts.to, replace: opts.replace }),
          "login-session-restore",
        );
        return;
      }

      /* Google / Web Apple：等待 deep link → /auth/callback；busy 直到 browser 關閉或 callback */
    } catch (e) {
      console.error("[auth] sign-in threw", e);
      clearOAuthBusyTimer();
      setBusy(null);
      if (provider === "google") {
        logGoogleOAuthMarker("failed", {
          message: e instanceof Error ? e.message : String(e),
        });
        await clearAuthState({ reason: "google-sign-in-threw" });
      }
      setAuthError(e instanceof Error ? e.message : "登入沒成功，待會再試一次。");
    }
  };

  if (isLegalPage) {
    return <Outlet />;
  }

  return (
    <MobileFrame>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col px-6 pb-[max(2.5rem,var(--safe-area-bottom))] pt-[max(2.5rem,var(--safe-area-top))]",
          legalOpen && "pointer-events-none select-none",
        )}
        aria-hidden={legalOpen ? true : undefined}
      >
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="login-mascot">
            <Suspense fallback={<div className="h-32 w-32" aria-hidden />}>
              <RoamieMascotFigure pose="wave" variant="quiz" motion="float" />
            </Suspense>
          </div>
          <h1 className="mt-6 font-display text-[28px] leading-tight">
            慢慢來，
            <br />
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
            onClick={() => signIn("apple")}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-4 text-[15px] font-medium text-background transition active:scale-[0.98] disabled:opacity-50"
          >
            <AppleIcon /> {busy === "apple" ? "Apple 登入進行中…" : "以 Apple 登入"}
          </button>

          <button
            type="button"
            onClick={() => signIn("google")}
            disabled={busy !== null}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-4 text-[15px] font-medium text-background transition active:scale-[0.98] disabled:opacity-50"
          >
            <GoogleIcon /> {busy === "google" ? "Google 登入進行中…" : "使用 Google 繼續"}
          </button>

          <QaTestLoginButton
            disabled={busy !== null}
            onSuccess={() => {
              void (async () => {
                const to = await resolveStartupPath({ hasSession: true, source: "qa-test-login" });
                finishPostAuthRedirect(to, navigate, "login-session-restore");
              })();
            }}
          />

          <p className="pt-1 text-center text-[11px] leading-relaxed text-muted-foreground">
            繼續即代表同意 Roamie 的
            <button
              type="button"
              onClick={() => openLegal("terms")}
              className="mx-0.5 text-foreground underline underline-offset-2"
            >
              服務條款
            </button>
            與
            <button
              type="button"
              onClick={() => openLegal("privacy")}
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
                void (async () => {
                  try {
                    localStorage.clear();
                    sessionStorage.clear();
                  } catch {
                    /* ignore */
                  }
                  const [{ resetOnboardingState }, { toast }] = await Promise.all([
                    import("@/lib/onboarding-storage"),
                    import("sonner"),
                  ]);
                  await resetOnboardingState();
                  toast.success("已重置 onboarding / 首次啟動");
                  window.location.replace("/welcome");
                })();
              }}
              className="mt-2 w-full rounded-full border border-dashed border-border py-3 text-xs text-muted-foreground"
            >
              [Dev] 清除本機狀態
            </button>
          ) : null}
        </div>
      </div>

      {legalOpen ? (
        <Suspense
          fallback={
            <div className="absolute inset-0 z-[200] flex items-center justify-center bg-background/95">
              <p className="text-sm text-muted-foreground">載入中…</p>
            </div>
          }
        >
          <LegalDocumentOverlayLazy doc={legalOpen} onClose={closeLegal} />
        </Suspense>
      ) : null}
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
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}
