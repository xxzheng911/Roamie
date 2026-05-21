import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MobileFrame } from "@/components/MobileFrame";
import { supabase } from "@/integrations/supabase/client";

const GUEST_KEY = "roamie:guest";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("正在完成登入…");

  useEffect(() => {
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

      try {
        const code = query.get("code");

        if (code) {
          setStatus("正在驗證登入…");
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          setStatus("正在建立工作階段…");
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session) {
            throw new Error("登入後未取得 session");
          }
        }

        if (cancelled) return;

        localStorage.removeItem(GUEST_KEY);
        sessionStorage.removeItem(GUEST_KEY);

        toast.success("登入成功");
        navigate({ to: "/", replace: true });
      } catch (e) {
        console.error("[auth/callback] session failed", e);
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "登入失敗，請再試一次。");
          navigate({ to: "/login", replace: true });
        }
      }
    };

    finish();

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
