/** 目的地規劃推薦流程階段（聊聊 state machine） */
export type PlanningRecommendationStage =
  | "intent_detected"
  | "destination_detected"
  | "preference_collected"
  | "ready_to_recommend"
  | "recommendations_generated";

export function planningStageAfterMustVisitIntent(
  hasDestination: boolean,
): PlanningRecommendationStage {
  return hasDestination ? "ready_to_recommend" : "intent_detected";
}

export function planningStageAfterRecommendations(): PlanningRecommendationStage {
  return "recommendations_generated";
}
