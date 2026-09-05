import type { TripLocation } from "@/lib/location/types";

export type PlanDepartureState = "absent" | "selected" | "text_unresolved";

export function resolvePlanDepartureState(
  departureText: string | null | undefined,
  selectedDeparture: TripLocation | null | undefined,
): PlanDepartureState {
  if (selectedDeparture) return "selected";
  return departureText?.trim() ? "text_unresolved" : "absent";
}

export function logPlanDepartureAuthority(input: {
  departureText?: string | null;
  selectedDeparture?: TripLocation | null;
  source: "user_selection" | "none" | "stale_rejected";
}): PlanDepartureState {
  const normalizedState = resolvePlanDepartureState(input.departureText, input.selectedDeparture);
  console.info("[PLAN_DEPARTURE_AUTHORITY]", {
    hasDepartureText: Boolean(input.departureText?.trim()),
    hasSelectedDeparture: Boolean(input.selectedDeparture),
    normalizedState,
    source: input.source,
  });
  return normalizedState;
}

export function logPlanSubmitValidation(input: {
  destinationValid: boolean;
  departureState: PlanDepartureState;
  blocked: boolean;
  blockedReason?: string;
}): void {
  console.info("[PLAN_SUBMIT_VALIDATION]", {
    destinationValid: input.destinationValid,
    departureState: input.departureState,
    blocked: input.blocked,
    blockedReason: input.blockedReason ?? "",
  });
}
