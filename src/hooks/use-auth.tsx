import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { logAppError } from "@/lib/log-error";
import { supabase } from "@/lib/supabase";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { logAuthDebug } from "@/lib/auth-debug";
import { logAuthBoot } from "@/lib/auth-boot-log";
import { AUTH_RESTORE_TIMEOUT } from "@/lib/auth-restore";
import { clearAuthState } from "@/lib/clear-auth-state";
import {
  getClientAuthSession,
  markClientAuthSessionSettledUnauthenticated,
  readCachedAuthenticatedUserIdSync,
  updateClientAuthSessionCache,
} from "@/lib/auth-session";
import { warmSupabaseAuthStorage } from "@/lib/supabase-auth-storage";
import { detectPlatform } from "@/services/platform";
import { isLoginColdStartPath, readBrowserPathname } from "@/lib/startup-path";
import { isOnboardingCompletedSync, isOnboardingHydrated } from "@/lib/onboarding-storage";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

function shouldDeferAuthLoading(): boolean {
  if (typeof window === "undefined") return false;
  const path = readBrowserPathname();
  return isLoginColdStartPath(path) && !hasOAuthCallbackParams();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => !shouldDeferAuthLoading());

  useEffect(() => {
    let cancelled = false;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const applySession = (s: Session | null) => {
      if (cancelled) return;
      updateClientAuthSessionCache(s);
      setSession((prev) => {
        const sameUser = prev?.user?.id === s?.user?.id;
        const sameToken = prev?.access_token === s?.access_token;
        if (sameUser && sameToken) return prev;
        return s;
      });
      finishLoading();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      logAuthDebug("session.state_change", {
        event,
        hasSession: Boolean(s),
        userId: s?.user?.id ?? null,
        provider: s?.user?.app_metadata?.provider ?? null,
        onboardingHydrated: isOnboardingHydrated(),
        onboardingCompleted: isOnboardingHydrated() ? isOnboardingCompletedSync() : null,
        currentRoute: typeof window !== "undefined" ? readBrowserPathname() : null,
        targetRoute: null,
        trigger: "AuthProvider.onAuthStateChange",
      });
      applySession(s);
    });

    const init = async () => {
      console.info("[APP_BOOT_STAGE]", {
        stage: "auth_restore_start",
        elapsedMs: Math.round(performance.now()),
        route: readBrowserPathname(),
      });
      if (hasOAuthCallbackParams()) {
        finishLoading();
        console.info("[APP_BOOT_STAGE]", {
          stage: "auth_restore_done",
          elapsedMs: Math.round(performance.now()),
          route: readBrowserPathname(),
          authenticated: Boolean(readCachedAuthenticatedUserIdSync()),
          outcome: "oauth_callback_deferred",
        });
        return;
      }

      logAuthBoot("init");
      try {
        if (detectPlatform().isCapacitor) {
          await warmSupabaseAuthStorage();
        }
        const s = await getClientAuthSession();
        if (!cancelled) {
          applySession(s);
          console.info("[APP_BOOT_STAGE]", {
            stage: "auth_restore_done",
            elapsedMs: Math.round(performance.now()),
            route: readBrowserPathname(),
            authenticated: Boolean(s?.user),
          });
        }
      } catch (e) {
        logAppError("[auth] getSession failed", e);
        markClientAuthSessionSettledUnauthenticated();
        if (!cancelled) {
          applySession(null);
          console.info("[APP_BOOT_STAGE]", {
            stage: "auth_restore_done",
            elapsedMs: Math.round(performance.now()),
            route: readBrowserPathname(),
            authenticated: false,
            failureReason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    };

    if (shouldDeferAuthLoading()) {
      let idleHandle: number | ReturnType<typeof setTimeout>;
      if (typeof requestIdleCallback === "function") {
        idleHandle = requestIdleCallback(() => {
          void init();
        });
      } else {
        idleHandle = window.setTimeout(() => {
          void init();
        }, 1);
      }
      return () => {
        cancelled = true;
        subscription.unsubscribe();
        if (typeof requestIdleCallback === "function" && typeof idleHandle === "number") {
          cancelIdleCallback(idleHandle);
        } else {
          clearTimeout(idleHandle as ReturnType<typeof setTimeout>);
        }
      };
    }

    void init();

    const fallbackMs = hasOAuthCallbackParams() ? AUTH_RESTORE_TIMEOUT.nativeMs : 2_500;
    const fallback = window.setTimeout(finishLoading, fallbackMs);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    setSession(null);
    const { resetWarmSupabaseAuthStorage } = await import("@/lib/supabase-auth-storage");
    markClientAuthSessionSettledUnauthenticated();
    resetWarmSupabaseAuthStorage();
    await clearAuthState({ reason: "user-sign-out" });
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signOut,
    }),
    [session, loading, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
