import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { TravelPreferenceQuizPage } from "@/components/travel-preference/TravelPreferenceQuizPage";
import {
  isOnboardingCompletedSync,
  loadOnboardingState,
} from "@/lib/onboarding-storage";
import { requirePreferenceQuizRouteAccess } from "@/lib/require-auth";

const searchSchema = z.object({
  from: z.enum(["home", "profile", "chat"]).optional(),
});

export const Route = createFileRoute("/travel-preference-test")({
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    await loadOnboardingState();
    await requirePreferenceQuizRouteAccess(search.from);
    if (!isOnboardingCompletedSync()) {
      throw redirect({ to: "/welcome" });
    }
  },
  component: TravelPreferenceTestRoute,
});

function TravelPreferenceTestRoute() {
  const search = Route.useSearch();
  return <TravelPreferenceQuizPage origin={search.from ?? "profile"} />;
}
