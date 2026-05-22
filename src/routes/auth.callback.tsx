import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { supabase } from "@/lib/supabase";
import {
  getClientAuthSession,
  isAuthSessionMissingError,
  writeGuestFlag,
} from "@/lib/auth-session";
import { mergeGuestDataAfterLogin } from "@/lib/guest-merge";
import { ensureUserProfile, syncProfileAppFields } from "@/lib/ensure-user-profile";
import {
  readStashedOAuthRedirectTarget,
  stripOAuthParamsFromUrl,
} from "@/lib/auth-oauth";
import type { Session } from "@supabase/supabase-js";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

/** 兌換 OAuth code（單次），並等待 onAuthStateChange */
async function completeOAuthFromCode(code: string): Promise<Session> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;

  const session = await getClientAuthSession();
  if (session) return session;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("登入後未取得 session"));
    }, 12_000);

    const {
      data: { subscription: sub },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && s) {
        window.clearTimeout(timeout);
        sub.unsubscribe();
        resolve(s);
      }
    });
  });
}

function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("正在完成登入…");
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    let cancelled = false;

    const finish = async () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

      const oauthError =
        query.get("error_description") ||
        query.get("error") ||
        hash.get("error_description") ||
        hash.get("error");

      if (oauthError) {
        console.error("[auth/callback] OAuth error", oauthError, window.location.href);
        if (!cancelled) {
          toast.error(decodeURIComponent(oauthError.replace(/\+/g, " ")));
          navigate({ to: "/login", replace: true });
        }
        return;
      }

      const code = query.get("code");
      const stashed = readStashedOAuthRedirectTarget();
      console.info("[auth/callback]", window.location.href, "stashed", stashed);

      if (!code) {
        const existing = await getClientAuthSession();
        if (existing?.user) {
          if (!cancelled) navigate({ to: "/", replace: true });
          return;
        }
        if (!cancelled) {
          toast.error("登入連結不完整，請重新登入。");
          navigate({ to: "/login", replace: true });
        }
        return;
      }

      try {
        setStatus("正在驗證登入…");
        const session = await completeOAuthFromCode(code);

        if (cancelled) return;

        stripOAuthParamsFromUrl();
        writeGuestFlag(false);

        const userId = session.user.id;

        setStatus("正在建立個人資料…");
        try {
          await ensureUserProfile(userId);
          await syncProfileAppFields(userId);
        } catch (profileErr) {
          console.warn("[auth/callback] ensure profile failed", profileErr);
        }

        setStatus("正在同步你的資料…");
        try {
          await mergeGuestDataAfterLogin(userId);
        } catch (mergeErr) {
          console.warn("[auth/callback] guest merge failed", mergeErr);
        }

        if (cancelled) return;

        toast.success("登入成功");
        navigate({ to: "/", replace: true });
      } catch (e) {
        console.error("[auth/callback] session failed", e, "href", window.location.href);
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "登入失敗，請再試一次。";
          if (isAuthSessionMissingError(msg)) {
            toast.error("登入尚未完成，請再試一次。");
          } else if (
            msg.includes("PKCE") ||
            msg.includes("code verifier") ||
            msg.includes("invalid flow state")
          ) {
            toast.error(
              "登入驗證失敗：請用與剛才相同的網址（localhost 或 192.168.x.x）重新登入。",
              { duration: 8000 },
            );
          } else if (msg.includes("redirect") || msg.includes("Redirect")) {
            toast.error(msg, { duration: 8000 });
          } else {
            toast.error(msg);
          }
          navigate({ to: "/login", replace: true });
        }
      }
    };

    void finish();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </MobileFrame>
  );
}
