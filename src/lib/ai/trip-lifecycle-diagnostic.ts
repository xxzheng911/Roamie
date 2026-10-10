const stages = ["final_planner_gate", "destination_resolution", "draft_payload_created", "save_started", "save_result", "navigation_started", "navigation_completed", "aborted"] as const;
const failures = ["planner_not_renderable", "candidate_insufficient", "destination_unresolved", "draft_payload_failed", "save_failed", "navigation_failed", "generation_failed", "entry_blocked"] as const;
export type TripLifecycleFailure = typeof failures[number];
/** Fixed allowlists only; logging must never change the lifecycle or serialize errors/payloads. */
export function logTripLifecycle(stage: typeof stages[number], details: {
  correlationToken?: string; success?: boolean; renderable?: boolean; hasTripId?: boolean; count?: number; failureCode?: TripLifecycleFailure;
} = {}): void {
  try {
    if (!stages.includes(stage)) return;
    const safe: Record<string, boolean | number | string> = {};
    if (typeof details.correlationToken === "string" && /^[a-f0-9]{8}$/.test(details.correlationToken)) safe.correlationToken = details.correlationToken;
    for (const key of ["success", "renderable", "hasTripId"] as const) {
      if (typeof details[key] === "boolean") safe[key] = details[key];
    }
    if (Number.isSafeInteger(details.count) && details.count! >= 0) safe.count = details.count!;
    if (stage === "aborted" && failures.includes(details.failureCode!)) safe.failureCode = details.failureCode!;
    console.warn(`[AI_TRIP_LIFECYCLE] ${stage}`, JSON.stringify(safe));
  } catch { /* Diagnostic failure must not interrupt generation/save/navigation. */ }
}
