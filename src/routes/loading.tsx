import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MobileFrame } from "@/components/MobileFrame";
import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { markBootstrapSplashShown } from "@/lib/bootstrap-splash";
import { resolveStartupPath, type StartupPath } from "@/lib/post-auth-navigation";
import traveler from "@/assets/roamie-traveler.jpg";

const BOOTSTRAP_TIMEOUT_MS = 6_000;
const AUTH_WAIT_MS = 2_500;

type LoadingSearch = { to?: StartupPath };

export const Route = createFileRoute("/loading")({
  validateSearch: (s: Record<string, unknown>): LoadingSearch => {
    const to = s.to;
    if (to === "/login" || to === "/intro" || to === "/onboarding" || to === "/welcome" || to === "/") {
      return { to };
    }
    return {};
  },
  component: LoadingGate,
});

function LoadingGate() {
  const navigate = useNavigate();
  const { to: targetFromSearch } = Route.useSearch();
  const [status, setStatus] = useState("正在啟動 Roamie…");
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (navigatedRef.current) return;

    let cancelled = false;

    const goNext = async () => {
      if (cancelled || navigatedRef.current) return;

      try {
        setStatus("準備你的旅程…");

        const guest = readGuestFlag();
        const session = await getClientAuthSession();
        const hasSession = !!session?.user && !guest;

        const target =
          targetFromSearch ??
          (await resolveStartupPath({
            isGuest: guest,
            hasSession,
          }));

        navigatedRef.current = true;
        markBootstrapSplashShown();
        navigate({ to: target, replace: true });
      } catch (e) {
        console.error("[loading] bootstrap failed", e);
        if (!cancelled && !navigatedRef.current) {
          navigatedRef.current = true;
          markBootstrapSplashShown();
          navigate({ to: "/login", replace: true });
        }
      }
    };

    const timeout = window.setTimeout(() => {
      if (!navigatedRef.current) void goNext();
    }, BOOTSTRAP_TIMEOUT_MS);

    const start = async () => {
      await new Promise((r) => setTimeout(r, AUTH_WAIT_MS));
      await goNext();
    };

    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [navigate, targetFromSearch]);

  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-8">
        <div className="h-24 w-24 overflow-hidden rounded-[2rem] border-4 border-card shadow-soft">
          <img src={traveler} alt="" className="h-full w-full object-cover" />
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </MobileFrame>
  );
}
