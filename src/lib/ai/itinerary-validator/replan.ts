/**
 * Itinerary Auto Repair Flow
 *
 * Validator 失敗且僅為可修復問題時（timeline / hours / balance…）：
 * 1. 重新排列同一天順序（去重時間 + 路線組裝）
 * 2. 將晚間景點移到白天（博物館／文創等）
 * 3. 將營業時間衝突地點替換為同類型附近景點
 * 4. 跨天重新分配 Stop
 * 5. 再次 Validator
 *
 * 最多 {@link MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS} 次。
 * Soft-only 失敗或 ≥80% stop 仍可用 → soft-pass 交付，不整份報廢。
 */

import type { ComposedDayPlan, DayPlanEntry } from "@/lib/ai/ai-day-plan-source";
import {
  classifyPlanPlaceKind,
  ensureAllDayPlansExist,
  flattenComposedDayPlanPlaces,
  resolveEntryLabel,
} from "@/lib/ai/ai-day-plan-source";
import {
  dedupeEntryTimes,
  repairDayPlanSlots,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  redistributePlacesEvenly,
  repairTripDuplicatePlaces,
  ensureDayPlansMeetMinimum,
} from "@/lib/ai/ai-multi-day-planner";
import { dedupeByCanonicalLandmark } from "@/lib/ai/canonical-landmark";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { applyPlannerRouteAndCapacityAssembly } from "@/lib/ai/planner-day-route-assembly";
import { applyFinalDayRouteOrdering } from "@/lib/ai/final-day-route-ordering";
import { repairCrossDayGeographicCohesion } from "@/lib/ai/cross-day-geographic-cohesion";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import type { PlaceResult } from "@/lib/place-result";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { isDeliverableItineraryCandidate } from "@/lib/ai/itinerary-deliverable-candidate";
import { distanceMeters } from "@/lib/geo-distance";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import {
  SOFT_PASS_MIN_PLACES_PER_FULL_DAY,
  SOFT_REPAIRABLE_RULE_CODES,
  MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS,
  type ItineraryValidationResult,
  type ItineraryValidatorInput,
  type SoftPassQualityCheck,
} from "@/lib/ai/itinerary-validator/types";
import {
  dayCountsOfPlans,
  hasHardBlockFailures,
  hasUnrepairableHardBlockFailures,
  validateItineraryPlan,
} from "@/lib/ai/itinerary-validator/validate";
import { evaluateTourismQuality } from "@/lib/ai/tourism-quality-gate";
import {
  asComposedDayPlans,
  ensureAllDaysCovered,
  evaluateDayCoverageGate,
  normalizeCompleteDayMap,
  repairDailyDiversityByMove,
} from "@/lib/ai/itinerary-day-coverage";
import {
  buildItineraryQualitySummary,
  logItineraryQualitySummary,
} from "@/lib/ai/itinerary-quality-summary";
import { resolvePlaceDisplayName } from "@/lib/place-display-name";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import {
  evaluateRouteNavigabilityGate,
  findNavigableReplacement,
  logRouteNavigabilityGate,
} from "@/lib/ai/route-navigability-gate";
import { checkStopNavigationIdentity } from "@/lib/saved-trip/stop-navigation";
import {
  isPlaceLocked,
  buildSelectedPlaceLock,
  type SelectedPlaceLock,
} from "@/lib/ai/required-anchor-runtime";
import { resolveNightlifeClassification } from "@/lib/ai/nightlife-classification";
import {
  assessRepairProgress,
  buildItineraryPlanSignature,
  resolveRepairRoundStopReason,
  shortRepairFingerprint,
} from "@/lib/ai/itinerary-validator/repair-progress";
import {
  degradeDiversityFailureToWarning,
  evaluateDiversityDegradationEvidence,
  logDiversityDegradationDecision,
} from "@/lib/ai/itinerary-validator/diversity-degradation";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
  wouldViolateDailyDiversity,
} from "@/lib/ai/daily-category-diversity";

export type ItineraryReplanParams = {
  generationId?: string;
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
  nearbyExtensions?: string[];
  validatorInput: Omit<ItineraryValidatorInput, "plans">;
  /** Eligible conversational anchors that must survive local assembly/repair. */
  requiredPlaces?: readonly PlaceResult[];
};

function lockFromValidatorInput(
  input: Omit<ItineraryValidatorInput, "plans"> | undefined,
): SelectedPlaceLock | null {
  if (!input?.lockedPlaceIds?.length && !input?.lockedPlaceNames?.length) return null;
  return buildSelectedPlaceLock({
    selectedPlaceNames: [...(input.lockedPlaceNames ?? [])],
    placeIds: [...(input.lockedPlaceIds ?? [])],
  });
}

