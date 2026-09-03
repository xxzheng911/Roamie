export type PlanningSelectionHandoffStage =
  | "arrange_click"
  | "form_context_resolved"
  | "start_place_resolve_start"
  | "start_place_resolve_done"
  | "destination_resolve_start"
  | "destination_resolve_done"
  | "handoff_build_start"
  | "handoff_build_done"
  | "handoff_persist_start"
  | "handoff_persist_done"
  | "chat_navigation_start"
  | "chat_navigation_done"
  | "chat_mount"
  | "handoff_consume_start"
  | "handoff_consume_done"
  | "selection_session_create_start"
  | "selection_session_create_done"
  | "initial_recommendation_start"
  | "initial_recommendation_done"
  | "selection_first_render"
  | "handoff_loading_clear";

export type PlanningSelectionHandoffTrace = {
  handoffId: string;
  startedAt: number;
  destination: string;
  startPlace: string;
  selectedStyles: string[];
  tripDays: number;
};

export function logPlanningSelectionHandoffBuildStage(
  stage: string,
  status: "start" | "done" | "error" | "timeout",
  trace: PlanningSelectionHandoffTrace,
  blockingDependency: string,
  failureReason = "",
): void {
  console.info("[PLANNING_SELECTION_HANDOFF_BUILD_STAGE]", {
    stage,
    status,
    elapsedMs: Date.now() - trace.startedAt,
    handoffId: trace.handoffId,
    blockingDependency,
    failureReason,
  });
}

export function createPlanningSelectionHandoffTrace(
  input: Omit<PlanningSelectionHandoffTrace, "handoffId" | "startedAt">,
): PlanningSelectionHandoffTrace {
  return {
    ...input,
    handoffId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `selection-handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt: Date.now(),
  };
}

export function logPlanningSelectionHandoffStage(
  stage: PlanningSelectionHandoffStage,
  trace: PlanningSelectionHandoffTrace,
  detail?: { success?: boolean; failureReason?: string; sessionId?: string },
): void {
  console.info("[PLANNING_SELECTION_HANDOFF_STAGE]", {
    stage,
    elapsedMs: Date.now() - trace.startedAt,
    handoffId: trace.handoffId,
    sessionId: detail?.sessionId ?? null,
    destination: trace.destination,
    startPlace: trace.startPlace,
    selectedStyles: trace.selectedStyles,
    tripDays: trace.tripDays,
    success: detail?.success ?? true,
    failureReason: detail?.failureReason ?? "",
  });
}

export function logPlanningSelectionHandoffLoading(
  trace: PlanningSelectionHandoffTrace,
  loading: boolean,
  reason: string,
  blockingDependency: string | null,
): void {
  console.info("[PLANNING_SELECTION_HANDOFF_LOADING]", {
    elapsedMs: Date.now() - trace.startedAt,
    handoffId: trace.handoffId,
    destination: trace.destination,
    loading,
    reason,
    blockingDependency,
  });
}
