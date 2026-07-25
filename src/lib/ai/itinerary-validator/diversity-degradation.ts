import {
  canPlaceFillSlot,
  classifyPlanPlaceKind,
  type ComposedDayPlan,
} from "@/lib/ai/ai-day-plan-source";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
  wouldViolateDailyDiversity,
} from "@/lib/ai/daily-category-diversity";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import type { ItineraryValidationResult } from "@/lib/ai/itinerary-validator/types";
import { isPlaceLocked, type SelectedPlaceLock } from "@/lib/ai/required-anchor-runtime";
import { checkStopNavigationIdentity } from "@/lib/saved-trip/stop-navigation";
import { evaluateTourismQuality } from "@/lib/ai/tourism-quality-gate";
import type { PlaceResult } from "@/lib/place-result";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

const MINIMAL_DEGRADABLE_FAMILY = "park_family";
const MINIMAL_OVERFLOW_RE = /^park_family:2>1$/;

function stopNavigationFields(place: PlaceResult) {
  return {
    placeName: place.name,
    title: place.name,
    localizedDisplayName: place.localizedDisplayName,
    googlePlaceId: place.id,
    lat: place.lat,
    lng: place.lng,
    navigationLatitude: place.navigationLatitude,
    navigationLongitude: place.navigationLongitude,
    coordinateSource: place.coordinateSource,
    address: place.address,
  };
}

