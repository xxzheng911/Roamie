import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { combinationIdsFromPlace } from "@/lib/ai/combination-provenance";
import {
  classifyDailyDiversityCategory,
  dailyDiversityFamilyCounts,
  resolveDailyDiversityLimits,
  wouldViolateDailyDiversity,
  type DailyDiversityCategory,
} from "@/lib/ai/daily-category-diversity";
import { distanceMeters } from "@/lib/geo-distance";

type LatLng = { lat: number; lng: number };

export type SeedAssignmentCandidate = {
  item: RoamieRecommendationItem;
  preferredDay: number;
  preferredCenter?: LatLng;
};

export type DiversityAwareSeedAssignmentResult = {
  dayByKey: Map<string, number>;
  dayPlaces: RoamieRecommendationItem[][];
};

function itemKey(item: RoamieRecommendationItem): string {
  return (
    item.googlePlaceId?.trim() ||
    `${item.placeName ?? item.name}@${item.lat ?? ""},${item.lng ?? ""}`
  );
}

function itemCoords(item: RoamieRecommendationItem): LatLng | null {
  if (item.lat == null || item.lng == null) return null;
  if (Math.abs(item.lat) < 0.001 && Math.abs(item.lng) < 0.001) return null;
  return { lat: item.lat, lng: item.lng };
}

function toPlaceResult(item: RoamieRecommendationItem): PlaceResult {
  return {
    id: item.googlePlaceId?.trim() ?? "",
    name: item.placeName ?? item.name,
    address: item.address ?? null,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    photoName: item.photoName ?? null,
    primaryType: item.primaryType ?? item.type ?? null,
    types: item.types?.length ? item.types : item.type ? [item.type] : null,
    businessStatus: item.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: item.closingSoonNote ?? "",
    nextOpenHint: item.nextOpenHint ?? "",
  };
}

