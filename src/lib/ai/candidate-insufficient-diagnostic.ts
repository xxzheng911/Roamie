type CandidateDiagnostic = {
  requiredCount: number; availableCount: number; affectedDaysCount: number;
  dayCounts: number[]; pace?: string;
  candidateInsufficientFromEarlyState: boolean;
  finalRenderable?: boolean; gracefulDegradationAllowed?: boolean;
  candidateInsufficientRecomputedFinal?: boolean;
  finalRequiredCount?: number; finalAvailableCount?: number;
  finalAffectedDaysCount?: number; minimumPlacesPerDay?: number;
};

/** Only counts and fixed enums; early events deliberately omit unknown final state. */
export function logCandidateDiagnostic(
  event: "CANDIDATE_INSUFFICIENT_RESULT" | "CANDIDATE_INSUFFICIENT_BLOCK_SAVE",
  details: CandidateDiagnostic,
): void {
  try {
    if (!["CANDIDATE_INSUFFICIENT_RESULT", "CANDIDATE_INSUFFICIENT_BLOCK_SAVE"].includes(event)) return;
    const safe: Record<string, number | boolean | string | number[]> = {};
    for (const key of ["requiredCount", "availableCount", "affectedDaysCount", "finalRequiredCount", "finalAvailableCount", "finalAffectedDaysCount", "minimumPlacesPerDay"] as const) {
      const value = details[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
    }
    for (const key of ["finalRenderable", "gracefulDegradationAllowed", "candidateInsufficientFromEarlyState", "candidateInsufficientRecomputedFinal"] as const) {
      if (typeof details[key] === "boolean") safe[key] = details[key];
    }
    safe.dayCounts = details.dayCounts.filter(value => Number.isSafeInteger(value) && value >= 0);
    if (["slow", "medium", "active"].includes(details.pace ?? "")) safe.pace = details.pace!;
    console.warn(`[${event}]`, JSON.stringify(safe));
  } catch { /* Diagnostics must never affect planner decisions. */ }
}
