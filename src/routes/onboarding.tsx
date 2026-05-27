import { createFileRoute, redirect } from "@tanstack/react-router";
import { ONBOARDING_ROUTE } from "@/lib/app-boot-log";

/** 別名：/onboarding → 實際教學頁 /welcome */
export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    throw redirect({ to: ONBOARDING_ROUTE });
  },
});
