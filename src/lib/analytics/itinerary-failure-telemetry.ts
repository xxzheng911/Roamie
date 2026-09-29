import { MAX_ITINERARY_DAYS } from "@/lib/ai/itinerary-days";

/**
 * Counts-only diagnostics for itinerary_generation_failed.
 * Rule codes only. Never place names, ids, coordinates, or user text.
 */
export const ITINERARY_FAILURE_RULE_CODES = [
  "days_date_consistency",
  "day_place_count",
  "day_capacity_pace_lock",
  "daily_category_diversity",
  "missing_days",
  "place_duplicate",
  "user_exclusions",
  "unsuitable_place",
  "meal_slot_category",
  "nightlife_timing",
  "business_hours_cover",
  "route_travel_time",
  "route_backtrack",
  "timeline_conflict",
  "nearby_extension_coverage",
  "multi_day_balance",
  "persistence_mismatch",
  "required_anchor_coverage_mismatch",
] as const;

export type ItineraryFailureRuleCode = (typeof ITINERARY_FAILURE_RULE_CODES)[number];

const ALLOWED_RULES = new Set<string>(ITINERARY_FAILURE_RULE_CODES);
const MAX_RULES = 8;
const MAX_COUNT = 10_000;

export type ItineraryFailureTelemetry = {
  rules: ItineraryFailureRuleCode[];
  selected_input_count?: number;
  normalized_count?: number;
  usable_candidate_count?: number;
  delivered_place_count?: number;
  per_day_place_counts?: number[];
  required_capacity?: number;
  geographic_rejection_count?: number;
  dedupe_rejection_count?: number;
  eligibility_rejection_count?: number;
};

const COUNT_KEYS = [
  "selected_input_count",
  "normalized_count",
  "usable_candidate_count",
  "delivered_place_count",
  "required_capacity",
  "geographic_rejection_count",
  "dedupe_rejection_count",
  "eligibility_rejection_count",
] as const;

type CountKey = (typeof COUNT_KEYS)[number];

export type ItineraryFailureTelemetryInput = {
  failedRules?: readonly { code?: unknown; message?: unknown }[] | null;
  selectedInputCount?: number | null;
  normalizedCount?: number | null;
  usableCandidateCount?: number | null;
  deliveredPlaceCount?: number | null;
  perDayPlaceCounts?: readonly number[] | null;
  requiredCapacity?: number | null;
  geographicRejectionCount?: number | null;
  dedupeRejectionCount?: number | null;
  eligibilityRejectionCount?: number | null;
};

function countOrOmit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_COUNT) {
    return undefined;
  }
  return value;
}

function dayCountsOrOmit(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITINERARY_DAYS) {
    return undefined;
  }
  const days: number[] = [];
  for (const item of value) {
    const count = countOrOmit(item);
    if (count == null) return undefined;
    days.push(count);
  }
  return days;
}

export function itineraryFailureRuleCodes(
  failedRules: ItineraryFailureTelemetryInput["failedRules"],
): ItineraryFailureRuleCode[] {
  const rules: ItineraryFailureRuleCode[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string" || !ALLOWED_RULES.has(value) || seen.has(value)) return;
    if (rules.length >= MAX_RULES) return;
    seen.add(value);
    rules.push(value as ItineraryFailureRuleCode);
  };
  for (const rule of failedRules ?? []) {
    if (!rule || typeof rule !== "object") continue;
    push(rule.code);
    if (rule.message === "required_anchor_coverage_mismatch") push(rule.message);
  }
  return rules;
}

export function buildItineraryValidatorFailureTelemetry(
  input: ItineraryFailureTelemetryInput,
): ItineraryFailureTelemetry {
  const telemetry: ItineraryFailureTelemetry = {
    rules: itineraryFailureRuleCodes(input.failedRules),
  };
  const counts: Record<CountKey, unknown> = {
    selected_input_count: input.selectedInputCount,
    normalized_count: input.normalizedCount,
    usable_candidate_count: input.usableCandidateCount,
    delivered_place_count: input.deliveredPlaceCount,
    required_capacity: input.requiredCapacity,
    geographic_rejection_count: input.geographicRejectionCount,
    dedupe_rejection_count: input.dedupeRejectionCount,
    eligibility_rejection_count: input.eligibilityRejectionCount,
  };
  for (const key of COUNT_KEYS) {
    const count = countOrOmit(counts[key]);
    if (count != null) telemetry[key] = count;
  }
  const perDay = dayCountsOrOmit(input.perDayPlaceCounts);
  if (perDay) telemetry.per_day_place_counts = perDay;
  return telemetry;
}

/** Last gate before analytics JSON. Drops every key that is not an allowlisted count or rule code. */
export function sanitizeItineraryFailureTelemetry(value: unknown): ItineraryFailureTelemetry {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const failedRules = Array.isArray(source.rules)
    ? source.rules.map((rule) => ({ code: rule }))
    : [];
  const input: ItineraryFailureTelemetryInput = {
    failedRules,
    selectedInputCount: source.selected_input_count as number | null,
    normalizedCount: source.normalized_count as number | null,
    usableCandidateCount: source.usable_candidate_count as number | null,
    deliveredPlaceCount: source.delivered_place_count as number | null,
    perDayPlaceCounts: source.per_day_place_counts as number[] | null,
    requiredCapacity: source.required_capacity as number | null,
    geographicRejectionCount: source.geographic_rejection_count as number | null,
    dedupeRejectionCount: source.dedupe_rejection_count as number | null,
    eligibilityRejectionCount: source.eligibility_rejection_count as number | null,
  };
  return buildItineraryValidatorFailureTelemetry(input);
}