function isLockedEntry(entry: DayPlanEntry, lock: SelectedPlaceLock | null): boolean {
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

export type ItineraryReplanOutcome = {
  plans: ComposedDayPlan[];
  validation: ItineraryValidationResult;
  attempts: number;
  stopReason:
    | "success"
    | "max_rounds"
    | "no_progress"
    | "cycle_detected"
    | "unrepaired_failure";
  noProgress: boolean;
  cycleDetected: boolean;
  requiredCount: number;
  requiredSatisfiedCount: number;
  requiredCoverageComplete: boolean;
};

const DAYTIME_SLOTS = ["09:30", "10:30", "11:00", "14:00", "15:00", "16:00", "16:30"];

type ReplanDiversityPath =
  | "repair_long_route_legs"
  | "repair_non_navigable_stops"
  | "repair_replace_closed_places";

function evaluateReplanDiversity(
  entries: readonly DayPlanEntry[],
  candidate: PlaceResult,
  style: TripStyleKey,
): { accepted: boolean; family: string; currentCount: number; cap: number } {
  const family = classifyDailyDiversityCategory(candidate);
  const limits = resolveDailyDiversityLimits({ style });
  const currentCount = entries.filter(
    (entry) => classifyDailyDiversityCategory(entry.place) === family,
  ).length;
  return {
    accepted: wouldViolateDailyDiversity(
      entries.map((entry) => entry.place),
      candidate,
      limits,
    ).ok,
    family,
    currentCount,
    cap: family in limits
      ? limits[family as keyof typeof limits]
      : Number.POSITIVE_INFINITY,
  };
}

function logReplanDiversityMove(params: {
  repairPath: ReplanDiversityPath;
  place: PlaceResult;
  fromDay: number;
  targetDay: number;
  decision: ReturnType<typeof evaluateReplanDiversity>;
  replacedPlaceId?: string;
}): void {
  logAiPipeline(
    "[REPLAN_DIVERSITY_MOVE]",
    `repairPath=${params.repairPath}`,
    `placeId=${params.place.id}`,
    `family=${params.decision.family}`,
    `fromDay=${params.fromDay}`,
    `targetDay=${params.targetDay}`,
    `currentCount=${params.decision.currentCount}`,
    `cap=${Number.isFinite(params.decision.cap) ? params.decision.cap : "unlimited"}`,
    `decision=${params.decision.accepted ? "accepted" : "rejected"}`,
    params.replacedPlaceId != null
      ? `replacedPlaceId=${params.replacedPlaceId}`
      : "",
    params.replacedPlaceId != null
      ? `replacementPlaceId=${params.place.id}`
      : "",
  );
}
const EVENING_MINUTES = 19 * 60;
const MUSEUM_CULTURE_RE =
  /museum|art_gallery|gallery|美術館|博物館|文學館|藝術中心|展覽館|文學公園/i;
const REPLACE_RADIUS_M = 8_000;

function parseMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function placeIdOf(place: PlaceResult): string {
  return (place.id ?? "").trim() || (place.name ?? "").trim().toLowerCase();
}

function normalizedPlaceName(place: Pick<PlaceResult, "name">): string {
  return (place.name ?? "").normalize("NFKC").trim().toLowerCase();
}

function sameRequiredPlace(left: PlaceResult, right: PlaceResult): boolean {
  const leftId = left.id?.trim();
  const rightId = right.id?.trim();
  if (leftId && rightId && leftId === rightId) return true;
  const leftName = normalizedPlaceName(left);
  return Boolean(leftName && leftName === normalizedPlaceName(right));
}

export type RequiredCoverageState = {
  requiredCount: number;
  requiredSatisfiedCount: number;
  missingRequired: PlaceResult[];
  complete: boolean;
};

export function classifyRequiredIdentityAvailability(
  requiredPlaces: readonly PlaceResult[] = [],
): { unavailableCount: number; failureReason: "required_identity_unavailable" | "none" } {
  const unavailableCount = requiredPlaces.filter(
    (place) => !isHardGooglePlaceId(place.googlePlaceId),
  ).length;
  return {
    unavailableCount,
    failureReason: unavailableCount > 0 ? "required_identity_unavailable" : "none",
  };
}

export function evaluateRequiredPlaceCoverage(
  plans: readonly ComposedDayPlan[],
  requiredPlaces: readonly PlaceResult[] = [],
): RequiredCoverageState {
  const uniqueRequired = requiredPlaces.filter(
    (place, index, all) =>
      all.findIndex((candidate) => candidate === place || sameRequiredPlace(candidate, place)) === index,
  );
  const present = plans.flatMap((plan) => plan.entries.map((entry) => entry.place));
  const missingRequired = uniqueRequired.filter(
    (required) => !present.some((candidate) => sameRequiredPlace(candidate, required)),
  );
  return {
    requiredCount: uniqueRequired.length,
    requiredSatisfiedCount: uniqueRequired.length - missingRequired.length,
    missingRequired,
    complete: missingRequired.length === 0,
  };
}

/**
 * Deterministic required-first repair. It never calls AI/Places. Missing anchors
 * replace supplemental entries before growing a day, so route capacity is stable.
 */
export function repairRequiredPlaceCoverage(params: {
  plans: readonly ComposedDayPlan[];
  requiredPlaces?: readonly PlaceResult[];
  days: number;
  generationId?: string;
}): {
  plans: ComposedDayPlan[];
  insertedCount: number;
  replacedSupplementalCount: number;
  blockedRequiredCount: number;
  failureReasonCounts: Record<string, number>;
} {
  const requiredPlaces = params.requiredPlaces ?? [];
  const plans = ensureAllDayPlansExist(
    params.plans.map((plan) => ({ ...plan, entries: [...plan.entries] })),
    params.days,
  );
  let insertedCount = 0;
  let replacedSupplementalCount = 0;
  let blockedRequiredCount = 0;
  const failureReasonCounts: Record<string, number> = {};

  for (const required of evaluateRequiredPlaceCoverage(plans, requiredPlaces).missingRequired) {
    const requiredIndex = requiredPlaces.findIndex(
      (candidate) => candidate === required || sameRequiredPlace(candidate, required),
    );
    const sourceGoogleIdPresent = isHardGooglePlaceId(required.googlePlaceId);
    const sourceProvenancePresent = Boolean(required.plannerProvenanceKey?.trim());
    if (!sourceGoogleIdPresent) {
      const failureReason = "required_missing_google_identity";
      blockedRequiredCount += 1;
      failureReasonCounts[failureReason] = (failureReasonCounts[failureReason] ?? 0) + 1;
      console.info("[ITINERARY_REQUIRED_REPAIR_IDENTITY]", {
        generationId: params.generationId ?? "",
        requiredIndex,
        sourceGoogleIdPresent,
        sourceProvenancePresent,
        outputGoogleIdPresent: false,
        constructor: "shared_strict_deliverable",
        inserted: false,
        failureReason,
      });
      continue;
    }
    const orderedDays = [...plans].sort((left, right) => {
      const affinity = (plan: ComposedDayPlan): number => {
        if (required.lat == null || required.lng == null) return Number.POSITIVE_INFINITY;
        const located = plan.entries.filter((entry) => entry.place.lat != null && entry.place.lng != null);
        if (!located.length) return Number.POSITIVE_INFINITY;
        const center = located.reduce(
          (sum, entry) => ({ lat: sum.lat + entry.place.lat!, lng: sum.lng + entry.place.lng! }),
          { lat: 0, lng: 0 },
        );
        return distanceMeters(
          { lat: required.lat, lng: required.lng },
          { lat: center.lat / located.length, lng: center.lng / located.length },
        );
      };
      const affinityDifference = affinity(left) - affinity(right);
      if (Number.isFinite(affinityDifference) && affinityDifference !== 0) return affinityDifference;
      const requiredOnLeft = left.entries.filter((entry) =>
        requiredPlaces.some((candidate) => sameRequiredPlace(entry.place, candidate)),
      ).length;
      const requiredOnRight = right.entries.filter((entry) =>
        requiredPlaces.some((candidate) => sameRequiredPlace(entry.place, candidate)),
      ).length;
      return requiredOnLeft - requiredOnRight || right.entries.length - left.entries.length || left.day - right.day;
    });
    const target = orderedDays.find((plan) =>
      plan.entries.some((entry) =>
        !requiredPlaces.some((candidate) => sameRequiredPlace(entry.place, candidate)),
      ),
    ) ?? orderedDays[0];
    if (!target) continue;
    const replaceIndex = [...target.entries]
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .find(({ entry }) =>
        !requiredPlaces.some((candidate) => sameRequiredPlace(entry.place, candidate)),
      )?.index;
    const replacement: DayPlanEntry = {
      time: replaceIndex == null ? DAYTIME_SLOTS[target.entries.length % DAYTIME_SLOTS.length]! : target.entries[replaceIndex]!.time,
      label: required.primaryType ?? required.types?.[0] ?? "景點",
      name: required.name,
      // Atomic candidate replacement: never mix the displaced supplemental's identity.
      place: { ...required, googlePlaceId: required.googlePlaceId!.trim() },
    };
    if (replaceIndex == null) {
      target.entries.push(replacement);
    } else {
      target.entries[replaceIndex] = replacement;
      replacedSupplementalCount += 1;
    }
    insertedCount += 1;
    console.info("[ITINERARY_REQUIRED_REPAIR_IDENTITY]", {
      generationId: params.generationId ?? "",
      requiredIndex,
      sourceGoogleIdPresent,
      sourceProvenancePresent,
      outputGoogleIdPresent: isHardGooglePlaceId(replacement.place.googlePlaceId),
      constructor: "shared_strict_deliverable",
      inserted: true,
      failureReason: "",
    });
  }

  return {
    plans,
    insertedCount,
    replacedSupplementalCount,
    blockedRequiredCount,
    failureReasonCounts,
  };
}

function primaryTypeOf(place: PlaceResult): string {
  return (place.primaryType ?? place.types?.[0] ?? "tourist_attraction").toLowerCase();
}

function isDaytimeOnlyPlace(place: PlaceResult): boolean {
  const blob = [place.name, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ");
  return MUSEUM_CULTURE_RE.test(blob);
}

/** 1. 同日重排：去重衝突時間 + 路線組裝 */
function repairReorderSameDay(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  nearbyExtensions?: string[],
): ComposedDayPlan[] {
  let current = ensureAllDayPlansExist(plans, days).map((plan) => ({
    ...plan,
    entries: dedupeEntryTimes(
      [...plan.entries].sort((a, b) => parseMinutes(a.time) - parseMinutes(b.time)),
    ),
  }));

  try {
    const assembled = applyPlannerRouteAndCapacityAssembly({
      plans: current,
      pool,
      days,
      style,
      nearbyExtensions,
    });
    current = ensureAllDayPlansExist(assembled.plans as ComposedDayPlan[], days).map(
      (plan) => ({
        ...plan,
        entries: dedupeEntryTimes(plan.entries),
      }),
    );
  } catch {
    /* keep current */
  }

  logAiPipeline("[ITINERARY_AUTO_REPAIR]", "step=reorder_same_day");
  return current;
}

const LONG_LEG_REPAIR_M = 15_000;

/** Remove non-tourism / low-value stops; localize remaining names. */
function repairRemoveLowValueAndLocalize(
  plans: ComposedDayPlan[],
  days: number,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  let removed = 0;
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const entries: DayPlanEntry[] = [];
    for (const entry of plan.entries) {
      if (!isLockedEntry(entry, lock) && !evaluateTourismQuality(entry.place).ok) {
        removed += 1;
        continue;
      }
      const resolved = resolvePlaceDisplayName(
        {
          name: entry.place.name ?? entry.name,
          originalName: entry.place.originalName ?? entry.place.name ?? entry.name,
          placeId: entry.place.id,
          canonicalPlaceId: entry.place.id,
          types: entry.place.types,
          primaryType: entry.place.primaryType,
        },
        effectiveAppLocale(),
      );
      const place: PlaceResult = {
        ...entry.place,
        name: resolved.localizedDisplayName,
        originalName: resolved.originalName,
        localizedDisplayName: resolved.localizedDisplayName,
        languageCode: resolved.languageCode,
        localizationSource: resolved.localizationSource,
      };
      entries.push({
        ...entry,
        name: resolved.localizedDisplayName,
        place,
      });
    }
    return { ...plan, entries };
  });
  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=remove_low_value_and_localize",
    `removed=${removed}`,
    `lockedProtected=${Boolean(lock)}`,
  );
  return current;
}

