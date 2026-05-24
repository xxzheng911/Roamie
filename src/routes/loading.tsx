import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { RoamieSplashScreen } from "@/components/RoamieSplashScreen";
import { hideNativeSplashScreen } from "@/lib/native-splash";
import { getClientAuthSession, readGuestFlag } from "@/lib/auth-session";
import { hasSeenOnboarding, hydrateOnboardingStorage } from "@/lib/app-onboarding-storage";
import { markBootstrapSplashShown } from "@/lib/bootstrap-splash";
import { resolveStartupPath, type StartupPath } from "@/lib/post-auth-navigation";

const BOOTSTRAP_TIMEOUT_MS = 4_000;
const MIN_SPLASH_MS = 480;

type LoadingSearch = { to?: StartupPath };

async function resolveLoadingTarget(
  targetFromSearch: StartupPath | undefined,
  options: { isGuest: boolean; hasSession: boolean },
): Promise<StartupPath> {
  await hydrateOnboardingStorage();

  if (!hasSeenOnboarding()) {
    console.info("[Startup] funnel lock → /intro (hasSeenOnboarding=false)");
    return "/intro";
  }

  if (targetFromSearch) {
    console.info("[Startup] using search target", targetFromSearch);
    return targetFromSearch;
  }

  return resolveStartupPath(options);
}

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
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    void hideNativeSplashScreen();
  }, []);

  useEffect(() => {
    if (navigatedRef.current) return;

    let cancelled = false;

    const goNext = async () => {
      if (cancelled || navigatedRef.current) return;

      try {
        const guest = readGuestFlag();
        const session = await getClientAuthSession();
        const hasSession = !!session?.user && !guest;

        const [target] = await Promise.all([
          resolveLoadingTarget(targetFromSearch, { isGuest: guest, hasSession }),
          new Promise<void>((resolve) => {
            const elapsed = Date.now() - mountedAtRef.current;
            const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
            setTimeout(resolve, wait);
          }),
        ]);

        if (cancelled || navigatedRef.current) return;

        navigatedRef.current = true;
        markBootstrapSplashShown();
        console.info("[Startup] loading navigate →", target);
        navigate({ to: target, replace: true });
      } catch (e) {
        console.error("[loading] bootstrap failed", e);
        if (!cancelled && !navigatedRef.current) {
          await hydrateOnboardingStorage();
          navigatedRef.current = true;
          markBootstrapSplashShown();
          const fallback = hasSeenOnboarding() ? "/login" : "/intro";
          navigate({ to: fallback, replace: true });
        }
      }
    };

    const timeout = window.setTimeout(() => {
      if (!navigatedRef.current) void goNext();
    }, BOOTSTRAP_TIMEOUT_MS);

    void goNext();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [navigate, targetFromSearch]);

  return <RoamieSplashScreen />;
}
