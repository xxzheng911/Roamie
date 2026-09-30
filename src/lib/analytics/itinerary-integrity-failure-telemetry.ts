/** Observation only: never pass raw integrity reasons or candidate objects to analytics. */
export const INTEGRITY_REASONS = [
  "insufficient_deliverable_capacity",
  "selected_combination_integrity_failed",
] as const;
export const INTEGRITY_RULE_CODES = [
  "fallback_over_selected", "silent_drop", "unselected_combination_place",
  "missing_combination", "empty_day", "empty_non_free_day", "insufficient_real_places",
  "missing_required_anchors", "illegal_replacement", "coverage",
] as const;
const COUNT_KEYS = [
  "selected_input_count", "planner_input_count", "required_capacity", "delivered_place_count",
  "coverage_required_count", "coverage_scheduled_count", "coverage_unresolved_count",
  "coverage_merged_count", "coverage_invalid_count", "coverage_fallback_count",
  "required_anchor_count", "covered_anchor_count", "missing_anchor_count",
] as const;
type Reason = (typeof INTEGRITY_REASONS)[number];
type Rule = (typeof INTEGRITY_RULE_CODES)[number];
type Count = (typeof COUNT_KEYS)[number];
export type IntegrityFailureTelemetry = Partial<Record<Count, number>> & {
  rules: [];
  integrity_reason?: Reason;
  integrity_rule_codes?: Rule[];
  per_day_place_counts?: number[];
};
const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000;

/** Strict enum input. Payload text, identities, unknown fields and invalid counters are omitted. */
export function sanitizeIntegrityFailureTelemetry(value: unknown): IntegrityFailureTelemetry {
  const result: IntegrityFailureTelemetry = { rules: [] };
  if (!value || typeof value !== "object") return result;
  const source = value as Record<string, unknown>;
  if (!INTEGRITY_REASONS.includes(source.integrity_reason as Reason)) return result;
  result.integrity_reason = source.integrity_reason as Reason;
  if (Array.isArray(source.integrity_rule_codes)) {
    result.integrity_rule_codes = [...new Set(source.integrity_rule_codes.filter(
      (code): code is Rule => typeof code === "string" && INTEGRITY_RULE_CODES.includes(code as Rule),
    ))];
  }
  for (const key of COUNT_KEYS) if (validCount(source[key])) result[key] = source[key];
  if (Array.isArray(source.per_day_place_counts) && source.per_day_place_counts.length <= 30 &&
      source.per_day_place_counts.every(validCount)) {
    result.per_day_place_counts = [...source.per_day_place_counts];
  }
  return result;
}

/** Internal reasons can carry place names. Extract only exact known prefixes, never their suffixes. */
export function integrityRuleCodes(reasons: readonly string[]): Rule[] {
  return [...new Set(reasons.flatMap((reason) => {
    const code = reason.split(/[:=]/, 1)[0];
    return INTEGRITY_RULE_CODES.includes(code as Rule) ? [code as Rule] : [];
  }))];
}
