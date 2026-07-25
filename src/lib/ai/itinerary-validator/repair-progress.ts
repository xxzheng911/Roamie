import type { ComposedDayPlan } from "@/lib/ai/ai-day-plan-source";
import { classifyDailyDiversityCategory } from "@/lib/ai/daily-category-diversity";
import {
  HARD_BLOCK_RULE_CODES,
  REPAIR_FIRST_HARD_RULE_CODES,
  SOFT_REPAIRABLE_RULE_CODES,
  type ItineraryFailedRule,
  type ItineraryValidationResult,
} from "@/lib/ai/itinerary-validator/types";
import { isPlaceLocked, type SelectedPlaceLock } from "@/lib/ai/required-anchor-runtime";

type SignableDayPlan = ComposedDayPlan & { date?: string };

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sortedUnique<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
}

function ruleClassification(rule: ItineraryFailedRule): "hard" | "repair" | "soft" | "fail" {
  if ((HARD_BLOCK_RULE_CODES as readonly string[]).includes(rule.code)) return "hard";
  if ((REPAIR_FIRST_HARD_RULE_CODES as readonly string[]).includes(rule.code)) return "repair";
  if ((SOFT_REPAIRABLE_RULE_CODES as readonly string[]).includes(rule.code)) return "soft";
  return "fail";
}

function entryLocked(
  plan: ComposedDayPlan,
  entryIndex: number,
  lock: SelectedPlaceLock | null | undefined,
): boolean {
  const entry = plan.entries[entryIndex];
  if (!entry || !lock) return false;
  return isPlaceLocked(
    {
      name: entry.name,
      placeName: entry.place.name,
      id: entry.place.id,
      googlePlaceId: entry.place.id,
    },
    lock,
  );
}

/** Stable content signature; excludes request IDs, timestamps and object identity. */
export function buildItineraryPlanSignature(
  plans: readonly ComposedDayPlan[],
  lock?: SelectedPlaceLock | null,
): string {
  const signablePlans: readonly SignableDayPlan[] = plans;
  return [...signablePlans]
    .sort((a, b) => a.day - b.day)
    .map((plan) => {
      const entries = plan.entries.map((entry, index) =>
        [
          index,
          normalizedText(entry.place.id),
          normalizedText(entry.time),
          normalizedText(entry.label),
          classifyDailyDiversityCategory(entry.place),
          entryLocked(plan, index, lock) ? "locked" : "movable",
        ].join("~"),
      );
      return [plan.day, normalizedText(plan.date ?? ""), entries.join(",")].join(":");
    })
    .join("|");
}

/** Stable failed-rule fingerprint. Warning order is intentionally excluded. */
export function buildItineraryFailureFingerprint(
  validation: Pick<
    ItineraryValidationResult,
    "failedRules" | "affectedDays" | "affectedPlaceIds" | "pass"
  >,
): string {
  if (validation.pass) return "pass";
  const failedDays = validation.failedRules
    .map((rule) => rule.day)
    .filter((day): day is number => day != null);
  const failedPlaceIds = validation.failedRules.flatMap((rule) => rule.placeIds ?? []);
  const rules = validation.failedRules
    .map((rule) =>
      [
        rule.code,
        ruleClassification(rule),
        rule.day ?? 0,
        normalizedText(rule.message),
        sortedUnique(rule.placeIds ?? []).join(","),
      ].join("~"),
    )
    .sort();
  return [
    rules.join("|"),
    `days=${sortedUnique(failedDays).join(",")}`,
    `places=${sortedUnique(failedPlaceIds).join(",")}`,
  ].join("#");
}

export function shortRepairFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hardFailureCount(validation: ItineraryValidationResult): number {
  return validation.failedRules.filter((rule) =>
    (HARD_BLOCK_RULE_CODES as readonly string[]).includes(rule.code),
  ).length;
}

