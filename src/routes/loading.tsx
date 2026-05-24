import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { RoamieSplashScreen } from "@/components/RoamieSplashScreen";
import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { hasSeenOnboarding } from "@/lib/app-onboarding-storage";
import { markBootstrapSplashShown } from "@/lib/bootstrap-splash";
import { resolveStartupPath, type StartupPath } from "@/lib/post-auth-navigation";

const BOOTSTRAP_TIMEOUT_MS = 6_000;
const AUTH_WAIT_MS = 2_000;

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
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (navigatedRef.current) return;

    let cancelled = false;

    const goNext = async () => {
      if (cancelled || navigatedRef.current) return;

      try {
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
          navigate({ to: hasSeenOnboarding() ? "/login" : "/intro", replace: true });
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

  return <RoamieSplashScreen />;
}
