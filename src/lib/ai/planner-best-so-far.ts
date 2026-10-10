import { plannerFailureCounts } from "@/lib/ai/planner-validation-diagnostic";
export type PlannerCandidateSource = "initial" | "refill" | "retry" | "classic_rebuild" | "fallback";
export type PlannerSnapshotQuality = {
  validationDiagnostics?: Record<string, Record<string, number>>;
  valid: boolean; renderable: boolean; totalCount: number;
  perDayCounts: number[]; completeDays: number; canonicalCount: number; affectedDays: number;
};
/** Existing planner score decides completeness; canonical count only breaks equal scores. */
export function comparePlannerSnapshots<T extends PlannerSnapshotQuality>(
  current: T, candidate: T, better: (a: T, b: T) => boolean,
): { replaced: boolean; reason: string } {
  if (candidate.totalCount === 0 && current.totalCount > 0) return { replaced: false, reason: "empty_candidate" };
  if (candidate.valid !== current.valid) return { replaced: candidate.valid, reason: "validation" };
  if (candidate.renderable !== current.renderable) return { replaced: candidate.renderable, reason: "renderability" };
  if (candidate.affectedDays !== current.affectedDays) return { replaced: candidate.affectedDays < current.affectedDays, reason: "affected_days" };
  if (candidate.completeDays !== current.completeDays) return { replaced: candidate.completeDays > current.completeDays, reason: "daily_completeness" };
  if (better(candidate, current)) return { replaced: true, reason: "existing_planner_quality" };
  if (better(current, candidate)) return { replaced: false, reason: "existing_planner_quality" };
  if (candidate.canonicalCount !== current.canonicalCount) return { replaced: candidate.canonicalCount > current.canonicalCount, reason: "canonical_count" };
  return { replaced: false, reason: "keep_equal" };
}

/** Never serialize validator reasons: they may contain place names/IDs. */
export function fixedPlannerFailureCodes(reasons: readonly string[]): string[] {
  return Object.keys(plannerFailureCounts(reasons));
}
export function logPlannerReplacement(source: PlannerCandidateSource, old: PlannerSnapshotQuality, next: PlannerSnapshotQuality, decision: { replaced: boolean; reason: string }, oldReasons: string[], newReasons: string[]): void {
  try {
    console.warn("[PLANNER_BEST_SO_FAR]", JSON.stringify({
      candidateSource: source, replaced: decision.replaced,
      oldRenderable: old.renderable, newRenderable: next.renderable,
      oldCount: old.totalCount, newCount: next.totalCount,
      oldAffectedDays: old.affectedDays, newAffectedDays: next.affectedDays,
      replacementReason: decision.reason,
      oldValidationReasonCounts: old.validationDiagnostics,
      newValidationReasonCounts: next.validationDiagnostics,
      oldFailureCodes: fixedPlannerFailureCodes(oldReasons),
      newFailureCodes: fixedPlannerFailureCodes(newReasons),
    }));
  } catch { /* Diagnostics never affect selection. */ }
}
