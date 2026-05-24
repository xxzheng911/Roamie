import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { hydrateOnboardingStorage } from "@/lib/app-onboarding-storage";

const SESSION_BOOT_KEY = "roamie:session_bootstrapped";
const EXEMPT_PATHS = new Set(["/loading", "/intro", "/onboarding", "/login", "/welcome", "/auth/callback"]);

export function clearSessionBootstrapForDev(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_BOOT_KEY);
  } catch {
    /* ignore */
  }
}

type Props = { children: ReactNode };

/**
 * Cold-start routing only — splash UI lives exclusively on /loading.
 */
export function StartupGate({ children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      await hydrateOnboardingStorage();
      if (cancelled) return;

      const bootstrapped = sessionStorage.getItem(SESSION_BOOT_KEY) === "1";
      const path = location.pathname;

      if (!bootstrapped && !EXEMPT_PATHS.has(path)) {
        sessionStorage.setItem(SESSION_BOOT_KEY, "1");
        navigate({ to: "/loading", replace: true });
      }

      setReady(true);
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  if (!ready) return null;

  return children;
}