/** Enforce daily category diversity without sacrificing required anchors. */
function repairDailyCategoryDiversity(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  lock: SelectedPlaceLock | null = null,
  telemetryRepairRound = 0,
  partialDays?: readonly number[],
  generationId?: string,
): ComposedDayPlan[] {
  const limits = resolveDailyDiversityLimits({ style });
  const beforeViolations = plans.flatMap((plan) => {
    const families = new Set(plan.entries.map((entry) => classifyDailyDiversityCategory(entry.place)));
    return [...families].flatMap((family) => {
      if (!(family in limits)) return [];
      const familyLimit = limits[family as keyof typeof limits];
      const totalFamilyCount = plan.entries.filter(
        (entry) => classifyDailyDiversityCategory(entry.place) === family,
      ).length;
      if (totalFamilyCount <= familyLimit) return [];
      const requiredFamilyCount = plan.entries.filter(
        (entry) => isLockedEntry(entry, lock) && classifyDailyDiversityCategory(entry.place) === family,
      ).length;
      const supplementalFamilyCount = Math.max(0, totalFamilyCount - requiredFamilyCount);
      return [{
        dayIndex: plan.day,
        family,
        familyLimit,
        requiredFamilyCount,
        supplementalFamilyCount,
        totalFamilyCount,
        provenance: requiredFamilyCount > familyLimit
          ? supplementalFamilyCount > 0 ? "mixed" as const : "required_only" as const
          : "supplemental_caused" as const,
      }];
    });
  });
  const moved = repairDailyDiversityByMove({
    plans,
    tripDays: days,
    style,
    lock,
    telemetryRepairRound,
  });
  // Coverage may have been disturbed by moves — re-cover empty days.
  const covered = ensureAllDaysCovered({
    plans: moved.plans,
    tripDays: days,
    style,
    lock,
    source: "daily_diversity_repair",
  });
  const repaired = asComposedDayPlans(covered.plans);
  const usedIds = new Set(
    repaired.flatMap((plan) => plan.entries.map((entry) => placeIdOf(entry.place))).filter(Boolean),
  );
  const partialDaySet = new Set(partialDays ?? []);
  let replaced = 0;
  let dropped = 0;

  for (const plan of repaired) {
    const families = new Set(
      plan.entries.map((entry) => classifyDailyDiversityCategory(entry.place)),
    );
    for (const family of families) {
      if (!(family in limits)) continue;
      const familyLimit = limits[family as keyof typeof limits];
      const requiredFamilyCount = plan.entries.filter(
        (entry) => isLockedEntry(entry, lock) && classifyDailyDiversityCategory(entry.place) === family,
      ).length;
      const allowedCount = Math.max(familyLimit, requiredFamilyCount);
      const beforeViolation = beforeViolations.find(
        (item) => item.dayIndex === plan.day && item.family === family,
      );

      while (plan.entries.filter(
        (entry) => classifyDailyDiversityCategory(entry.place) === family,
      ).length > allowedCount) {
        const offendingIndex = plan.entries.findLastIndex(
          (entry) => !isLockedEntry(entry, lock) && classifyDailyDiversityCategory(entry.place) === family,
        );
        if (offendingIndex < 0) break;
        const offending = plan.entries[offendingIndex]!;
        const withoutOffending = plan.entries.filter((_, index) => index !== offendingIndex);
        const replacement = pool.find((candidate) => {
          const candidateId = placeIdOf(candidate);
          return Boolean(
            candidateId &&
              !usedIds.has(candidateId) &&
              evaluateTourismQuality(candidate).ok &&
              classifyPlanPlaceKind(candidate) === classifyPlanPlaceKind(offending.place) &&
              isClearlyClosedAtSlot(candidate, plannedDate, offending.time) !== true &&
              wouldViolateDailyDiversity(
                withoutOffending.map((entry) => entry.place),
                candidate,
                limits,
              ).ok
          );
        });
        if (replacement) {
          const oldId = placeIdOf(offending.place);
          if (oldId) usedIds.delete(oldId);
          const replacementId = placeIdOf(replacement);
          if (replacementId) usedIds.add(replacementId);
          plan.entries[offendingIndex] = { ...offending, name: replacement.name, place: replacement };
          replaced += 1;
          continue;
        }
        const hardMinimum = partialDaySet.has(plan.day) ? 1 : SOFT_PASS_MIN_PLACES_PER_FULL_DAY;
        if (plan.entries.length - 1 < hardMinimum) break;
        const [removed] = plan.entries.splice(offendingIndex, 1);
        const removedId = removed ? placeIdOf(removed.place) : "";
        if (removedId) usedIds.delete(removedId);
        dropped += 1;
      }

      const totalFamilyCount = plan.entries.filter(
        (entry) => classifyDailyDiversityCategory(entry.place) === family,
      ).length;
      const supplementalFamilyCount = Math.max(0, totalFamilyCount - requiredFamilyCount);
      if (!beforeViolation) continue;
      console.info("[ITINERARY_DAILY_DIVERSITY]", {
        generationId: generationId ?? "",
        stage: `repair_${telemetryRepairRound}`,
        dayIndex: plan.day,
        violatingFamilies: [{
          family,
          requiredFamilyCount: beforeViolation.requiredFamilyCount,
          supplementalFamilyCount: beforeViolation.supplementalFamilyCount,
          totalFamilyCount: beforeViolation.totalFamilyCount,
          familyLimit,
          provenance: beforeViolation.provenance,
          requiredOverrideApplied:
            beforeViolation.requiredFamilyCount > familyLimit && supplementalFamilyCount === 0,
          supplementalRepairAttempted: beforeViolation.supplementalFamilyCount > 0,
          supplementalRepairSucceeded: totalFamilyCount <= allowedCount,
          blockingRuleEmitted: totalFamilyCount > allowedCount,
          warningEmitted: requiredFamilyCount > familyLimit && supplementalFamilyCount === 0,
        }],
      });
    }
  }
  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=daily_category_diversity",
    `moved=${moved.moved}`,
    `replaced=${replaced}`,
    `dropped=${dropped}`,
  );
  return repaired;
}

/** Peel from heaviest days into empty days until minimum coverage. */
function repairEmptyDays(
  plans: ComposedDayPlan[],
  days: number,
  partialDays: readonly number[] | undefined,
  lock: SelectedPlaceLock | null,
): ComposedDayPlan[] {
  const before = dayCountsOfPlans(plans);
  const covered = ensureAllDaysCovered({
    plans,
    tripDays: days,
    partialDays,
    lock,
    source: "auto_repair_empty_days",
  });
  const after = dayCountsOfPlans(asComposedDayPlans(covered.plans));
  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=repair_empty_days",
    `before=${before.join(",")}`,
    `after=${after.join(",")}`,
    `remainingEmpty=${covered.emptyDaysRemaining.join(",") || "(none)"}`,
  );
  return asComposedDayPlans(covered.plans);
}

/**
 * Long-leg / geo repair: move the farther stop to another day with nearer cluster,
 * or drop when no better day exists. Prefer not masking with transport-mode changes.
 */
export function repairLongRouteLegs(
  plans: ComposedDayPlan[],
  days: number,
  style: TripStyleKey,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  const current = ensureAllDayPlansExist(plans, days).map((p) => ({
    ...p,
    entries: [...p.entries],
  }));
  let moved = 0;

  for (const plan of current) {
    if (plan.entries.length < 2) continue;
    const toMove: DayPlanEntry[] = [];
    const stay: DayPlanEntry[] = [plan.entries[0]!];

    for (let i = 1; i < plan.entries.length; i++) {
      const prev = stay[stay.length - 1]!;
      const curr = plan.entries[i]!;
      if (isLockedEntry(curr, lock)) {
        stay.push(curr);
        continue;
      }
      const a = prev.place;
      const b = curr.place;
      if (
        a.lat == null ||
        a.lng == null ||
        b.lat == null ||
        b.lng == null
      ) {
        stay.push(curr);
        continue;
      }
      const dist = distanceMeters(
        { lat: a.lat, lng: a.lng },
        { lat: b.lat, lng: b.lng },
      );
      if (dist > LONG_LEG_REPAIR_M) {
        toMove.push(curr);
      } else {
        stay.push(curr);
      }
    }

    plan.entries = stay;

    for (const entry of toMove) {
      if (entry.place.lat == null || entry.place.lng == null) continue;
      let bestDay: ComposedDayPlan | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const other of current) {
        if (other.day === plan.day) continue;
        const anchor = other.entries[0]?.place;
        if (anchor?.lat == null || anchor.lng == null) continue;
        const d = distanceMeters(
          { lat: entry.place.lat, lng: entry.place.lng },
          { lat: anchor.lat, lng: anchor.lng },
        );
        const diversityDecision = evaluateReplanDiversity(
          other.entries,
          entry.place,
          style,
        );
        if (!diversityDecision.accepted) {
          logReplanDiversityMove({
            repairPath: "repair_long_route_legs",
            place: entry.place,
            fromDay: plan.day,
            targetDay: other.day,
            decision: diversityDecision,
          });
          continue;
        }
        if (d < bestDist && d < LONG_LEG_REPAIR_M) {
          bestDist = d;
          bestDay = other;
        }
      }
      if (bestDay) {
        const diversityDecision = evaluateReplanDiversity(
          bestDay.entries,
          entry.place,
          style,
        );
        bestDay.entries.push(entry);
        logReplanDiversityMove({
          repairPath: "repair_long_route_legs",
          place: entry.place,
          fromDay: plan.day,
          targetDay: bestDay.day,
          decision: diversityDecision,
        });
        moved += 1;
      }
      // else: drop the long-leg orphan rather than keep a zig-zag day
    }
  }

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=repair_long_route_legs",
    `moved=${moved}`,
  );
  return current;
}

