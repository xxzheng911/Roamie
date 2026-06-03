import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { withTimeout } from "@/lib/async/with-timeout";
import type { TravelPreferences } from "@/lib/preferences-storage";
import { getPreferences } from "@/lib/preferences-storage";
import { createTripFromPlanForm } from "@/lib/trip/create-manual-trip-from-plan";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import { logManualTripError } from "@/lib/trip/trip-persist-log";
import {
  MANUAL_TRIP_SAVE_TIMEOUT_MS,
  PLAN_PREFS_TIMEOUT_MS,
} from "@/lib/plan/plan-flow-timeouts";

export async function loadPlanPrefsWithTimeout(
  existing?: TravelPreferences,
): Promise<TravelPreferences> {
  if (existing) return existing;
  try {
    return await withTimeout(getPreferences(), PLAN_PREFS_TIMEOUT_MS, "plan_prefs");
  } catch (e) {
    console.warn("[MANUAL_TRIP] prefs timeout, using defaults", e);
    return { budgetMode: "standard", interests: [] };
  }
}

/**
 * 手動「建立行程」：不呼叫 AI / 天氣 / OpenAI，僅最小 payload + 分階段寫入。
 */
export async function executeManualTripCreate(
  form: PlanTripFormInput,
  prefs?: TravelPreferences,
): Promise<StoredItinerary> {
  const preferences = await loadPlanPrefsWithTimeout(prefs);
  return withTimeout(
    createTripFromPlanForm(form, preferences),
    MANUAL_TRIP_SAVE_TIMEOUT_MS,
    "manual_trip_save",
  );
}

export function logManualTripNavigateFailure(
  tripId: string,
  route: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[MANUAL_TRIP_NAVIGATE_FAILED]", { tripId, route, message });
  logManualTripError("navigate", error);
}
