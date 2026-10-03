import { useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { AuthRequirementDialog } from "@/components/auth/AuthRequirementDialog";
import {
  commitAuthRequirementLogin,
  registerAuthActionNavigator,
  registerAuthRequirementPrompt,
  type AuthRequirementRequest,
} from "@/lib/auth-action";
import {
  AUTH_ACTION_RESUME_EVENT,
  claimPendingAuthAction,
  peekPendingAuthAction,
  resolvePendingAuthReturnPath,
  returnPathsMatch,
  type PendingAuthAction,
} from "@/lib/auth-pending-action";
import { toggleSavePlace, type NewPlace } from "@/lib/places-storage";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { isOnboardingCompletedSync } from "@/lib/onboarding-storage";

function currentHref(pathname: string, searchStr: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  return searchStr ? `${path}?${searchStr.replace(/^\?/, "")}` : path;
}

/**
 * Opens login for guests and, after a successful login, replays the stashed action once.
 * Favorite and add-to-trip call the same functions as the original buttons.
 */
export function AuthActionRuntime() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { openAddToTrip } = useAddToTrip();
  const [prompt, setPrompt] = useState<AuthRequirementRequest | null>(null);
  const confirmingLoginRef = useRef(false);
  const href = useRouterState({
    select: (state) => currentHref(state.location.pathname, state.location.searchStr),
  });

  useEffect(() => {
    registerAuthActionNavigator((path) => {
      void navigate({ to: path });
    });
    registerAuthRequirementPrompt((request) => {
      setPrompt(request);
    });
    return () => {
      registerAuthActionNavigator(null);
      registerAuthRequirementPrompt(null);
    };
  }, [navigate]);

  useEffect(() => {
    if (loading || !user) return;
    const pending = peekPendingAuthAction();
    if (!pending) return;
    const destination = resolvePendingAuthReturnPath(
      pending.sourcePath, isOnboardingCompletedSync(), true,
    );
    if (!returnPathsMatch(href, destination)) return;
    const timer = window.setTimeout(() => {
      const claimed = claimPendingAuthAction(pending.id);
      if (!claimed) return;
      window.dispatchEvent(new CustomEvent<PendingAuthAction>(AUTH_ACTION_RESUME_EVENT, { detail: claimed }));
      if (claimed.action === "favorite_write") {
        const raw = claimed.metadata.payload;
        if (typeof raw !== "string") return;
        try {
          const input = JSON.parse(raw) as NewPlace;
          if (!input?.name) return;
          void toggleSavePlace(input);
        } catch {
          // Invalid payload is dropped. The action was already claimed.
        }
        return;
      }
      if (claimed.action === "trip_add_place") {
        const raw = claimed.metadata.payload;
        if (typeof raw !== "string") return;
        try {
          const place = JSON.parse(raw) as TripPlaceInput;
          if (!place?.placeName) return;
          const surface = claimed.metadata.surface;
          openAddToTrip(place, typeof surface === "string" ? (surface as never) : "unknown");
        } catch {
          // Invalid payload is dropped.
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [href, loading, openAddToTrip, user]);

  return (
    <AuthRequirementDialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (confirmingLoginRef.current) {
          confirmingLoginRef.current = false;
          return;
        }
        setPrompt(null);
      }}
      onLogin={() => {
        const current = prompt;
        if (!current) return;
        confirmingLoginRef.current = true;
        setPrompt(null);
        commitAuthRequirementLogin(current);
      }}
    />
  );
}