/**
 * Replace stops that lack placeId / use approx coords with nearby navigable pool places.
 * Syncs name + placeId + coords + types together (never name-only).
 */
export function repairNonNavigableStops(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  const usedIds = new Set<string>();
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = entry.place.id?.trim();
      if (id) usedIds.add(id);
    }
  }

  let replaced = 0;
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const entries = plan.entries.map((entry) => {
      const identity = checkStopNavigationIdentity({
        placeName: entry.name,
        title: entry.name,
        localizedDisplayName: entry.place.localizedDisplayName,
        googlePlaceId: entry.place.id,
        lat: entry.place.lat,
        lng: entry.place.lng,
        navigationLatitude: entry.place.navigationLatitude,
        navigationLongitude: entry.place.navigationLongitude,
        coordinateSource: entry.place.coordinateSource,
        address: entry.place.address,
      }, { silent: true });
      if (identity.useForDirections && identity.placeId) return entry;
      // Selected Place Lock: never silently replace user-chosen anchors.
      if (isLockedEntry(entry, lock)) return entry;

      const recipientEntries = plan.entries.filter((candidate) => candidate !== entry);
      const legalPool = pool.filter((candidate) => {
        const decision = evaluateReplanDiversity(
          recipientEntries,
          candidate,
          style,
        );
        if (!decision.accepted) {
          logReplanDiversityMove({
            repairPath: "repair_non_navigable_stops",
            place: candidate,
            fromDay: plan.day,
            targetDay: plan.day,
            decision,
            replacedPlaceId: entry.place.id,
          });
        }
        return decision.accepted;
      });
      const replacement = findNavigableReplacement(entry.place, legalPool, usedIds);
      if (!replacement) return entry;

      const oldId = entry.place.id?.trim();
      if (oldId) usedIds.delete(oldId);
      usedIds.add(replacement.id.trim());
      replaced += 1;
      logReplanDiversityMove({
        repairPath: "repair_non_navigable_stops",
        place: replacement,
        fromDay: plan.day,
        targetDay: plan.day,
        decision: evaluateReplanDiversity(recipientEntries, replacement, style),
        replacedPlaceId: entry.place.id,
      });

      const display = resolvePlaceDisplayName(
        {
          name: replacement.localizedDisplayName ?? replacement.name,
          originalName: replacement.originalName ?? replacement.name,
          placeId: replacement.id,
          canonicalPlaceId: replacement.id,
          types: replacement.types,
          primaryType: replacement.primaryType,
        },
        effectiveAppLocale(),
      );

      return {
        ...entry,
        name: display.localizedDisplayName,
        place: {
          ...replacement,
          name: display.localizedDisplayName,
          localizedDisplayName: display.localizedDisplayName,
          originalName: display.originalName,
          languageCode: display.languageCode,
          localizationSource: display.localizationSource,
          coordinateSource: replacement.coordinateSource ?? "google_places",
        },
      };
    });
    return { ...plan, entries };
  });

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=repair_non_navigable_stops",
    `replaced=${replaced}`,
  );
  return current;
}

/** 2. 晚間景點移到白天（博物館／文創等不應排在 19:00+） */
function repairMoveEveningToDaytime(plans: ComposedDayPlan[], days: number): ComposedDayPlan[] {
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const used = new Set(plan.entries.map((e) => parseMinutes(e.time)));
    const entries: DayPlanEntry[] = plan.entries.map((entry) => {
      const minutes = parseMinutes(entry.time);
      if (minutes < EVENING_MINUTES || !isDaytimeOnlyPlace(entry.place)) {
        return entry;
      }
      const slot =
        DAYTIME_SLOTS.find((t) => !used.has(parseMinutes(t))) ??
        formatMinutes(Math.max(10 * 60, minutes - 6 * 60));
      used.delete(minutes);
      used.add(parseMinutes(slot));
      logAiPipeline(
        "[ITINERARY_AUTO_REPAIR]",
        "step=move_evening_to_daytime",
        `place=${entry.name}`,
        `from=${entry.time}`,
        `to=${slot}`,
      );
      return { ...entry, time: slot, label: entry.label || "景點" };
    });
    return { ...plan, entries: dedupeEntryTimes(entries) };
  });
  return current;
}

/** Move only high-confidence, type-backed nightlife to an evening slot. */
export function repairNightlifeTiming(
  plans: ComposedDayPlan[],
  days: number,
): ComposedDayPlan[] {
  return ensureAllDayPlansExist(plans, days).map((plan) => {
    const used = new Set(plan.entries.map((entry) => parseMinutes(entry.time)));
    const entries = plan.entries.map((entry) => {
      const classification = resolveNightlifeClassification(entry.place);
      if (!classification.isNightlife || classification.confidence < 0.9) return entry;
      const earliest = classification.nightlifeSubtype === "night_market" ? 17 * 60 + 30 : 18 * 60;
      const from = parseMinutes(entry.time);
      if (from >= earliest) return entry;
      let target = earliest;
      while (used.has(target) && target <= 21 * 60 + 30) target += 30;
      if (target > 21 * 60 + 30) {
        logAiPipeline(
          "[ITINERARY_AUTO_REPAIR]",
          "rule=nightlife_timing",
          `placeId=${entry.place.id}`,
          `placeName=${entry.place.localizedDisplayName ?? entry.name}`,
          `fromDay=${plan.day}`,
          `fromTime=${entry.time}`,
          `toDay=${plan.day}`,
          "toTime=",
          "action=replan_required",
          "reason=no_evening_capacity",
        );
        return entry;
      }
      used.delete(from);
      used.add(target);
      const toTime = formatMinutes(target);
      logAiPipeline(
        "[ITINERARY_AUTO_REPAIR]",
        "rule=nightlife_timing",
        `placeId=${entry.place.id}`,
        `placeName=${entry.place.localizedDisplayName ?? entry.name}`,
        `fromDay=${plan.day}`,
        `fromTime=${entry.time}`,
        `toDay=${plan.day}`,
        `toTime=${toTime}`,
        "action=moved",
        `reason=${classification.reason}`,
      );
      return { ...entry, time: toTime, label: entry.label || "夜間" };
    });
    return { ...plan, entries: dedupeEntryTimes(entries) };
  });
}

function similarType(a: PlaceResult, b: PlaceResult): boolean {
  const ta = primaryTypeOf(a);
  const tb = primaryTypeOf(b);
  if (ta && tb && ta === tb) return true;
  const setA = new Set((a.types ?? []).map((t) => t.toLowerCase()));
  const setB = new Set((b.types ?? []).map((t) => t.toLowerCase()));
  for (const t of setA) {
    if (setB.has(t)) return true;
  }
  return false;
}

