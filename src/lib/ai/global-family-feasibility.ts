import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import { combinationIdsFromPlace } from "@/lib/ai/combination-provenance";
import {
  classifyDailyDiversityCategory,
  resolveDailyDiversityLimits,
} from "@/lib/ai/daily-category-diversity";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { isRealGooglePlanningPlace } from "@/lib/ai/planning-real-place";
import { evaluateTourismQuality } from "@/lib/ai/tourism-quality-gate";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";

export type FamilyFeasibilityCandidate = RoamieRecommendationItem & {
  isRequiredBySelection?: boolean;
};

export type GlobalFamilyFeasibilityResult = {
  selected: FamilyFeasibilityCandidate[];
  targetCount: number;
  globallyFeasible: boolean;
  rejectedCount: number;
  replacementCount: number;
};

function toPlaceResult(candidate: FamilyFeasibilityCandidate): PlaceResult {
  return {
    id: candidate.googlePlaceId?.trim() ?? "",
    name: candidate.placeName ?? candidate.name,
    address: candidate.address ?? null,
    lat: candidate.lat,
    lng: candidate.lng,
    rating: candidate.rating ?? null,
    userRatingCount: candidate.userRatingCount ?? null,
    photoName: candidate.photoName ?? null,
    primaryType: candidate.primaryType ?? candidate.type ?? null,
    types: candidate.types?.length
      ? candidate.types
      : candidate.primaryType || candidate.type
        ? [candidate.primaryType ?? candidate.type]
        : null,
    businessStatus: candidate.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: candidate.openStatusLabel ?? "",
    todayHoursLabel: candidate.todayHoursLabel ?? "",
    closingSoonNote: candidate.closingSoonNote ?? "",
    nextOpenHint: candidate.nextOpenHint ?? "",
    coordinateSource: "google_places",
  };
}

function candidateSource(candidate: FamilyFeasibilityCandidate): string {
  if (candidate.isRequiredBySelection) return "required_selection";
  if (candidate.sourceRegionCandidate) return "nearby_extension";
  if (combinationIdsFromPlace(candidate).length) return "selected_combination";
  return candidate.reasonSource === "ai" ? "supplement" : "fallback";
}

function candidateKey(candidate: FamilyFeasibilityCandidate): string {
  return candidate.googlePlaceId?.trim() ?? "";
}

/**
 * Bound the selected scenic pool by the formal daily diversity contract before
 * geography-first day assignment. Required candidates are identity contracts:
 * they are preserved even when they prove that the request is globally infeasible.
 */
