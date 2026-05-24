import { clearSessionBootstrapForDev } from "@/components/StartupGate";
import { resetOnboardingForDev } from "@/lib/app-onboarding-storage";
import { clearBootstrapSplashForDev } from "@/lib/bootstrap-splash";
import { resetPreferenceQuizForDev } from "@/lib/preferences-storage";

/** Dev-only: reset first-run funnel (onboarding + preference quiz) */
export async function resetFirstRunForDev(): Promise<void> {
  if (!import.meta.env.DEV) return;
  await resetOnboardingForDev();
  clearBootstrapSplashForDev();
  clearSessionBootstrapForDev();
  await resetPreferenceQuizForDev();
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as Window & { __ROAMIE_DEV_RESET_FIRST_RUN__?: () => Promise<void> }).__ROAMIE_DEV_RESET_FIRST_RUN__ =
    resetFirstRunForDev;
}