/** 3. 營業時間衝突 → 以 pool 中同類型附近景點替換 */
export function repairReplaceClosedPlaces(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  plannedDate?: string,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  const used = new Set(
    flattenComposedDayPlanPlaces(plans)
      .map(placeIdOf)
      .filter(Boolean),
  );
  const candidates = pool.filter((p) => {
    const id = placeIdOf(p);
    return id && !used.has(id);
  });

  let replaced = 0;
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const entries = plan.entries.map((entry) => {
      const closed = isClearlyClosedAtSlot(entry.place, plannedDate, entry.time);
      if (closed !== true) return entry;
      // Locked places: only permanently-closed Google status may replace (handled upstream).
      if (isLockedEntry(entry, lock)) return entry;
      if (entry.place.lat == null || entry.place.lng == null) return entry;

      let best: PlaceResult | null = null;
      let bestDist = Infinity;
      const recipientEntries = plan.entries.filter((candidate) => candidate !== entry);
      for (const cand of candidates) {
        if (cand.lat == null || cand.lng == null) continue;
        if (!similarType(entry.place, cand)) continue;
        if (isClearlyClosedAtSlot(cand, plannedDate, entry.time) === true) continue;
        const diversityDecision = evaluateReplanDiversity(
          recipientEntries,
          cand,
          style,
        );
        if (!diversityDecision.accepted) {
          logReplanDiversityMove({
            repairPath: "repair_replace_closed_places",
            place: cand,
            fromDay: plan.day,
            targetDay: plan.day,
            decision: diversityDecision,
            replacedPlaceId: entry.place.id,
          });
          continue;
        }
        const d = distanceMeters(
          { lat: entry.place.lat, lng: entry.place.lng },
          { lat: cand.lat, lng: cand.lng },
        );
        if (d <= REPLACE_RADIUS_M && d < bestDist) {
          best = cand;
          bestDist = d;
        }
      }
      if (!best) return entry;
      const oldId = placeIdOf(entry.place);
      const newId = placeIdOf(best);
      if (oldId) used.delete(oldId);
      if (newId) used.add(newId);
      replaced += 1;
      logReplanDiversityMove({
        repairPath: "repair_replace_closed_places",
        place: best,
        fromDay: plan.day,
        targetDay: plan.day,
        decision: evaluateReplanDiversity(recipientEntries, best, style),
        replacedPlaceId: entry.place.id,
      });
      logAiPipeline(
        "[ITINERARY_AUTO_REPAIR]",
        "step=replace_closed_place",
        `from=${entry.name}`,
        `to=${best.name}`,
        `distanceM=${Math.round(bestDist)}`,
      );
      return {
        ...entry,
        name: best.name,
        place: best,
      };
    });
    return { ...plan, entries };
  });

  if (replaced) {
    logAiPipeline("[ITINERARY_AUTO_REPAIR]", "step=replace_closed_place", `count=${replaced}`);
  }
  return current;
}

/** 4. 跨天重新分配（不均 / multi_day_balance） */
export function repairRedistributeAcrossDays(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  plannedDate: string | undefined,
  nearbyExtensions: string[] | undefined,
  force: boolean,
  lock: SelectedPlaceLock | null,
): ComposedDayPlan[] {
  const counts = dayCountsOfPlans(plans);
  const max = Math.max(0, ...counts);
  const min = Math.min(...counts, max);
  const uneven = max - min >= 2 || counts.some((c) => c < 2);

  if (!force && !uneven) return plans;

  const mergedPool = dedupeByCanonicalLandmark([
    ...flattenComposedDayPlanPlaces(plans),
    ...pool,
  ]).places;
  const requiredEntries = plans.flatMap((plan) =>
    plan.entries.filter((entry) => isLockedEntry(entry, lock)),
  );
  const preservesRequiredEntries = (candidatePlans: ComposedDayPlan[]): boolean => {
    const candidateIds = new Set(
      flattenComposedDayPlanPlaces(candidatePlans).map(placeIdOf).filter(Boolean),
    );
    return requiredEntries.every((entry) =>
      candidateIds.has(placeIdOf(entry.place)),
    );
  };

  let current = ensureDayPlansMeetMinimum({
    plans,
    pool: mergedPool,
    days,
    style,
    plannedDate,
    nearbyExtensions,
  });
  if (!preservesRequiredEntries(current)) current = plans;

  if (mergedPool.length >= days * 2) {
    const redistributed = redistributePlacesEvenly({
      places: mergedPool,
      days,
      style,
      plannedDate,
    });
    if (preservesRequiredEntries(redistributed)) current = redistributed;
  }

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=redistribute_across_days",
    `before=${counts.join(",")}`,
    `after=${dayCountsOfPlans(current).join(",")}`,
  );
  return ensureAllDayPlansExist(current, days);
}

function applyAutoRepairPass(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  plannedDate: string | undefined,
  reasons: string[],
  nearbyExtensions: string[] | undefined,
  attempt: number,
  generationId?: string,
  lock: SelectedPlaceLock | null = null,
  partialDays?: readonly number[],
  failedDays?: readonly number[],
): ComposedDayPlan[] {
  const reasonSet = new Set(reasons);
  let current = normalizeCompleteDayMap(
    ensureAllDayPlansExist(plans, days),
    days,
  ) as ComposedDayPlan[];
  const mergedPool = dedupeByCanonicalLandmark([
    ...flattenComposedDayPlanPlaces(current),
    ...pool,
  ]).places;
  const previousDayCounts = dayCountsOfPlans(current);
  const needsCoverage = shouldRepairDayCoverage(reasons, previousDayCounts);

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR_START]",
    `attempt=${attempt}`,
    `reasons=${reasons.join("|") || "(soft)"}`,
    `poolSize=${mergedPool.length}`,
    `previousDayCounts=${previousDayCounts.join(",")}`,
    `failedDays=${(failedDays ?? []).join(",") || "(none)"}`,
  );

  // Always-safe soft repairs for timeline / hours / balance (and any soft pass).
  const softTimeline =
    reasonSet.has("replan_for_route_timeline") ||
    reasonSet.size === 0 ||
    [...reasonSet].some((r) => r.includes("timeline") || r.includes("route"));
  const softHours =
    reasonSet.has("replan_for_open_hours") ||
    reasonSet.has("replan_meal_or_nightlife_slots");
  const softBalance =
    reasonSet.has("replan_for_multi_day_balance") ||
    reasonSet.has("replan_for_day_capacity") ||
    reasonSet.has("replan_for_full_day_coverage") ||
    needsCoverage;

  // Step 0 — empty-day coverage BEFORE reorder/assembly (assembly used to re-empty Day N).
  if (needsCoverage) {
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  // Always strip low-value facilities + unify display names before other repairs.
  // Selected Place Lock: quality / diversity / replacement must not drop locked anchors.
  current = repairRemoveLowValueAndLocalize(current, days, lock);
  current = repairDailyCategoryDiversity(
    current,
    mergedPool,
    days,
    style,
    lock,
    attempt,
    partialDays,
    generationId,
  );
  current = repairCrossDayGeographicCohesion(current, {
    generationId,
    stage: "post_diversity_move",
    plannedDate,
    logDiagnostics: false,
  });
  current = repairNonNavigableStops(current, mergedPool, days, style, lock);
  current = repairNightlifeTiming(current, days);

  if (
    reasonSet.has("replan_to_dedupe_places") ||
    reasonSet.has("replan_to_replace_excluded_or_unsuitable")
  ) {
    current = repairTripDuplicatePlaces({
      plans: current,
      pool: mergedPool,
      days,
      style,
      plannedDate,
    });
  }

  // Step 1 — reorder same day (assembly now preserves day coverage)
  if (softTimeline || softHours || attempt === 1) {
    current = repairReorderSameDay(current, mergedPool, days, style, nearbyExtensions);
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  // Long / cross-area legs: move stops across days (do not mask with transport mode).
  if (softTimeline || attempt <= 2) {
    current = repairLongRouteLegs(current, days, style, lock);
    current = repairEmptyDays(current, days, partialDays, lock);
    current = repairReorderSameDay(current, mergedPool, days, style, nearbyExtensions);
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  // Step 2 — evening → daytime
  if (softTimeline || softHours || attempt <= 2) {
    current = repairMoveEveningToDaytime(current, days);
  }

  // Step 3 — replace closed / hours conflict
  if (softHours || attempt >= 2) {
    current = repairReplaceClosedPlaces(
      current,
      mergedPool,
      days,
      style,
      plannedDate,
      lock,
    );
    current = repairDayPlanSlots(
      current,
      mergedPool,
      style,
      classifyPlanPlaceKind,
      resolveEntryLabel,
      days,
      plannedDate,
    );
    current = applyFinalDayRouteOrdering(current, {
      generationId,
      stage: "post_supplemental_fill",
      plannedDate,
    });
  }

  // Step 4 — redistribute across days (force when coverage failed)
  if (softBalance || attempt >= 2 || needsCoverage) {
    current = repairRedistributeAcrossDays(
      current,
      mergedPool,
      days,
      style,
      plannedDate,
      nearbyExtensions,
      softBalance || attempt >= 3 || needsCoverage,
      lock,
    );
    current = repairEmptyDays(current, days, partialDays, lock);
    current = repairCrossDayGeographicCohesion(current, {
      generationId,
      stage: "post_redistribution",
      plannedDate,
      logDiagnostics: false,
    });
    current = applyFinalDayRouteOrdering(current, {
      generationId,
      stage: "post_redistribution",
      plannedDate,
    });
  }

  if (reasonSet.has("replan_for_nearby_extension_coverage")) {
    try {
      const assembled = applyPlannerRouteAndCapacityAssembly({
        plans: current,
        pool: mergedPool,
        days,
        style,
        nearbyExtensions,
      });
      current = ensureAllDayPlansExist(assembled.plans as ComposedDayPlan[], days);
      current = repairEmptyDays(current, days, partialDays, lock);
    } catch {
      /* keep */
    }
  }

  // Final: diversity move + coverage + time dedupe
  current = repairDailyCategoryDiversity(
    current,
    mergedPool,
    days,
    style,
    lock,
    attempt,
    partialDays,
    generationId,
  );
  current = repairEmptyDays(current, days, partialDays, lock);
  current = repairNightlifeTiming(current, days);
  current = normalizeCompleteDayMap(
    ensureAllDayPlansExist(current, days).map((plan) => ({
      ...plan,
      entries: dedupeEntryTimes(plan.entries),
    })),
    days,
  ) as ComposedDayPlan[];

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR_DONE]",
    `attempt=${attempt}`,
    `dayCounts=${dayCountsOfPlans(current).join(",")}`,
    `stopCount=${current.reduce((n, p) => n + p.entries.length, 0)}`,
  );

  return current;
}

