export function logPlanTripSubmitStart(source: "plan" | "chat"): void {
  console.info("[PLAN_TRIP_SUBMIT_START]", { source, at: new Date().toISOString() });
}

export function logPlanTripCreateMinimalStart(): void {
  console.info("[PLAN_TRIP_CREATE_MINIMAL_START]");
}

export function logPlanTripCreateMinimalSuccess(tripId: string): void {
  console.info("[PLAN_TRIP_CREATE_MINIMAL_SUCCESS]", { tripId });
}

export function logPlanTripSaveDaysStart(tripId: string): void {
  console.info("[PLAN_TRIP_SAVE_DAYS_START]", { tripId });
}

export function logPlanTripSaveStopsStart(tripId: string, stopCount: number): void {
  console.info("[PLAN_TRIP_SAVE_STOPS_START]", { tripId, stopCount });
}

export function logPlanTripSaveSuccess(tripId: string, title: string): void {
  console.info("[PLAN_TRIP_SAVE_SUCCESS]", { tripId, title });
}

export function logPlanTripSaveTimeout(step: string): void {
  console.error("[PLAN_TRIP_SAVE_TIMEOUT]", { step });
}

export function logPlanTripSaveError(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[PLAN_TRIP_SAVE_ERROR]", { step, message });
}

export function logManualTripCreateClicked(): void {
  console.info("[MANUAL_TRIP_CREATE_CLICKED]", { at: new Date().toISOString() });
}

export function logManualTripContextReady(fields: Record<string, unknown>): void {
  console.info("[MANUAL_TRIP_CONTEXT_READY]", fields);
}

export function logManualTripCreateStart(): void {
  console.info("[MANUAL_TRIP_CREATE_START]");
}

export function logManualTripCreateSuccess(tripId: string): void {
  console.info("[MANUAL_TRIP_CREATE_SUCCESS]", { tripId });
}

export function logManualTripSaveSuccess(tripId: string, title: string): void {
  console.info("[MANUAL_TRIP_SAVE_SUCCESS]", { tripId, title });
}

export function logManualTripNavigate(tripId: string, route: string): void {
  console.info("[MANUAL_TRIP_NAVIGATE]", { tripId, route });
}

export function logManualTripError(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[MANUAL_TRIP_ERROR]", { step, message });
}

export function logManualTripLoadingCleared(): void {
  console.info("[MANUAL_TRIP_LOADING_CLEARED]");
}