function failedDayCount(validation: ItineraryValidationResult): number {
  return new Set(
    validation.failedRules
      .map((rule) => rule.day)
      .filter((day): day is number => day != null),
  ).size;
}

function failedPlaceIdCount(validation: ItineraryValidationResult): number {
  return new Set(validation.failedRules.flatMap((rule) => rule.placeIds ?? [])).size;
}

function operationDifferenceCount(
  before: readonly ComposedDayPlan[],
  after: readonly ComposedDayPlan[],
): number {
  const tokens = (plans: readonly ComposedDayPlan[]) =>
    [...plans]
      .sort((a, b) => a.day - b.day)
      .flatMap((plan) =>
        plan.entries.map((entry, index) => `${plan.day}:${index}:${entry.place.id}:${entry.time}:${entry.label}`),
      );
  const beforeTokens = tokens(before);
  const afterTokens = tokens(after);
  const length = Math.max(beforeTokens.length, afterTokens.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (beforeTokens[index] !== afterTokens[index]) changed += 1;
  }
  return changed;
}

export type RepairProgressAssessment = {
  planSignatureBefore: string;
  planSignatureAfter: string;
  failureFingerprintBefore: string;
  failureFingerprintAfter: string;
  operationCount: number;
  actualPlanChanged: boolean;
  hardFailureImproved: boolean;
  noProgress: boolean;
  cycleDetected: boolean;
};

export type RepairRoundStopReason = "success" | "no_progress" | "cycle_detected";

export function resolveRepairRoundStopReason(
  validationPass: boolean,
  progress: Pick<RepairProgressAssessment, "noProgress" | "cycleDetected">,
): RepairRoundStopReason | null {
  if (validationPass) return "success";
  if (progress.noProgress) return "no_progress";
  if (progress.cycleDetected) return "cycle_detected";
  return null;
}

export function assessRepairProgress(params: {
  plansBefore: readonly ComposedDayPlan[];
  plansAfter: readonly ComposedDayPlan[];
  validationBefore: ItineraryValidationResult;
  validationAfter: ItineraryValidationResult;
  seenPlanSignatures: ReadonlySet<string>;
  lock?: SelectedPlaceLock | null;
}): RepairProgressAssessment {
  const planSignatureBefore = buildItineraryPlanSignature(params.plansBefore, params.lock);
  const planSignatureAfter = buildItineraryPlanSignature(params.plansAfter, params.lock);
  const failureFingerprintBefore = buildItineraryFailureFingerprint(params.validationBefore);
  const failureFingerprintAfter = buildItineraryFailureFingerprint(params.validationAfter);
  const beforeStops = params.plansBefore.reduce((count, plan) => count + plan.entries.length, 0);
  const afterStops = params.plansAfter.reduce((count, plan) => count + plan.entries.length, 0);
  const actualPlanChanged = planSignatureBefore !== planSignatureAfter;
  const failureChanged = failureFingerprintBefore !== failureFingerprintAfter;
  const operationCount = operationDifferenceCount(params.plansBefore, params.plansAfter);
  const hardFailureImproved =
    params.validationAfter.pass ||
    hardFailureCount(params.validationAfter) < hardFailureCount(params.validationBefore) ||
    failedDayCount(params.validationAfter) < failedDayCount(params.validationBefore) ||
    failedPlaceIdCount(params.validationAfter) < failedPlaceIdCount(params.validationBefore);
  const noProgress =
    !params.validationAfter.pass &&
    !actualPlanChanged &&
    !failureChanged &&
    operationCount === 0 &&
    beforeStops === afterStops;
  const cycleDetected =
    actualPlanChanged && params.seenPlanSignatures.has(planSignatureAfter);

  return {
    planSignatureBefore,
    planSignatureAfter,
    failureFingerprintBefore,
    failureFingerprintAfter,
    operationCount,
    actualPlanChanged,
    hardFailureImproved,
    noProgress,
    cycleDetected,
  };
}