export function shouldRepairDayCoverage(
  reasons: readonly string[],
  dayCounts: readonly number[],
): boolean {
  return (
    reasons.includes("replan_for_full_day_coverage") ||
    dayCounts.some((count) => count === 0)
  );
}

function softPassValidation(
  validation: ItineraryValidationResult,
  mode: string,
): ItineraryValidationResult {
  return {
    ...validation,
    pass: true,
    score: Math.max(validation.score, 80),
    warnings: [
      ...validation.warnings,
      ...validation.failedRules.map((r) => ({
        code: r.code,
        message: `${mode}:${r.message}`,
        day: r.day,
        placeIds: r.placeIds,
      })),
    ],
    failedRules: [],
    replanReasons: [],
    path: "validator",
  };
}

/**
 * Soft Pass 最低可接受品質（不以 Stop 百分比）：
 * 1. 每天至少有基本完整結構
 * 2. 仍符合使用者原始偏好（無 user_exclusions）
 * 3. 沒有重複地點
 * 4. 沒有明顯營業時間衝突（not_open_at_slot）
 */
export function evaluateMinimumAcceptableQuality(
  plans: ComposedDayPlan[],
  validation: ItineraryValidationResult,
  opts: {
    days: number;
    partialDays?: readonly number[];
  },
): SoftPassQualityCheck {
  const reasons: string[] = [];
  const partial = new Set(opts.partialDays ?? []);
  const byDay = new Map(plans.map((p) => [p.day, p]));

  let dayStructureOk = true;
  for (let day = 1; day <= opts.days; day += 1) {
    const plan = byDay.get(day);
    const count = plan?.entries.length ?? 0;
    if (!plan || count === 0) {
      dayStructureOk = false;
      reasons.push(`day_structure:empty_day:${day}`);
      continue;
    }
    const min = partial.has(day) ? 1 : SOFT_PASS_MIN_PLACES_PER_FULL_DAY;
    if (count < min) {
      dayStructureOk = false;
      reasons.push(`day_structure:sparse_day:${day}:${count}<${min}`);
    }
  }
  if (
    validation.failedRules.some(
      (r) => r.code === "missing_days" || r.code === "day_place_count",
    )
  ) {
    dayStructureOk = false;
    if (!reasons.some((r) => r.startsWith("day_structure:"))) {
      reasons.push("day_structure:validator_failed_rules");
    }
  }

  // Soft pass must never deliver low-value / non-tourism stops.
  let noLowValue = true;
  for (const plan of plans) {
    for (const entry of plan.entries) {
      if (!evaluateTourismQuality(entry.place).ok) {
        noLowValue = false;
        reasons.push(`low_value_place:${entry.name}`);
      }
    }
  }

  const preferencesOk = !validation.failedRules.some((r) => r.code === "user_exclusions");
  if (!preferencesOk) reasons.push("preferences:user_exclusions");

  const noDuplicates = !validation.failedRules.some((r) => r.code === "place_duplicate");
  if (!noDuplicates) reasons.push("duplicates:place_duplicate");

  const obviousHours =
    validation.failedRules.some((r) => r.code === "business_hours_cover") ||
    validation.warnings.some(
      (w) =>
        w.code === "business_hours_cover" &&
        (w.message.startsWith("not_open_at_slot:") ||
          w.message.includes("not_open_at_slot:")),
    );
  const noObviousHoursConflict = !obviousHours;
  if (!noObviousHoursConflict) reasons.push("hours:not_open_at_slot");

  const ok =
    dayStructureOk &&
    preferencesOk &&
    noDuplicates &&
    noObviousHoursConflict &&
    noLowValue;

  logAiPipeline(
    "[ITINERARY_SOFT_PASS_QUALITY]",
    `ok=${ok}`,
    `dayStructure=${dayStructureOk}`,
    `preferences=${preferencesOk}`,
    `noDuplicates=${noDuplicates}`,
    `noObviousHours=${noObviousHoursConflict}`,
    `noLowValue=${noLowValue}`,
    `reasons=${reasons.join("|") || "(none)"}`,
    `dayCounts=${dayCountsOfPlans(plans).join(",")}`,
  );

  return {
    ok,
    dayStructureOk,
    preferencesOk,
    noDuplicates,
    noObviousHoursConflict,
    reasons,
  };
}

/** Soft-pass 可容忍的殘餘規則（品質門檻已過時） */
function remainingFailsAreSoftPassTolerated(
  validation: ItineraryValidationResult,
): boolean {
  if (!validation.failedRules.length) return true;
  return validation.failedRules.every((r) =>
    (SOFT_REPAIRABLE_RULE_CODES as readonly string[]).includes(r.code),
  );
}

/**
 * Auto Repair：最多 {@link MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS} 次。
 * 仍有 soft error 時：以最低可接受品質門檻 soft-pass（不依 Stop 百分比）。
 */
