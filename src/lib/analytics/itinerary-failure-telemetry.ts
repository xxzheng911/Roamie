import { sanitizeIntegrityFailureTelemetry, type IntegrityFailureTelemetry } from "./itinerary-integrity-failure-telemetry";
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

export type TimelineConflictDiagnostic = {
  day: number;
  time: string;
  count: number;
};

export const TIMELINE_NORMALIZATION_STATUSES = ["not_called", "safe", "no_safe_slot"] as const;

export type TimelineNormalizationStatus = (typeof TIMELINE_NORMALIZATION_STATUSES)[number];

export type TimelineNormalizationTelemetry = {
  status: TimelineNormalizationStatus;
  affected_days?: number[];
};

export type ItineraryFailureTelemetry = Partial<Omit<IntegrityFailureTelemetry, "rules">> & {
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
  timeline_conflicts?: TimelineConflictDiagnostic[];
  timeline_normalization?: TimelineNormalizationTelemetry;
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
  /** Clock strings already on the validated plan. No place identity. */
  timelineDayTimes?: readonly { day?: unknown; times?: readonly unknown[] }[] | null;
  /** Outcome already returned by normalization invocations. Not inferred from conflicts. */
  timelineNormalization?: {
    status?: unknown;
    affectedDays?: readonly unknown[] | null;
  } | null;
  requestedDayCount?: number | null;
};

const MAX_TIMELINE_CONFLICTS = 4;
const HHMM = /^(\d{1,2}):(\d{2})$/;

/** Legal HH:mm only. Unparseable clocks are omitted instead of mapped to a default. */
export function canonicalTimelineClock(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(HHMM);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return undefined;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Same-day duplicate legal clocks. Cross-day matches are separate groups and are not conflicts. */
export function collectTimelineConflictDiagnostics(
  days: ItineraryFailureTelemetryInput["timelineDayTimes"],
): TimelineConflictDiagnostic[] {
  const byDay = new Map<number, Map<string, number>>();
  for (const day of days ?? []) {
    if (!day || typeof day !== "object") continue;
    const dayNumber = day.day;
    if (
      typeof dayNumber !== "number" ||
      !Number.isInteger(dayNumber) ||
      dayNumber < 1 ||
      dayNumber > MAX_ITINERARY_DAYS
    ) {
      continue;
    }
    const counts = byDay.get(dayNumber) ?? new Map<string, number>();
    for (const time of day.times ?? []) {
      const clock = canonicalTimelineClock(time);
      if (!clock) continue;
      counts.set(clock, (counts.get(clock) ?? 0) + 1);
    }
    byDay.set(dayNumber, counts);
  }
  const conflicts: TimelineConflictDiagnostic[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const counts = byDay.get(day);
    if (!counts) continue;
    for (const time of [...counts.keys()].sort()) {
      const count = counts.get(time);
      if (count == null || count < 2 || count > MAX_COUNT) continue;
      conflicts.push({ day, time, count });
      if (conflicts.length >= MAX_TIMELINE_CONFLICTS) return conflicts;
    }
  }
  return conflicts;
}

function timelineConflictsOrOmit(value: unknown): TimelineConflictDiagnostic[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TIMELINE_CONFLICTS) {
    return undefined;
  }
  const conflicts: TimelineConflictDiagnostic[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    const day = record.day;
    const time = canonicalTimelineClock(record.time);
    const count = record.count;
    if (
      typeof day !== "number" ||
      !Number.isInteger(day) ||
      day < 1 ||
      day > MAX_ITINERARY_DAYS ||
      !time ||
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 2 ||
      count > MAX_COUNT
    ) {
      return undefined;
    }
    conflicts.push({ day, time, count });
  }
  return conflicts;
}

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
  if (telemetry.rules.includes("timeline_conflict")) {
    const conflicts = collectTimelineConflictDiagnostics(input.timelineDayTimes);
    if (conflicts.length > 0) telemetry.timeline_conflicts = conflicts;
    const normalization = timelineNormalizationOrOmit(
      input.timelineNormalization,
      normalizationDayLimit(input.requestedDayCount, input.perDayPlaceCounts),
    );
    if (normalization) telemetry.timeline_normalization = normalization;
  }
  return telemetry;
}

const NORMALIZATION_STATUSES = new Set<string>(TIMELINE_NORMALIZATION_STATUSES);

function normalizationDayLimit(requestedDayCount: unknown, perDayPlaceCounts: unknown): number {
  const requested = countOrOmit(requestedDayCount);
  if (requested != null && requested >= 1 && requested <= MAX_ITINERARY_DAYS) return requested;
  const perDay = dayCountsOrOmit(perDayPlaceCounts);
  if (perDay) return perDay.length;
  return MAX_ITINERARY_DAYS;
}

function affectedDaysOrOmit(value: unknown, maxDay: number): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITINERARY_DAYS) return undefined;
  const seen = new Set<number>();
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1 || item > maxDay) {
      return undefined;
    }
    seen.add(item);
  }
  if (seen.size === 0 || seen.size > maxDay) return undefined;
  return [...seen].sort((left, right) => left - right);
}

/**
 * Accepts an invocation outcome only. Illegal days omit the whole day list
 * instead of keeping a partial guess.
 */
export function timelineNormalizationOrOmit(
  value: unknown,
  maxDay = MAX_ITINERARY_DAYS,
): TimelineNormalizationTelemetry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== "string" || !NORMALIZATION_STATUSES.has(status)) return undefined;
  if (status === "not_called") return { status: "not_called" };
  const days = affectedDaysOrOmit(record.affected_days ?? record.affectedDays, maxDay);
  if (!days) return { status };
  return { status, affected_days: days };
}

/** Last gate before analytics JSON. Drops every key that is not an allowlisted count or rule code. */
export function sanitizeItineraryFailureTelemetry(value: unknown): ItineraryFailureTelemetry {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (Object.prototype.hasOwnProperty.call(source, "integrity_reason")) {
    return sanitizeIntegrityFailureTelemetry(source);
  }
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
  const telemetry = buildItineraryValidatorFailureTelemetry(input);
  if (telemetry.rules.includes("timeline_conflict")) {
    const conflicts = timelineConflictsOrOmit(source.timeline_conflicts);
    if (conflicts) telemetry.timeline_conflicts = conflicts;
    const normalization = timelineNormalizationOrOmit(
      source.timeline_normalization,
      normalizationDayLimit(source.requested_day_count, source.per_day_place_counts),
    );
    if (normalization) telemetry.timeline_normalization = normalization;
  }
  return telemetry;
}
