import { actionSources, logTripAction, type TripActionDiagnostic } from "./trip-action-diagnostic";
const stages = ['received', 'decision', 'ownership', 'handoff_started', 'handoff_skipped', 'handed_to_persistence', 'planner_start', 'final_planner_gate', 'result_received', 'result_cleared', 'result_returned', 'frozen_restored', 'authority_restored'] as const;
const reasons = ['persist_explicit_build', 'preview_only', 'recommendation_only', 'intent_not_recognized', 'busy_rejected', 'stale_generation', 'missing_generation_id', 'missing_day_plan', 'incomplete_render_result', 'empty_render_result', 'duplicate_generation', 'entry_blocked', 'validator_failed', 'insufficient_candidates', 'itinerary_plan_incomplete', 'no_valid_geocoded_places', 'planner_exception'] as const;
const entries = ['plan_form_ai', 'plan_form', 'advice', 'direct_intent', 'regenerate', 'recommendation', 'unknown'] as const;
export type PlanCorrelation = {
  tripActionDiagnostic?: TripActionDiagnostic;
  hasDayPlan?: boolean; dayPlanCount?: number;
  correlationToken?: string; entryType?: typeof entries[number]; explicitCreate?: boolean; fromPlanAi?: boolean; styleReselect?: boolean;
};
const sourceStages = ["planner", "recommendation_wrapper", "chat_callback", "handoff_policy", "persistence"] as const;
type Details = PlanCorrelation & {
  dayPlanCount?: number; sourceStage?: typeof sourceStages[number];
  reason?: typeof reasons[number]; entryType?: typeof entries[number];
  shouldPersist?: boolean; hasDayPlan?: boolean; renderable?: boolean;
  fromPlanForm?: boolean; fromPlanAi?: boolean; planAiMode?: boolean;
  explicitCreate?: boolean; styleReselect?: boolean; triggerKnown?: boolean;
  triggerItineraryGeneration?: boolean; hasGenerationId?: boolean;
  busy?: boolean; accepted?: boolean; current?: boolean;
};
/** Only allowlisted enums/booleans. Never serialize input, identifiers or errors. */
export function logGeneratedPlanHandoff(stage: typeof stages[number], details: Details = {}): void {
  try {
    if (!stages.includes(stage)) return;
    if (stage === 'planner_start' || stage === 'received') logTripAction(stage === 'planner_start' ? 'planner_started' : 'handoff_received', details.tripActionDiagnostic, details.explicitCreate === true, details.correlationToken);
    const safe: Record<string, string | boolean | number> = {};
    if (typeof details.correlationToken === "string" && /^[a-f0-9]{8}$/.test(details.correlationToken)) safe.correlationToken = details.correlationToken;
    if (details.tripActionDiagnostic) {
      const action = details.tripActionDiagnostic;
      if (actionSources.includes(action.actionSource)) safe.actionSource = action.actionSource;
      if (/^[a-f0-9]{8}$/.test(action.actionToken)) safe.actionToken = action.actionToken;
    }
    if (sourceStages.includes(details.sourceStage!)) safe.sourceStage = details.sourceStage!;
    if (Number.isSafeInteger(details.dayPlanCount) && details.dayPlanCount! >= 0) safe.dayPlanCount = details.dayPlanCount!;
    if (reasons.includes(details.reason!)) safe.reason = details.reason!;
    if (entries.includes(details.entryType!)) safe.entryType = details.entryType!;
    for (const key of ['shouldPersist','hasDayPlan','renderable','fromPlanForm','fromPlanAi','planAiMode','explicitCreate','styleReselect','triggerKnown','triggerItineraryGeneration','hasGenerationId','busy','accepted','current'] as const) {
      if (typeof details[key] === 'boolean') safe[key] = details[key]!;
    }
    console.warn(`[GENERATED_PLAN_HANDOFF] ${stage}`, JSON.stringify(safe));
  } catch { /* Diagnostics must not change control flow. */ }
}

/** Only hash an opaque generation ID, never a prompt, destination or user ID. */
export function planCorrelationToken(generationId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < generationId.length; i++) hash = Math.imul(hash ^ generationId.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
