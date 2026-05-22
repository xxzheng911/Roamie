import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { supabase } from "@/lib/supabase";
import { writeGuestFlag } from "@/lib/auth-session";
import { mergeGuestDataAfterLogin } from "@/lib/guest-merge";
import { ensureUserProfile, syncProfileAppFields } from "@/lib/ensure-user-profile";
import { stripOAuthParamsFromUrl } from "@/lib/auth-oauth";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

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
        console.error("[auth/callback] OAuth error", oauthError);
        if (!cancelled) {
          toast.error("登入失敗，請再試一次。");
          navigate({ to: "/login", replace: true });
        }
        return;
      }

      const code = query.get("code");
      if (!code) {
        console.error("[auth/callback] missing code param", window.location.href);
        if (!cancelled) {
          toast.error("登入連結不完整，請重新登入。");
          navigate({ to: "/login", replace: true });
        }
        return;
      }

      try {
        setStatus("正在驗證登入…");
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;

        if (cancelled) return;

        stripOAuthParamsFromUrl();

        writeGuestFlag(false);

        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const userId = sessionData.session?.user.id;
        if (!userId) {
          throw new Error("登入後未取得 session");
        }

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
        console.error("[auth/callback] session failed", e);
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "登入失敗，請再試一次。";
          toast.error(
            msg.includes("PKCE") || msg.includes("code verifier")
              ? "登入驗證失敗，請回到登入頁再試一次（請使用相同網址與分頁）。"
              : msg,
          );
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
