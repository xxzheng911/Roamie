import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import { formatTripLocationLabel } from "@/lib/location/format";

export function logPlanAiButtonClicked(): void {
  console.info("[PLAN_AI_BUTTON_CLICKED]", { at: new Date().toISOString() });
}

export function logPlanAiContextReady(form: PlanTripFormInput): void {
  console.info("[PLAN_AI_CONTEXT_READY]", {
    destination: formatTripLocationLabel(form.destination),
    origin: form.origin ? formatTripLocationLabel(form.origin) : null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    days: form.days,
    travelers: form.travelers,
    budgetMode: form.budgetMode,
    transport: form.transport || null,
    travelStyles: form.styles,
    selectedPlacesCount: form.selectedPlaces?.length ?? 0,
  });
}

export function logPlanAiAfterWeather(fields: {
  hasWeather: boolean;
  weatherSource?: string | null;
  error?: string | null;
}): void {
  console.info("[PLAN_AI_AFTER_WEATHER]", fields);
}

export function logPlanAiBeforeOpenai(fields: {
  destination: string;
  days: number;
  selectedPlacesCount: number;
  bootstrapSkipped?: boolean;
}): void {
  console.info("[PLAN_AI_BEFORE_OPENAI]", fields);
}

export function logPlanAiOpenAiRequestStart(payload: {
  destination: string;
  days: number;
  style: string;
  transport: string;
  selectedPlacesCount: number;
}): void {
  console.info("[PLAN_AI_OPENAI_REQUEST_START]", payload);
}

export function logPlanAiBlocked(fields: {
  reason: string;
  hasDestination: boolean;
  hasDate: boolean;
  hasStyles: boolean;
  hasWeather: boolean;
  extra?: string;
}): void {
  console.error("[PLAN_AI_BLOCKED]", fields);
}

export function logPlanAiBootstrapSkipped(reason: string): void {
  console.info("[PLAN_AI_BOOTSTRAP_SKIPPED]", { reason });
}

export function logPlanAiOpenAiResponseReceived(params: {
  title?: string;
  itemCount: number;
  usedLocalFallback?: boolean;
}): void {
  console.info("[PLAN_AI_OPENAI_RESPONSE_RECEIVED]", params);
}

export function logPlanAiParseSuccess(params: {
  itemCount: number;
  title?: string;
  usedLocalFallback?: boolean;
}): void {
  console.info("[PLAN_AI_PARSE_SUCCESS]", params);
}

export function logPlanAiTripCreated(params: { tripId: string; title: string }): void {
  console.info("[PLAN_AI_TRIP_CREATED]", params);
}

export function logPlanAiSaveSuccess(params: { tripId: string; title: string }): void {
  console.info("[PLAN_AI_SAVE_SUCCESS]", params);
}

export function logPlanAiNavigateTrip(params: { tripId: string; route?: string }): void {
  console.info("[PLAN_AI_NAVIGATE_TRIP]", params);
}

export function logPlanAiNavigateFailed(params: {
  tripId: string;
  route: string;
  error: unknown;
}): void {
  const message =
    params.error instanceof Error ? params.error.message : String(params.error);
  console.error("[PLAN_AI_NAVIGATE_FAILED]", {
    tripId: params.tripId,
    route: params.route,
    message,
  });
}

export function logPlanAiError(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[PLAN_AI_ERROR]", { step, message });
}

export function logPlanAiLoadingCleared(): void {
  console.info("[PLAN_AI_LOADING_CLEARED]", { at: new Date().toISOString() });
}
