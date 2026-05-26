import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { logAppError } from "@/lib/log-error";
import { supabase } from "@/lib/supabase";
import { hasOAuthCallbackParams } from "@/lib/auth-oauth";
import { logAuthDebug } from "@/lib/auth-debug";
import { getClientAuthSession } from "@/lib/auth-session";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const finishLoading = () => {
      if (!cancelled) setLoading(false);
    };

    const applySession = (s: Session | null) => {
      if (cancelled) return;
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
      });
      applySession(s);
    });

    const init = async () => {
      if (hasOAuthCallbackParams()) return;

      try {
        const s = await getClientAuthSession();
        if (!cancelled) applySession(s);
      } catch (e) {
        logAppError("[auth] getSession failed", e);
        if (!cancelled) {
          finishLoading();
        }
      }
    };

    void init();

    const fallbackMs = hasOAuthCallbackParams() ? 12_000 : 2500;
    const fallback = window.setTimeout(finishLoading, fallbackMs);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    setSession(null);
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch (e) {
      console.warn("[auth] signOut failed", e);
    }
  };

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