export function enforceGlobalFamilyFeasibility(params: {
  candidates: FamilyFeasibilityCandidate[];
  dayCount: number;
  targetCount: number;
  selectedCombinationIds: number[];
  minimumPerCombination: number;
  style?: TripStyleKey;
}): GlobalFamilyFeasibilityResult {
  const limits = resolveDailyDiversityLimits({ style: params.style });
  const selected: FamilyFeasibilityCandidate[] = [];
  const selectedIds = new Set<string>();
  const familyCounts = new Map<string, number>();
  const rejectedIds = new Set<string>();
  const rejectedByFamily = new Map<string, FamilyFeasibilityCandidate[]>();
  const replacementPairs: Array<{
    rejected: FamilyFeasibilityCandidate;
    replacement: FamilyFeasibilityCandidate;
  }> = [];
  let globallyFeasible = true;

  const familyOf = (candidate: FamilyFeasibilityCandidate) =>
    classifyDailyDiversityCategory(toPlaceResult(candidate));
  const capOf = (family: string): number =>
    family in limits
      ? params.dayCount * limits[family as keyof typeof limits]
      : Number.POSITIVE_INFINITY;
  const add = (candidate: FamilyFeasibilityCandidate): boolean => {
    const key = candidateKey(candidate);
    if (!key || selectedIds.has(key)) return false;
    const family = familyOf(candidate);
    selectedIds.add(key);
    selected.push(candidate);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    return true;
  };
  const rejectForCapacity = (candidate: FamilyFeasibilityCandidate): void => {
    const key = candidateKey(candidate);
    if (!key || rejectedIds.has(key)) return;
    rejectedIds.add(key);
    const family = familyOf(candidate);
    const list = rejectedByFamily.get(family) ?? [];
    list.push(candidate);
    rejectedByFamily.set(family, list);
    logAiPipeline(
      "[GLOBAL_FAMILY_CANDIDATE_DECISION]",
      `place=${candidate.placeName ?? candidate.name}`,
      `placeId=${key}`,
      `family=${family}`,
      "required=false",
      `candidateSource=${candidateSource(candidate)}`,
      "decision=rejected_global_capacity",
      "reason=global_family_capacity",
      "replacementPlace=",
      "replacementFamily=",
    );
  };
  const canSelect = (candidate: FamilyFeasibilityCandidate): boolean => {
    const place = toPlaceResult(candidate);
    if (!isRealGooglePlanningPlace(place) || !evaluateTourismQuality(place).ok) return false;
    const family = classifyDailyDiversityCategory(place);
    return (familyCounts.get(family) ?? 0) + 1 <= capOf(family);
  };
  const tryOptional = (candidate: FamilyFeasibilityCandidate): boolean => {
    if (selectedIds.has(candidateKey(candidate))) return false;
    if (!canSelect(candidate)) {
      const family = familyOf(candidate);
      if ((familyCounts.get(family) ?? 0) >= capOf(family)) rejectForCapacity(candidate);
      return false;
    }
    const pending = [...rejectedByFamily.values()]
      .flat()
      .find((rejected) => !replacementPairs.some((pair) => pair.rejected === rejected));
    if (pending && familyOf(pending) !== familyOf(candidate)) {
      replacementPairs.push({ rejected: pending, replacement: candidate });
    }
    return add(candidate);
  };

  // Required identity always wins, including an explicitly infeasible request.
  for (const candidate of params.candidates) {
    if (!candidate.isRequiredBySelection) continue;
    add(candidate);
  }
  const requiredFamilyOrdinals = new Map<string, number>();
  for (const candidate of selected) {
    const family = familyOf(candidate);
    const ordinal = (requiredFamilyOrdinals.get(family) ?? 0) + 1;
    requiredFamilyOrdinals.set(family, ordinal);
    if (ordinal > capOf(family)) {
      globallyFeasible = false;
      logAiPipeline(
        "[GLOBAL_FAMILY_CANDIDATE_DECISION]",
        `place=${candidate.placeName ?? candidate.name}`,
        `placeId=${candidateKey(candidate)}`,
        `family=${family}`,
        "required=true",
        `candidateSource=${candidateSource(candidate)}`,
        "decision=preserved_required_overflow",
        "reason=required_global_capacity_exceeded",
        "replacementPlace=",
        "replacementFamily=",
      );
    }
  }

  // Preserve the existing minimum representative quota for every selected combination.
  for (const combinationId of params.selectedCombinationIds) {
    const covered = () =>
      selected.filter((candidate) => combinationIdsFromPlace(candidate).includes(combinationId))
        .length;
    if (covered() >= params.minimumPerCombination) continue;
    for (const candidate of params.candidates) {
      if (covered() >= params.minimumPerCombination) break;
      if (!combinationIdsFromPlace(candidate).includes(combinationId)) continue;
      tryOptional(candidate);
    }
  }

  // Nearby evidence precedes general quality-ranked/supplement candidates.
  const remaining = params.candidates.filter(
    (candidate) => !selectedIds.has(candidateKey(candidate)),
  );
  const ordered = [
    ...remaining.filter((candidate) => Boolean(candidate.sourceRegionCandidate)),
    ...remaining.filter((candidate) => !candidate.sourceRegionCandidate),
  ];
  for (const candidate of ordered) {
    if (selected.length >= params.targetCount) break;
    tryOptional(candidate);
  }

  for (const pair of replacementPairs) {
    logAiPipeline(
      "[GLOBAL_FAMILY_CANDIDATE_DECISION]",
      `place=${pair.rejected.placeName ?? pair.rejected.name}`,
      `placeId=${candidateKey(pair.rejected)}`,
      `family=${familyOf(pair.rejected)}`,
      "required=false",
      `candidateSource=${candidateSource(pair.rejected)}`,
      "decision=replaced",
      "reason=global_family_capacity",
      `replacementPlace=${pair.replacement.placeName ?? pair.replacement.name}`,
      `replacementFamily=${familyOf(pair.replacement)}`,
    );
  }

  const allFamilies = new Set(params.candidates.map(familyOf));
  for (const family of allFamilies) {
    const dailyCap =
      family in limits ? limits[family as keyof typeof limits] : Number.POSITIVE_INFINITY;
    const globalCapacity = Number.isFinite(dailyCap)
      ? params.dayCount * dailyCap
      : Number.POSITIVE_INFINITY;
    const requiredCount = params.candidates.filter(
      (candidate) => candidate.isRequiredBySelection && familyOf(candidate) === family,
    ).length;
    const optionalCandidateCount = params.candidates.filter(
      (candidate) => !candidate.isRequiredBySelection && familyOf(candidate) === family,
    ).length;
    const selectedCount = familyCounts.get(family) ?? 0;
    const rejectedCount = rejectedByFamily.get(family)?.length ?? 0;
    const replacementCount = replacementPairs.filter(
      (pair) => familyOf(pair.rejected) === family,
    ).length;
    const familyFeasible = !Number.isFinite(globalCapacity) || selectedCount <= globalCapacity;
    if (!familyFeasible) globallyFeasible = false;
    if (!familyFeasible || rejectedCount > 0 || replacementCount > 0) {
      logAiPipeline(
        "[GLOBAL_FAMILY_FEASIBILITY_SUMMARY]",
        `dayCount=${params.dayCount}`,
        `family=${family}`,
        `dailyCap=${Number.isFinite(dailyCap) ? dailyCap : "Infinity"}`,
        `globalCapacity=${Number.isFinite(globalCapacity) ? globalCapacity : "Infinity"}`,
        `requiredCount=${requiredCount}`,
        `optionalCandidateCount=${optionalCandidateCount}`,
        `selectedCount=${selectedCount}`,
        `rejectedCount=${rejectedCount}`,
        `replacementCount=${replacementCount}`,
        `globallyFeasible=${familyFeasible}`,
      );
    }
  }

  if (selected.length < params.targetCount) {
    logAiPipeline(
      "[GLOBAL_FAMILY_FEASIBILITY_SUMMARY]",
      `dayCount=${params.dayCount}`,
      "family=all",
      "dailyCap=mixed",
      `globalCapacity=${params.targetCount}`,
      `requiredCount=${selected.filter((candidate) => candidate.isRequiredBySelection).length}`,
      `optionalCandidateCount=${params.candidates.filter((candidate) => !candidate.isRequiredBySelection).length}`,
      `selectedCount=${selected.length}`,
      `rejectedCount=${rejectedIds.size}`,
      `replacementCount=${replacementPairs.length}`,
      "globallyFeasible=false",
      "reason=no_legal_replacement",
    );
    globallyFeasible = false;
  }

  return {
    selected,
    targetCount: params.targetCount,
    globallyFeasible,
    rejectedCount: rejectedIds.size,
    replacementCount: replacementPairs.length,
  };
}
