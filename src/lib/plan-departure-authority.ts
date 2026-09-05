import type { TripLocation } from "@/lib/location/types";

export type PlanDepartureState = "omitted" | "selected" | "text_unresolved";

export function resolvePlanDepartureState(
  departureText: string | null | undefined,
  selectedDeparture: TripLocation | null | undefined,
): PlanDepartureState {
  if (!departureText?.trim()) return "omitted";
  return selectedDeparture ? "selected" : "text_unresolved";
}

export function logPlanDepartureAuthority(input: {
  departureText?: string | null;
  selectedDeparture?: TripLocation | null;
  source: "user_selection" | "visible_empty" | "stale_rejected";
}): PlanDepartureState {
  const normalizedState = resolvePlanDepartureState(input.departureText, input.selectedDeparture);
  console.info("[PLAN_DEPARTURE_AUTHORITY]", {
    visibleTextLength: input.departureText?.length ?? 0,
    trimmedTextLength: input.departureText?.trim().length ?? 0,
    hasSelectedDeparture: Boolean(input.selectedDeparture),
    selectedPlaceId: input.selectedDeparture?.placeId?.trim() ?? "",
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
