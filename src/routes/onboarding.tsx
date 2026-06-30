import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { ONBOARDING_ROUTE } from "@/lib/app-boot-log";
import { isOnboardingCompletedSync, loadOnboardingState } from "@/lib/onboarding-storage";

const searchSchema = z.object({
  from: z.enum(["home", "profile", "chat"]).optional(),
});

/** 別名：未完成 onboarding → /welcome；已完成 → 旅行偏好測驗 */
export const Route = createFileRoute("/onboarding")({
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async ({ search }) => {
    if (typeof window === "undefined") return;
    await loadOnboardingState();
    if (isOnboardingCompletedSync()) {
      throw redirect({
        to: "/travel-preference-test",
        search: search.from ? { from: search.from } : undefined,
      });
    }
    throw redirect({ to: ONBOARDING_ROUTE });
  },
});