function centroid(items: readonly RoamieRecommendationItem[]): LatLng | null {
  const coords = items.map(itemCoords).filter((value): value is LatLng => value != null);
  if (!coords.length) return null;
  const total = coords.reduce(
    (sum, value) => ({ lat: sum.lat + value.lat, lng: sum.lng + value.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: total.lat / coords.length, lng: total.lng / coords.length };
}

function candidateSource(item: RoamieRecommendationItem): string {
  if (item.isRequiredBySelection) return "required_selection";
  if (item.sourceRegionCandidate) return "nearby_extension";
  if (combinationIdsFromPlace(item).length) return "selected_combination";
  return item.reasonSource === "ai" ? "supplement" : "fallback";
}

/**
 * Assign the already-selected scenic pool to seed days without making an
 * avoidable daily-family violation. Geography remains authoritative whenever
 * the cluster's preferred day is legal.
 */
export function assignDiversityAwareSeedDays(params: {
  candidates: SeedAssignmentCandidate[];
  dayCount: number;
  dailyScenicCapacity: number;
  geographicDayCenters?: Array<LatLng | null>;
}): DiversityAwareSeedAssignmentResult {
  const dayCount = Math.max(1, params.dayCount);
  const limits = resolveDailyDiversityLimits({ style: "mixed" });
  const dayPlaces: RoamieRecommendationItem[][] = Array.from({ length: dayCount }, () => []);
  const dayByKey = new Map<string, number>();
  const globallyAssignedKeys = new Set<string>();

  const normalized = params.candidates.map((candidate, stableIndex) => {
    const place = toPlaceResult(candidate.item);
    const family = classifyDailyDiversityCategory(place);
    const dailyCap = family in limits ? limits[family as keyof typeof limits] : Infinity;
    return { ...candidate, stableIndex, place, family, dailyCap };
  });

  // Constrained families go first so uncapped attractions cannot consume all
  // day capacity before a mathematically feasible capped distribution is placed.
  normalized.sort((a, b) => {
    if (a.item.isRequiredBySelection !== b.item.isRequiredBySelection) {
      return a.item.isRequiredBySelection ? -1 : 1;
    }
    if (Number.isFinite(a.dailyCap) !== Number.isFinite(b.dailyCap)) {
      return Number.isFinite(a.dailyCap) ? -1 : 1;
    }
    return a.stableIndex - b.stableIndex;
  });

  const distanceToDay = (candidate: (typeof normalized)[number], dayIndex: number): number => {
    const coords = itemCoords(candidate.item);
    if (!coords) return Number.POSITIVE_INFINITY;
    const assignedCenter = centroid(dayPlaces[dayIndex]!);
    const targetCenter =
      assignedCenter ?? params.geographicDayCenters?.[dayIndex] ?? candidate.preferredCenter;
    return targetCenter ? distanceMeters(coords, targetCenter) : Number.POSITIVE_INFINITY;
  };

  for (const candidate of normalized) {
    const key = itemKey(candidate.item);
    if (!key || globallyAssignedKeys.has(key)) continue;
    const preferredDay = Math.min(dayCount - 1, Math.max(0, candidate.preferredDay));
    const eligible = Array.from({ length: dayCount }, (_, dayIndex) => {
      const existing = dayPlaces[dayIndex]!.map(toPlaceResult);
      const diversity = wouldViolateDailyDiversity(existing, candidate.place, limits);
      return {
        dayIndex,
        diversity,
        withinCapacity: dayPlaces[dayIndex]!.length < params.dailyScenicCapacity,
        distance: distanceToDay(candidate, dayIndex),
      };
    }).filter((day) => day.diversity.ok && day.withinCapacity);

    eligible.sort((a, b) => {
      if (a.dayIndex === preferredDay || b.dayIndex === preferredDay) {
        return a.dayIndex === preferredDay ? -1 : 1;
      }
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.diversity.count !== b.diversity.count) {
        return a.diversity.count - b.diversity.count;
      }
      const loadDifference = dayPlaces[a.dayIndex]!.length - dayPlaces[b.dayIndex]!.length;
      return loadDifference || a.dayIndex - b.dayIndex;
    });

    const selectedDay = eligible[0]?.dayIndex;
    if (selectedDay == null) {
      if (candidate.item.isRequiredBySelection) {
        dayPlaces[preferredDay]!.push(candidate.item);
        dayByKey.set(key, preferredDay);
        globallyAssignedKeys.add(key);
        const preferredExisting = dayPlaces[preferredDay]!.slice(0, -1).map(toPlaceResult);
        const preferredCheck = wouldViolateDailyDiversity(
          preferredExisting,
          candidate.place,
          limits,
        );
        logAiPipeline(
          "[DIVERSITY_AWARE_SEED_ASSIGNMENT]",
          `place=${candidate.item.placeName ?? candidate.item.name}`,
          `placeId=${candidate.item.googlePlaceId ?? ""}`,
          `family=${candidate.family}`,
          `preferredDay=${preferredDay + 1}`,
          `assignedDay=${preferredDay + 1}`,
          `preferredDayFamilyCount=${preferredCheck.count}`,
          `assignedDayFamilyCountBefore=${preferredCheck.count}`,
          `dailyCap=${Number.isFinite(candidate.dailyCap) ? candidate.dailyCap : "Infinity"}`,
          `candidateSource=${candidateSource(candidate.item)}`,
          "required=true",
          "decision=required_infeasible_preserved",
          `reason=${preferredCheck.ok ? "day_capacity" : "no_legal_day"}`,
        );
      } else {
        logAiPipeline(
          "[DIVERSITY_AWARE_SEED_ASSIGNMENT]",
          `place=${candidate.item.placeName ?? candidate.item.name}`,
          `placeId=${candidate.item.googlePlaceId ?? ""}`,
          `family=${candidate.family}`,
          `preferredDay=${preferredDay + 1}`,
          "assignedDay=",
          `preferredDayFamilyCount=${dayPlaces[preferredDay]!.filter((item) => classifyDailyDiversityCategory(toPlaceResult(item)) === candidate.family).length}`,
          "assignedDayFamilyCountBefore=",
          `dailyCap=${Number.isFinite(candidate.dailyCap) ? candidate.dailyCap : "Infinity"}`,
          `candidateSource=${candidateSource(candidate.item)}`,
          "required=false",
          "decision=no_legal_day",
          "reason=no_legal_recipient",
        );
      }
      continue;
    }

    const preferredExisting = dayPlaces[preferredDay]!.map(toPlaceResult);
    const preferredCheck = wouldViolateDailyDiversity(preferredExisting, candidate.place, limits);
    const selectedCheck = eligible.find((day) => day.dayIndex === selectedDay)!.diversity;
    dayPlaces[selectedDay]!.push(candidate.item);
    dayByKey.set(key, selectedDay);
    globallyAssignedKeys.add(key);

    if (selectedDay !== preferredDay) {
      logAiPipeline(
        "[DIVERSITY_AWARE_SEED_ASSIGNMENT]",
        `place=${candidate.item.placeName ?? candidate.item.name}`,
        `placeId=${candidate.item.googlePlaceId ?? ""}`,
        `family=${candidate.family}`,
        `preferredDay=${preferredDay + 1}`,
        `assignedDay=${selectedDay + 1}`,
        `preferredDayFamilyCount=${preferredCheck.count}`,
        `assignedDayFamilyCountBefore=${selectedCheck.count}`,
        `dailyCap=${Number.isFinite(candidate.dailyCap) ? candidate.dailyCap : "Infinity"}`,
        `candidateSource=${candidateSource(candidate.item)}`,
        `required=${Boolean(candidate.item.isRequiredBySelection)}`,
        "decision=reassigned_for_diversity",
        `reason=${preferredCheck.ok ? "day_capacity" : (preferredCheck.reason ?? "daily_diversity")}`,
      );
    }
  }

  const globalFamilyCounts = dailyDiversityFamilyCounts(
    normalized.map((candidate) => candidate.place),
  );
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
    const places = dayPlaces[dayIndex]!.map(toPlaceResult);
    const counts = dailyDiversityFamilyCounts(places);
    const violations = Object.entries(limits)
      .filter(([family, cap]) => (counts[family] ?? 0) > cap)
      .map(([family, cap]) => `${family}:${counts[family]}>${cap}`);
    const cappedCounts = Object.keys(limits)
      .filter((family) => (counts[family] ?? 0) > 0)
      .map((family) => `${family}=${counts[family]}`);
    if (!cappedCounts.length && !violations.length) continue;
    logAiPipeline(
      "[SEED_DIVERSITY_SUMMARY]",
      `day=${dayIndex + 1}`,
      `familyCounts=${cappedCounts.join(",")}`,
      `violations=${violations.join(",")}`,
      `totalScenic=${places.length}`,
      `globallySelectedFamilyCounts=${Object.entries(globalFamilyCounts)
        .filter(([, count]) => count > 0)
        .map(([family, count]) => `${family}=${count}`)
        .join(",")}`,
    );
  }

  return { dayByKey, dayPlaces };
}