function entryIsLocked(
  entry: ComposedDayPlan["entries"][number],
  lock: SelectedPlaceLock | null | undefined,
): boolean {
  if (!lock) return false;
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

export type DiversityDegradationEvidence = {
  eligible: boolean;
  degradedRule: "daily_category_diversity" | null;
  degradationReason: string;
  candidatePoolExhausted: boolean;
  repairStalled: boolean;
  cycleDetected: boolean;
  noLegalDonor: boolean;
  structureComplete: boolean;
  stopCount: number;
  replacementCandidateId: string | null;
  candidatePoolChecked: boolean;
  minimalOverflow: boolean;
  failedRuleCount: number;
};

export function logDiversityDegradationDecision(
  evidence: DiversityDegradationEvidence,
): void {
  logAiPipeline(
    "[DIVERSITY_DEGRADATION_DECISION]",
    `onlyRule=${evidence.failedRuleCount === 1}`,
    `failedRuleCount=${evidence.failedRuleCount}`,
    `candidatePoolChecked=${evidence.candidatePoolChecked}`,
    `candidatePoolExhausted=${evidence.candidatePoolExhausted}`,
    `repairStalled=${evidence.repairStalled}`,
    `cycleDetected=${evidence.cycleDetected}`,
    `minimalOverflow=${evidence.minimalOverflow}`,
    `allowed=${evidence.eligible}`,
    `reason=${evidence.degradationReason}`,
  );
}

export function evaluateDiversityDegradationEvidence(params: {
  plans: readonly ComposedDayPlan[];
  validation: ItineraryValidationResult;
  pool: readonly PlaceResult[];
  days: number;
  style?: TripStyleKey;
  plannedDate?: string;
  repairStalled: boolean;
  cycleDetected: boolean;
  lock?: SelectedPlaceLock | null;
}): DiversityDegradationEvidence {
  const stopCount = params.plans.reduce((count, plan) => count + plan.entries.length, 0);
  const sortedDays = [...params.plans].map((plan) => plan.day).sort((a, b) => a - b);
  const structureComplete =
    params.plans.length === params.days &&
    sortedDays.every((day, index) => day === index + 1) &&
    params.plans.every((plan) => plan.entries.length > 0) &&
    stopCount >= params.days;
  const onlyRule =
    params.validation.failedRules.length === 1
      ? params.validation.failedRules[0]
      : undefined;
  const minimalViolation =
    onlyRule?.code === "daily_category_diversity" &&
    MINIMAL_OVERFLOW_RE.test(onlyRule.message.trim());
  const repairFinished = params.repairStalled || params.cycleDetected;
  const routeOk = params.plans.every((plan) =>
    plan.entries.every((entry) => {
      const identity = checkStopNavigationIdentity(stopNavigationFields(entry.place), {
        silent: true,
      });
      return identity.ok && identity.useForDirections;
    }),
  );
  const noClosedStops = params.plans.every((plan) =>
    plan.entries.every(
      (entry) =>
        isClearlyClosedAtSlot(entry.place, params.plannedDate, entry.time) !== true,
    ),
  );

  if (!repairFinished || !structureComplete || !minimalViolation || !routeOk || !noClosedStops) {
    return {
      eligible: false,
      degradedRule: null,
      degradationReason: !repairFinished
        ? "repair_not_stalled"
        : !structureComplete
          ? "incomplete_structure"
          : !minimalViolation
            ? "non_minimal_or_additional_failure"
            : !routeOk
              ? "route_not_navigable"
              : "closed_stop",
      candidatePoolExhausted: false,
      repairStalled: params.repairStalled,
      cycleDetected: params.cycleDetected,
      noLegalDonor: false,
      structureComplete,
      stopCount,
      replacementCandidateId: null,
      candidatePoolChecked: false,
      minimalOverflow: minimalViolation,
      failedRuleCount: params.validation.failedRules.length,
    };
  }

  const violationDay = params.plans.find((plan) => plan.day === onlyRule.day);
  const limits = resolveDailyDiversityLimits({ style: params.style });
  const familyEntries =
    violationDay?.entries.filter(
      (entry) => classifyDailyDiversityCategory(entry.place) === MINIMAL_DEGRADABLE_FAMILY,
    ) ?? [];
  if (!violationDay || familyEntries.length !== 2) {
    return {
      eligible: false,
      degradedRule: null,
      degradationReason: "violation_evidence_mismatch",
      candidatePoolExhausted: false,
      repairStalled: params.repairStalled,
      cycleDetected: params.cycleDetected,
      noLegalDonor: false,
      structureComplete,
      stopCount,
      replacementCandidateId: null,
      candidatePoolChecked: false,
      minimalOverflow: minimalViolation,
      failedRuleCount: params.validation.failedRules.length,
    };
  }

  const legalDonorExists = familyEntries.some(
    (familyEntry) =>
      !entryIsLocked(familyEntry, params.lock) &&
      params.plans.some(
        (plan) =>
          plan.day !== violationDay.day &&
          wouldViolateDailyDiversity(
            plan.entries.map((entry) => entry.place),
            familyEntry.place,
            limits,
          ).ok,
      ),
  );
  const noLegalDonor = !legalDonorExists;
  const usedIds = new Set(
    params.plans.flatMap((plan) => plan.entries.map((entry) => entry.place.id.trim())),
  );
  const replacement = params.pool.find((candidate) => {
    const id = candidate.id.trim();
    const family = classifyDailyDiversityCategory(candidate);
    const slotLabels = familyEntries
      .map((familyEntry) => familyEntry.label || familyEntry.time)
      .join("|");
    const reject = (reason: string): false => {
      logAiPipeline(
        "[REPLACEMENT_REJECT]",
        `placeId=${candidate.id}`,
        `placeName=${candidate.localizedDisplayName ?? candidate.name}`,
        `family=${family}`,
        `slot=${slotLabels}`,
        `reason=${reason}`,
      );
      return false;
    };
    if (!id || usedIds.has(id)) return reject("already_used");
    if (family === MINIMAL_DEGRADABLE_FAMILY) return reject("wrong_family");
    if (!evaluateTourismQuality(candidate).ok) return reject("tourism_quality");
    const identity = checkStopNavigationIdentity(stopNavigationFields(candidate), { silent: true });
    if (!identity.ok || !identity.useForDirections || !identity.placeId) return reject("navigation");
    const slotChecks = familyEntries.map((familyEntry) => {
      const dayWithoutEntry = violationDay.entries
        .filter((entry) => entry !== familyEntry)
        .map((entry) => entry.place);
      const slot = {
        time: familyEntry.time,
        label: familyEntry.label,
        kind: classifyPlanPlaceKind(familyEntry.place),
      };
      const slotOk = canPlaceFillSlot(candidate, slot, params.plannedDate);
      const diversityOk = wouldViolateDailyDiversity(dayWithoutEntry, candidate, limits).ok;
      return { familyEntry, slotOk, diversityOk };
    });
    if (slotChecks.every((check) => !check.slotOk)) {
      const closed = familyEntries.every(
        (familyEntry) =>
          isClearlyClosedAtSlot(candidate, params.plannedDate, familyEntry.time) === true,
      );
      return reject(closed ? "closed" : "wrong_slot");
    }
    if (!slotChecks.some((check) => check.slotOk && check.diversityOk)) {
      return reject("diversity_cap");
    }
    return true;
  });
  const candidatePoolExhausted = !replacement;
  const eligible = noLegalDonor && candidatePoolExhausted;

  return {
    eligible,
    degradedRule: eligible ? "daily_category_diversity" : null,
    degradationReason: eligible
      ? "candidate_pool_exhausted"
      : !noLegalDonor
        ? "legal_donor_available"
        : "verified_replacement_available",
    candidatePoolExhausted,
    repairStalled: params.repairStalled,
    cycleDetected: params.cycleDetected,
    noLegalDonor,
    structureComplete,
    stopCount,
    replacementCandidateId: replacement?.id ?? null,
    candidatePoolChecked: true,
    minimalOverflow: minimalViolation,
    failedRuleCount: params.validation.failedRules.length,
  };
}

export function degradeDiversityFailureToWarning(
  validation: ItineraryValidationResult,
): ItineraryValidationResult {
  const rule = validation.failedRules[0];
  if (!rule || rule.code !== "daily_category_diversity") return validation;
  return {
    ...validation,
    pass: true,
    failedRules: [],
    warnings: [
      ...validation.warnings,
      {
        code: "daily_category_diversity",
        message: "部分天數景點類型較接近。",
        day: rule.day,
        placeIds: rule.placeIds,
      },
    ],
    replanReasons: [],
  };
}