export function replanUntilItineraryValid(
  params: ItineraryReplanParams,
  initial: ItineraryValidationResult,
): ItineraryReplanOutcome {
  const originalPlans = params.plans;
  const destination = params.validatorInput.destination ?? "";
  const requiredPlaces = params.requiredPlaces ?? [];
  const candidateAdmission = params.pool.map((candidate) => {
    const candidateSource = requiredPlaces.some((required) =>
      sameRequiredPlace(required, candidate),
    ) ? "required" as const : "supplemental" as const;
    const decision = isDeliverableItineraryCandidate(candidate as never, destination);
    return { candidate, candidateSource, decision };
  });
  const deliverablePool = candidateAdmission
    .filter(({ decision }) => decision.deliverable)
    .map(({ candidate }) => candidate);
  for (const candidateSource of ["required", "supplemental"] as const) {
    const input = candidateAdmission.filter((item) => item.candidateSource === candidateSource);
    const rejectionReasonCounts = input.reduce<Record<string, number>>((counts, item) => {
      if (!item.decision.deliverable) {
        const reason = candidateSource === "required" && item.decision.reason === "missing_google_identity"
          ? "required_missing_google_identity"
          : item.decision.reason ?? "other";
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
      return counts;
    }, {});
    console.info("[ITINERARY_REPLAN_CANDIDATE_ADMISSION]", {
      generationId: params.generationId ?? "",
      branch: "all_replan_insertion_paths",
      candidateSource,
      inputCount: input.length,
      deliverableCount: input.filter((item) => item.decision.deliverable).length,
      rejectedCount: input.filter((item) => !item.decision.deliverable).length,
      rejectionReasonCounts,
    });
  }
  const originalStopCount = originalPlans.reduce((n, p) => n + p.entries.length, 0);
  let plans = normalizeCompleteDayMap(
    ensureAllDayPlansExist(params.plans, params.days),
    params.days,
  ) as ComposedDayPlan[];
  let validation = initial;
  let attempts = 0;
  let stopReason: ItineraryReplanOutcome["stopReason"] = initial.pass
    ? "success"
    : "unrepaired_failure";
  let noProgress = false;
  let cycleDetected = false;
  let requiredCoverage = evaluateRequiredPlaceCoverage(plans, params.requiredPlaces);
  const selectedLock = lockFromValidatorInput(params.validatorInput);
  const seenPlanSignatures = new Set<string>([
    buildItineraryPlanSignature(plans, selectedLock),
  ]);
  const initiallyUsedIds = new Set(
    plans.flatMap((plan) => plan.entries.map((entry) => entry.place.id.trim())),
  );
  const poolFamilies = new Map<string, { verified: number; unused: number; replaceable: number }>();
  for (const candidate of deliverablePool) {
    const family = classifyDailyDiversityCategory(candidate);
    const summary = poolFamilies.get(family) ?? { verified: 0, unused: 0, replaceable: 0 };
    const identity = checkStopNavigationIdentity(
      {
        placeName: candidate.name,
        googlePlaceId: candidate.id,
        lat: candidate.lat,
        lng: candidate.lng,
        coordinateSource: candidate.coordinateSource,
        address: candidate.address,
      },
      { silent: true },
    );
    const verified = Boolean(candidate.id.trim()) && identity.ok && identity.useForDirections;
    const unused = verified && !initiallyUsedIds.has(candidate.id.trim());
    summary.verified += verified ? 1 : 0;
    summary.unused += unused ? 1 : 0;
    summary.replaceable += unused && evaluateTourismQuality(candidate).ok ? 1 : 0;
    poolFamilies.set(family, summary);
  }
  logAiPipeline(
    "[CANDIDATE_POOL_SUMMARY]",
    `families=${[...poolFamilies.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([family, counts]) => `${family}:verified=${counts.verified},unused=${counts.unused},replaceable=${counts.replaceable}`)
      .join("|") || "(none)"}`,
    `poolSize=${deliverablePool.length}`,
  );

  // missing_days is hard for delivery but MUST enter Auto Repair first.
  while (
    (!validation.pass || !requiredCoverage.complete) &&
    validation.path === "validator" &&
    (!hasUnrepairableHardBlockFailures(validation) || !requiredCoverage.complete) &&
    attempts < MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS
  ) {
    attempts += 1;
    const previousDayCounts = dayCountsOfPlans(plans);
    const failedDays = [
      ...new Set([
        ...validation.affectedDays,
        ...validation.failedRules
          .filter((r) => r.code === "missing_days" && r.day != null)
          .map((r) => r.day!),
      ]),
    ];
    const lockedCount =
      (params.validatorInput.lockedPlaceIds?.length ?? 0) +
      (params.validatorInput.lockedPlaceNames?.length ?? 0);
    const redistributionRequired =
      validation.replanReasons.includes("replan_for_full_day_coverage") ||
      previousDayCounts.some((c) => c === 0);

    logAiPipeline(
      "[ITINERARY_REPLAN_INPUT]",
      `attempt=${attempts}`,
      `tripDays=${params.days}`,
      `previousDayCounts=${previousDayCounts.join(",")}`,
      `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      `failedDays=${failedDays.join(",") || "(none)"}`,
      `candidateCount=${deliverablePool.length}`,
      `lockedPlaceCount=${lockedCount}`,
      `redistributionRequired=${redistributionRequired}`,
    );
    logAiPipeline(
      "[ITINERARY_REPLAN_START]",
      `attempt=${attempts}`,
      `reasons=${validation.replanReasons.join("|")}`,
      `poolSize=${deliverablePool.length}`,
      "placesSearch=false",
      "mode=auto_repair",
    );

    const before = plans;
    const validationBefore = validation;
    const requiredCoverageBefore = requiredCoverage;
    // Do not reuse a failed day map: coverage repair rebuilds from stops across days.
    plans = applyAutoRepairPass(
      plans,
      deliverablePool,
      params.days,
      params.style,
      params.plannedDate,
      validation.replanReasons.length
        ? validation.replanReasons
        : [
            "replan_for_full_day_coverage",
            "replan_for_route_timeline",
            "replan_for_open_hours",
            "replan_for_multi_day_balance",
          ],
      params.nearbyExtensions,
      attempts,
      params.generationId,
      selectedLock,
      params.validatorInput.partialDays,
      failedDays,
    );

    const coverageGate = evaluateDayCoverageGate({
      plans,
      tripDays: params.days,
      partialDays: params.validatorInput.partialDays,
    });
    if (!coverageGate.allDaysCovered) {
      plans = repairEmptyDays(
        plans,
        params.days,
        params.validatorInput.partialDays,
        selectedLock,
      );
    }

    const requiredRepair = repairRequiredPlaceCoverage({
      plans,
      requiredPlaces: params.requiredPlaces,
      days: params.days,
      generationId: params.generationId,
    });
    plans = requiredRepair.plans;
    plans = repairCrossDayGeographicCohesion(plans, {
      generationId: params.generationId,
      stage: "post_required_repair",
      plannedDate: params.plannedDate,
    });
    plans = applyFinalDayRouteOrdering(plans, {
      generationId: params.generationId,
      stage: "post_required_repair",
      plannedDate: params.plannedDate,
    });
    plans = applyFinalDayRouteOrdering(plans, {
      generationId: params.generationId,
      stage: "post_replan",
      plannedDate: params.plannedDate,
    });
    requiredCoverage = evaluateRequiredPlaceCoverage(plans, params.requiredPlaces);

    validation = validateItineraryPlan({
      ...params.validatorInput,
      plans,
      generationId: params.generationId,
      validationStage: `replan_${attempts}`,
      telemetryRepairRound: attempts,
      telemetryValidatorRound: attempts,
    });

    const newDayCounts = dayCountsOfPlans(plans);
    const beforeIds = new Set(
      before.flatMap((plan) => plan.entries.map((entry) => placeIdOf(entry.place))).filter(Boolean),
    );
    const insertedCount = plans
      .flatMap((plan) => plan.entries)
      .filter((entry) => !beforeIds.has(placeIdOf(entry.place))).length;
    console.info("[ITINERARY_REPLAN_ATTEMPT]", {
      generationId: params.generationId ?? "",
      attempt: attempts,
      failedRulesBefore: validationBefore.failedRules.map((rule) => rule.code),
      dayCountBefore: before.length,
      populatedDayCountBefore: before.filter((plan) => plan.entries.length > 0).length,
      dayPlaceCountsBefore: previousDayCounts,
      candidatePoolCount: deliverablePool.length,
      supplementalAvailable: deliverablePool.filter((place) => !beforeIds.has(placeIdOf(place))).length,
      insertedCount,
      requiredCountBefore: requiredCoverageBefore.requiredCount,
      requiredSatisfiedBefore: requiredCoverageBefore.requiredSatisfiedCount,
      missingRequiredBefore: requiredCoverageBefore.missingRequired.length,
      requiredInsertedCount: requiredRepair.insertedCount,
      requiredCountAfter: requiredCoverage.requiredCount,
      requiredSatisfiedAfter: requiredCoverage.requiredSatisfiedCount,
      missingRequiredAfter: requiredCoverage.missingRequired.length,
      completionBlockedByRequiredCoverage: validation.pass && !requiredCoverage.complete,
      dayCountAfter: plans.length,
      populatedDayCountAfter: plans.filter((plan) => plan.entries.length > 0).length,
      failedRulesAfter: validation.failedRules.map((rule) => rule.code),
    });
    const rejectedMissingGoogle = candidateAdmission.filter(
      ({ decision }) => !decision.deliverable && decision.reason === "missing_google_identity",
    );
    console.info("[ITINERARY_REPLAN_INSERTION]", {
      generationId: params.generationId ?? "",
      branch: "auto_repair_pass",
      attemptedCount: insertedCount + rejectedMissingGoogle.length,
      insertedCount,
      missingGoogleRejectedCount: rejectedMissingGoogle.length,
      internalIdentityRejectedCount: rejectedMissingGoogle.filter(({ candidate }) =>
        Boolean(candidate.googlePlaceId?.trim() || candidate.id?.trim()),
      ).length,
    });
    const remainingEmptyDays = newDayCounts
      .map((c, i) => (c === 0 ? i + 1 : 0))
      .filter((d) => d > 0);
    logAiPipeline(
      "[ITINERARY_REPLAN_OUTPUT]",
      `newDayCounts=${newDayCounts.join(",")}`,
      `movedPlaces=${previousDayCounts.join(">")}->${newDayCounts.join(",")}`,
      `remainingEmptyDays=${remainingEmptyDays.join(",") || "(none)"}`,
      `validatorPass=${validation.pass}`,
    );
    logAiPipeline(
      "[ITINERARY_REPLAN_RESULT]",
      `attempt=${attempts}`,
      `pass=${validation.pass}`,
      `dayCounts=${newDayCounts.join(",")}`,
      `stopCount=${plans.reduce((n, p) => n + p.entries.length, 0)}`,
      `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
    );

    const stopCount = plans.reduce((n, p) => n + p.entries.length, 0);
    const beforeCount = before.reduce((n, p) => n + p.entries.length, 0);
    if (!validation.pass && stopCount < Math.max(params.days, Math.floor(beforeCount * 0.5))) {
      logAiPipeline(
        "[ITINERARY_REPLAN_KEEP_ORIGINAL]",
        "reason=replan_shrunk_plan",
        `before=${beforeCount}`,
        `after=${stopCount}`,
      );
      plans = before;
    }

    // Identical empty day map after a coverage repair → force even redistribute once.
    if (
      !validation.pass &&
      redistributionRequired &&
      newDayCounts.join(",") === previousDayCounts.join(",") &&
      previousDayCounts.some((c) => c === 0)
    ) {
      const mergedPool = dedupeByCanonicalLandmark([
        ...flattenComposedDayPlanPlaces(plans),
        ...deliverablePool,
      ]).places;
      if (mergedPool.length >= params.days) {
        logAiPipeline(
          "[ITINERARY_REPLAN_FORCE_REDISTRIBUTE]",
          `attempt=${attempts}`,
          `previousDayCounts=${previousDayCounts.join(",")}`,
        );
        const redistributed = redistributePlacesEvenly({
          places: mergedPool,
          days: params.days,
          style: params.style,
          plannedDate: params.plannedDate,
        });
        const requiredEntries = plans.flatMap((plan) =>
          plan.entries.filter((entry) => isLockedEntry(entry, selectedLock)),
        );
        const redistributedIds = new Set(
          flattenComposedDayPlanPlaces(redistributed).map(placeIdOf).filter(Boolean),
        );
        if (
          requiredEntries.every((entry) =>
            redistributedIds.has(placeIdOf(entry.place)),
          )
        ) {
          plans = redistributed;
        }
        plans = repairEmptyDays(
          plans,
          params.days,
          params.validatorInput.partialDays,
          selectedLock,
        );
        plans = repairCrossDayGeographicCohesion(plans, {
          generationId: params.generationId,
          stage: "post_redistribution",
          plannedDate: params.plannedDate,
        });
        plans = applyFinalDayRouteOrdering(plans, {
          generationId: params.generationId,
          stage: "post_redistribution",
          plannedDate: params.plannedDate,
        });
        validation = validateItineraryPlan({
          ...params.validatorInput,
          plans,
          generationId: params.generationId,
          validationStage: `replan_${attempts}`,
          telemetryRepairRound: attempts,
          telemetryValidatorRound: attempts,
        });
        logAiPipeline(
          "[ITINERARY_REPLAN_OUTPUT]",
          `newDayCounts=${dayCountsOfPlans(plans).join(",")}`,
          `movedPlaces=force_redistribute`,
          `remainingEmptyDays=${dayCountsOfPlans(plans)
            .map((c, i) => (c === 0 ? i + 1 : 0))
            .filter((d) => d > 0)
            .join(",") || "(none)"}`,
          `validatorPass=${validation.pass}`,
        );
      }
    }

    // Any redistribution must preserve the required lock; recalculate before
    // deciding whether this repair round may complete.
    requiredCoverage = evaluateRequiredPlaceCoverage(plans, params.requiredPlaces);

    const progress = assessRepairProgress({
      plansBefore: before,
      plansAfter: plans,
      validationBefore,
      validationAfter: validation,
      seenPlanSignatures,
      lock: selectedLock,
    });
    const completionSatisfied = validation.pass && requiredCoverage.complete;
    const roundStopReason = completionSatisfied
      ? "success"
      : requiredCoverage.complete
        ? resolveRepairRoundStopReason(validation.pass, progress)
        : null;
    logAiPipeline(
      "[ITINERARY_REPAIR_PROGRESS]",
      `repairRound=${attempts}`,
      `planSignatureBefore=${shortRepairFingerprint(progress.planSignatureBefore)}`,
      `planSignatureAfter=${shortRepairFingerprint(progress.planSignatureAfter)}`,
      `failureFingerprintBefore=${shortRepairFingerprint(progress.failureFingerprintBefore)}`,
      `failureFingerprintAfter=${shortRepairFingerprint(progress.failureFingerprintAfter)}`,
      `operationCount=${progress.operationCount}`,
      `actualPlanChanged=${progress.actualPlanChanged}`,
      `hardFailureImproved=${progress.hardFailureImproved}`,
      `noProgress=${progress.noProgress}`,
      `cycleDetected=${progress.cycleDetected}`,
      `stopReason=${roundStopReason ?? "continue"}`,
    );
    if (roundStopReason) {
      noProgress = roundStopReason === "no_progress";
      cycleDetected = roundStopReason === "cycle_detected";
      stopReason = roundStopReason;
      break;
    }
    seenPlanSignatures.add(progress.planSignatureAfter);
  }

  if (
    (!validation.pass || !requiredCoverage.complete) &&
    stopReason === "unrepaired_failure" &&
    attempts >= MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS
  ) {
    stopReason = "max_rounds";
  }

  if (!validation.pass && (noProgress || cycleDetected)) {
    const evidence = evaluateDiversityDegradationEvidence({
      plans,
      validation,
      pool: deliverablePool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
      repairStalled: noProgress,
      cycleDetected,
      lock: selectedLock,
    });
    logDiversityDegradationDecision(evidence);
    if (evidence.eligible) {
      validation = degradeDiversityFailureToWarning(validation);
    }
    logAiPipeline(
      "[ITINERARY_DIVERSITY_DEGRADATION]",
      `degradedRule=${evidence.degradedRule ?? ""}`,
      `degradationReason=${evidence.degradationReason}`,
      `candidatePoolExhausted=${evidence.candidatePoolExhausted}`,
      `repairStalled=${evidence.repairStalled}`,
      `cycleDetected=${evidence.cycleDetected}`,
      `degradedDelivery=${evidence.eligible}`,
      `deliveryAllowed=${validation.pass}`,
    );
  }

  if (!validation.pass && requiredCoverage.complete && !hasHardBlockFailures(validation)) {
    const quality = evaluateMinimumAcceptableQuality(plans, validation, {
      days: params.days,
      partialDays: params.validatorInput.partialDays,
    });
    const tolerated = remainingFailsAreSoftPassTolerated(validation);
    const navGate = evaluateRouteNavigabilityGate({ plans });
    logRouteNavigabilityGate(navGate);

    if (quality.ok && tolerated && navGate.ok) {
      const repairedCount = plans.reduce((n, p) => n + p.entries.length, 0);
      if (repairedCount < params.days) {
        // Structure already checked by quality; prefer original only if repair emptied.
        plans = originalPlans;
      }
      logAiPipeline(
        "[ITINERARY_REPLAN_KEEP_ORIGINAL]",
        "reason=quality_gate_soft_pass",
        `attempts=${attempts}`,
        `originalStops=${originalStopCount}`,
        `qualityReasons=${quality.reasons.join("|") || "(none)"}`,
        `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      );
      validation = softPassValidation(validation, "auto_repair_quality_pass");
      logAiPipeline(
        "[ITINERARY_REPLAN_RESULT]",
        `attempt=${attempts}`,
        "pass=true",
        "mode=quality_gate_soft_pass",
        `dayCounts=${dayCountsOfPlans(plans).join(",")}`,
      );
    } else {
      logAiPipeline(
        "[ITINERARY_SOFT_PASS_REJECTED]",
        `attempts=${attempts}`,
        `qualityOk=${quality.ok}`,
        `tolerated=${tolerated}`,
        `navigabilityOk=${navGate.ok}`,
        `reasons=${[...quality.reasons, ...navGate.reasons].join("|") || "(none)"}`,
        `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      );
    }
  }

  // Final quality summary (one line — no per-place spam).
  const summary = buildItineraryQualitySummary({
    destination: params.validatorInput.destination ?? "",
    days: params.days,
    plans,
    candidatePool: deliverablePool,
  });
  logItineraryQualitySummary(summary);

  const hardFailures = validation.failedRules.filter((rule) =>
    hasHardBlockFailures({ ...validation, failedRules: [rule] }),
  );
  if (validation.pass && requiredCoverage.complete && !noProgress && !cycleDetected) stopReason = "success";
  if (!requiredCoverage.complete && attempts >= MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS) {
    stopReason = "max_rounds";
  }
  logAiPipeline(
    "[ITINERARY_FINAL_GATE]",
    `hardFailures=${hardFailures.map((rule) => rule.code).join(",") || "(none)"}`,
    `warnings=${validation.warnings.map((warning) => warning.code).join(",") || "(none)"}`,
    `repairAttempts=${attempts}`,
    `deliveryAllowed=${requiredCoverage.complete && (validation.pass || hardFailures.length === 0)}`,
    `reason=${!requiredCoverage.complete ? "required_anchor_coverage_mismatch" : validation.pass ? "validated" : hardFailures.length ? "hard_failure" : "warnings_only"}`,
  );

  logAiPipeline(
    "[ITINERARY_REPAIR_STOP]",
    `repairRound=${attempts}`,
    `stopReason=${stopReason}`,
    `noProgress=${noProgress}`,
    `cycleDetected=${cycleDetected}`,
  );
  return {
    plans,
    validation,
    attempts,
    stopReason,
    noProgress,
    cycleDetected,
    requiredCount: requiredCoverage.requiredCount,
    requiredSatisfiedCount: requiredCoverage.requiredSatisfiedCount,
    requiredCoverageComplete: requiredCoverage.complete,
  };
}
