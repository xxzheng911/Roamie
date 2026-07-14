/**
 * Multi-select combination integrity: merge, quota, provenance, and pre-save validation.
 */
import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { getDestinationCombinations } from "@/lib/ai/destination-combination-suggestions";
import {
  getCachedDiscoveredCombinations,
  getStructuredCombinationByIndex,
  PRIMARY_PLACES_PER_COMBO,
  type CombinationPlaceCandidate,
} from "@/lib/ai/destination-combination-discovery";
import {
  resolveThemeKeyFromTitle,
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import { listTripDates } from "@/lib/outfit/group-by-date";

function normalizePlaceNameKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

export function placeNameMatchesCandidate(placeName: string, candidate: string): boolean {
  const key = normalizePlaceNameKey(placeName);
  const allowed = normalizePlaceNameKey(candidate);
  if (!key || !allowed) return false;
  return key === allowed || key.includes(allowed) || allowed.includes(key);
}

export type CombinationCandidatePool = {
  combinationId: number;
  title: string;
  theme: string;
  primary: CombinationPlaceCandidate[];
  fallback: CombinationPlaceCandidate[];
  /** primary then fallback */
  all: CombinationPlaceCandidate[];
};

const poolMemo = new Map<string, CombinationCandidatePool[]>();

function poolMemoKey(destination: string, selectedCombinationIds: number[]): string {
  return `${destination.trim()}|${selectedCombinationIds.join(",")}`;
}

/** Resolve primary + fallback pools for selected combinations (prefer Places discovery cache). */
export function resolveSelectedCombinationPools(
  destination: string,
  selectedCombinationIds: number[],
  opts?: { forceRefresh?: boolean },
): CombinationCandidatePool[] {
  const key = poolMemoKey(destination, selectedCombinationIds);
  if (!opts?.forceRefresh) {
    const cached = poolMemo.get(key);
    if (cached) return cached;
  }

  const light = getDestinationCombinations(destination);
  const pools = selectedCombinationIds.map((id) => {
    const structured = getStructuredCombinationByIndex(destination, id);
    const lightCombo = light[id - 1];
    const title = structured?.title ?? lightCombo?.title ?? `組合 ${id}`;
    const theme = structured?.theme ?? resolveThemeKeyFromTitle(title);

    let primary: CombinationPlaceCandidate[] = [];
    let fallback: CombinationPlaceCandidate[] = [];

    if (structured?.placeCandidates.length) {
      primary = structured.primaryCandidates?.length
        ? structured.primaryCandidates
        : structured.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO);
      fallback = structured.fallbackCandidates?.length
        ? structured.fallbackCandidates
        : structured.placeCandidates.slice(PRIMARY_PLACES_PER_COMBO);
    } else if (lightCombo?.places.length) {
      const names = lightCombo.places;
      primary = names.slice(0, PRIMARY_PLACES_PER_COMBO).map((name) => ({
        name,
        searchCandidateId: `name:${name}`,
        types: [],
      }));
      fallback = names.slice(PRIMARY_PLACES_PER_COMBO).map((name) => ({
        name,
        searchCandidateId: `name:${name}`,
        types: [],
      }));
    }

    // Quality gate: low-quality names never occupy primary slots.
    const keep = (c: CombinationPlaceCandidate, comboId: number) => {
      const result = validateCandidateIntent(
        {
          name: c.name,
          types: c.types,
          primaryType: c.primaryType,
          lat: c.coordinates?.lat,
          lng: c.coordinates?.lng,
          rating: c.rating,
          googlePlaceId: c.googlePlaceId,
        },
        { title, theme },
        destination,
      );
      if (!result.ok) {
        logRejectedCandidate(c, comboId, result.reason ?? "quality");
        return false;
      }
      return true;
    };

    const qualityPrimary = primary.filter((c) => keep(c, id));
    const qualityFallback = fallback.filter((c) => keep(c, id));
    // Promote fallback into primary when primary was depleted by quality filter.
    while (qualityPrimary.length < PRIMARY_PLACES_PER_COMBO && qualityFallback.length) {
      qualityPrimary.push(qualityFallback.shift()!);
    }

    const all = [...qualityPrimary, ...qualityFallback];
    logAiPipeline(
      "[COMBINATION_CANDIDATE_POOL]",
      `combinationId=${id}`,
      `theme=${theme}`,
      `primary=${qualityPrimary.map((p) => p.name).join("|")}`,
      `fallback=${qualityFallback.map((p) => p.name).join("|")}`,
    );

    return {
      combinationId: id,
      title,
      theme,
      primary: qualityPrimary,
      fallback: qualityFallback,
      all,
    };
  });
  poolMemo.set(key, pools);
  return pools;
}

export function clearCombinationPoolMemo(): void {
  poolMemo.clear();
}

/** Resolve which selected combination ids a place name belongs to. */
export function matchSelectedCombinationIdsForPlace(
  placeName: string,
  destination: string,
  selectedCombinationIds: number[],
): number[] {
  const pools = resolveSelectedCombinationPools(destination, selectedCombinationIds);
  const matched: number[] = [];
  for (const pool of pools) {
    if (pool.all.some((p) => placeNameMatchesCandidate(placeName, p.name))) {
      matched.push(pool.combinationId);
    }
  }
  if (!matched.length) {
    const combos = getDestinationCombinations(destination);
    for (const id of selectedCombinationIds) {
      const combo = combos[id - 1];
      if (!combo) continue;
      if (combo.places.some((p) => placeNameMatchesCandidate(placeName, p))) {
        matched.push(id);
      }
    }
  }
  return matched;
}

export function annotatePlaceWithCombinationMetadata<
  T extends {
    name?: string;
    placeName?: string;
    sourceCombinationId?: number;
    matchedCombinationIds?: number[];
    matchedSelectedCombinationIds?: number[];
  },
>(
  place: T,
  destination: string,
  selectedCombinationIds: number[],
): T {
  const name = (place.placeName ?? place.name ?? "").trim();
  if (!name || !selectedCombinationIds.length) return place;
  const matched = matchSelectedCombinationIdsForPlace(
    name,
    destination,
    selectedCombinationIds,
  );
  if (!matched.length) return place;
  return {
    ...place,
    sourceCombinationId: place.sourceCombinationId ?? matched[0],
    matchedCombinationIds: place.matchedCombinationIds?.length
      ? place.matchedCombinationIds
      : matched,
    matchedSelectedCombinationIds: matched,
  };
}

export type CombinationCandidateMergeStats = {
  perCombinationBeforeDedup: Record<number, number>;
  mergedBeforeDedup: number;
  mergedAfterDedup: number;
  places: string[];
  pools: CombinationCandidatePool[];
};

/** Flat-merge selected combination place names (primary + fallback) — never overwrite. */
export function mergeSelectedCombinationCandidates(
  destination: string,
  selectedCombinationIds: number[],
): CombinationCandidateMergeStats {
  const pools = resolveSelectedCombinationPools(destination, selectedCombinationIds);
  const perCombinationBeforeDedup: Record<number, number> = {};
  const before: string[] = [];

  for (const pool of pools) {
    perCombinationBeforeDedup[pool.combinationId] = pool.all.length;
    before.push(...pool.all.map((p) => p.name));
    logAiPipeline(
      "[COMBINATION_CANDIDATE_COUNTS]",
      `combinationId=${pool.combinationId}`,
      `primary=${pool.primary.length}`,
      `fallback=${pool.fallback.length}`,
      `count=${pool.all.length}`,
    );
  }

  const seen = new Set<string>();
  const places: string[] = [];
  for (const name of before) {
    const key = normalizePlaceNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    places.push(name);
  }

  logAiPipeline(
    "[COMBINATION_CANDIDATE_COUNTS]",
    `mergedBeforeDedup=${before.length}`,
    `mergedAfterDedup=${places.length}`,
  );

  return {
    perCombinationBeforeDedup,
    mergedBeforeDedup: before.length,
    mergedAfterDedup: places.length,
    places,
    pools,
  };
}

export function computeMinimumPerSelectedCombination(
  targetPlaceCount: number,
  selectedCombinationCount: number,
): number {
  if (selectedCombinationCount <= 0) return 0;
  return Math.max(1, Math.floor(targetPlaceCount / selectedCombinationCount / 2));
}

/** Minimum resolved places required per selected combination before scheduling. */
export function computeMinimumResolvedPerCombination(tripDays: number): number {
  return tripDays >= 4 ? 2 : 1;
}

/** Overall minimum for a multi-day trip with selected combinations. */
export function computeMinimumResolvedPlaces(params: {
  tripDays: number;
  selectedCombinationCount: number;
}): number {
  const perCombo = computeMinimumResolvedPerCombination(params.tripDays);
  const byCombo = params.selectedCombinationCount * perCombo;
  const byDays = params.tripDays;
  return Math.max(byCombo, byDays, Math.min(params.tripDays * 2, 12));
}

export type CombinationPlaceMappingStats = {
  combinationId: number;
  candidateCount: number;
  primaryCandidates: number;
  fallbackCandidatesUsed: number;
  searchRequests: number;
  searchRetries: number;
  resolvedCount: number;
  failedCount: number;
  failedNames: string[];
};

export function buildCombinationPlaceMappingStats(params: {
  destination: string;
  selectedCombinationIds: number[];
  resolvedPlaces: Array<{ name?: string; placeName?: string }>;
  mappingMeta?: Record<
    number,
    {
      fallbackCandidatesUsed?: number;
      searchRequests?: number;
      searchRetries?: number;
      primaryCandidates?: number;
    }
  >;
}): CombinationPlaceMappingStats[] {
  const pools = resolveSelectedCombinationPools(
    params.destination,
    params.selectedCombinationIds,
  );
  return pools.map((pool) => {
    const candidates = pool.all;
    const resolvedNames: string[] = [];
    const failedNames: string[] = [];
    for (const candidate of candidates) {
      const hit = params.resolvedPlaces.some(
        (p) =>
          placeNameMatchesCandidate(p.placeName ?? p.name ?? "", candidate.name) ||
          (p as { sourceCombinationId?: number }).sourceCombinationId ===
            pool.combinationId,
      );
      if (hit) resolvedNames.push(candidate.name);
      else failedNames.push(candidate.name);
    }
    // Also count places annotated to this combination that aren't in the name pool
    // (theme-search refill hits).
    const annotatedExtra = params.resolvedPlaces.filter((p) => {
      const ids =
        (p as { matchedSelectedCombinationIds?: number[] }).matchedSelectedCombinationIds ??
        ((p as { sourceCombinationId?: number }).sourceCombinationId != null
          ? [(p as { sourceCombinationId: number }).sourceCombinationId]
          : []);
      if (!ids.includes(pool.combinationId)) return false;
      return !candidates.some((c) =>
        placeNameMatchesCandidate(p.placeName ?? p.name ?? "", c.name),
      );
    });

    const meta = params.mappingMeta?.[pool.combinationId];
    const resolvedCount = resolvedNames.length + annotatedExtra.length;
    const stats: CombinationPlaceMappingStats = {
      combinationId: pool.combinationId,
      candidateCount: candidates.length,
      primaryCandidates: meta?.primaryCandidates ?? pool.primary.length,
      fallbackCandidatesUsed: meta?.fallbackCandidatesUsed ?? 0,
      searchRequests: meta?.searchRequests ?? 0,
      searchRetries: meta?.searchRetries ?? 0,
      resolvedCount,
      failedCount: failedNames.length,
      failedNames,
    };
    logAiPipeline(
      "[COMBINATION_PLACE_MAPPING_STATS]",
      `combinationId=${stats.combinationId}`,
      `candidateCount=${stats.candidateCount}`,
      `primaryCandidates=${stats.primaryCandidates}`,
      `fallbackCandidatesUsed=${stats.fallbackCandidatesUsed}`,
      `searchRequests=${stats.searchRequests}`,
      `searchRetries=${stats.searchRetries}`,
      `resolvedCount=${stats.resolvedCount}`,
      `failedCount=${stats.failedCount}`,
    );
    logAiPipeline(
      "[COMBINATION_MAPPING_STATS]",
      `combinationId=${stats.combinationId}`,
      `primaryCandidates=${stats.primaryCandidates}`,
      `fallbackCandidatesUsed=${stats.fallbackCandidatesUsed}`,
      `searchRequests=${stats.searchRequests}`,
      `searchRetries=${stats.searchRetries}`,
      `resolvedCount=${stats.resolvedCount}`,
      `failedCount=${stats.failedCount}`,
    );
    return stats;
  });
}

function placeKey(place: RoamieRecommendationItem): string {
  return (
    place.googlePlaceId?.trim() ||
    `${normalizePlaceNameKey(place.placeName ?? place.name)}@${place.lat ?? ""},${place.lng ?? ""}`
  );
}

function combinationIdsOf(place: RoamieRecommendationItem): number[] {
  if (place.matchedSelectedCombinationIds?.length) {
    return place.matchedSelectedCombinationIds;
  }
  if (place.sourceCombinationId != null) return [place.sourceCombinationId];
  return [];
}

/**
 * Pick places satisfying minimum quota per selected combination, then fill remainder.
 * Never lets ranking discard an entire selected combination.
 */
export function selectPlacesWithCombinationQuota(params: {
  places: RoamieRecommendationItem[];
  selectedCombinationIds: number[];
  targetPlaceCount: number;
  destination: string;
}): RoamieRecommendationItem[] {
  const {
    places,
    selectedCombinationIds,
    targetPlaceCount,
    destination,
  } = params;
  if (!selectedCombinationIds.length) {
    return places.slice(0, Math.max(targetPlaceCount, places.length));
  }

  const annotated = places.map((p) =>
    annotatePlaceWithCombinationMetadata(p, destination, selectedCombinationIds),
  );
  const minPer = computeMinimumPerSelectedCombination(
    Math.max(targetPlaceCount, selectedCombinationIds.length * 2),
    selectedCombinationIds.length,
  );

  const used = new Set<string>();
  const picked: RoamieRecommendationItem[] = [];

  const take = (place: RoamieRecommendationItem) => {
    const key = placeKey(place);
    if (!key || used.has(key)) return false;
    used.add(key);
    picked.push(place);
    return true;
  };

  for (const id of selectedCombinationIds) {
    const pool = annotated.filter((p) => combinationIdsOf(p).includes(id));
    let taken = 0;
    for (const place of pool) {
      if (taken >= minPer) break;
      if (take(place)) taken += 1;
    }
  }

  for (const place of annotated) {
    if (picked.length >= targetPlaceCount) break;
    take(place);
  }

  for (const id of selectedCombinationIds) {
    const has = picked.some((p) => combinationIdsOf(p).includes(id));
    if (has) continue;
    const fallback = annotated.find(
      (p) => combinationIdsOf(p).includes(id) && !used.has(placeKey(p)),
    );
    if (fallback) take(fallback);
  }

  return picked;
}

export type GeneratedItineraryValidation = {
  ok: boolean;
  reasons: string[];
};

/** Pre-save gate: no empty days, every selected combination represented, real places only. */
export function validateGeneratedItinerary(params: {
  tripDays: number;
  startDate: string;
  selectedCombinationIds: number[];
  days: Array<{ date?: string; places: RoamieItineraryItem[] }>;
  resolvedPlaces: RoamieRecommendationItem[];
  destination?: string;
  allowUnselectedExclusive?: string[];
}): GeneratedItineraryValidation {
  const reasons: string[] = [];
  const { tripDays, selectedCombinationIds, days, resolvedPlaces } = params;
  const destination = params.destination ?? "";

  if (days.length !== tripDays) {
    reasons.push(`day_count_mismatch:got=${days.length},expected=${tripDays}`);
  }

  for (let i = 0; i < days.length; i += 1) {
    if (!days[i]?.places.length) {
      reasons.push(`empty_day:${i + 1}`);
    }
  }

  const itineraryPlaces = days.flatMap((d) => d.places);
  const seenIds = new Set<string>();
  for (const stop of itineraryPlaces) {
    const id = stop.googlePlaceId?.trim();
    if (!id) {
      reasons.push(`unresolved_place:${stop.placeName ?? stop.title}`);
      continue;
    }
    if (seenIds.has(id)) {
      reasons.push(`duplicate_placeId:${id}`);
    }
    seenIds.add(id);

    if (destination) {
      const quality = validateCandidateIntent(
        {
          name: stop.placeName ?? stop.title,
          address: stop.address,
          lat: stop.lat,
          lng: stop.lng,
          googlePlaceId: id,
        },
        {},
        destination,
      );
      if (
        !quality.ok &&
        (quality.reason === "generic_category_label" ||
          quality.reason === "non_tourism_name" ||
          quality.reason === "transit_or_station" ||
          quality.reason === "incomplete_name")
      ) {
        reasons.push(`low_quality_stop:${stop.placeName ?? stop.title}:${quality.reason}`);
      }
    }
  }

  if (selectedCombinationIds.length) {
    for (const id of selectedCombinationIds) {
      const covered = itineraryPlaces.some((stop) => {
        const matched =
          (stop as RoamieItineraryItem & {
            matchedSelectedCombinationIds?: number[];
            sourceCombinationId?: number;
          }).matchedSelectedCombinationIds ??
          ((stop as RoamieItineraryItem & { sourceCombinationId?: number })
            .sourceCombinationId != null
            ? [
                (stop as RoamieItineraryItem & { sourceCombinationId?: number })
                  .sourceCombinationId!,
              ]
            : []);
        if (matched.includes(id)) return true;
        const linked = resolvedPlaces.find(
          (p) =>
            (p.googlePlaceId && p.googlePlaceId === stop.googlePlaceId) ||
            placeNameMatchesCandidate(stop.placeName ?? stop.title, p.placeName ?? p.name),
        );
        return linked ? combinationIdsOf(linked).includes(id) : false;
      });
      if (!covered) {
        reasons.push(`missing_combination:${id}`);
      }
    }
  }

  if (itineraryPlaces.length < tripDays) {
    reasons.push(
      `insufficient_places:got=${itineraryPlaces.length},need_at_least=${tripDays}`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/** Redistribute stops so every trip day has ≥1 place (prefer real places over leaving blanks). */
export function redistributeToFillEmptyDays(params: {
  stops: RoamieItineraryItem[];
  days: number;
  startDate: string;
  sparePlaces?: RoamieRecommendationItem[];
  makeStop?: (place: RoamieRecommendationItem, date: string, time: string) => RoamieItineraryItem;
}): RoamieItineraryItem[] {
  const dayCount = Math.max(params.days, 1);
  const dates = listTripDates([], params.startDate, dayCount);
  const byDate = new Map<string, RoamieItineraryItem[]>();
  for (const date of dates) byDate.set(date, []);

  for (const stop of params.stops) {
    const date = stop.date?.trim() || dates[0]!;
    const list = byDate.get(date) ?? [];
    list.push(stop);
    byDate.set(date, list);
  }

  const emptyDates = dates.filter((d) => !(byDate.get(d)?.length));
  if (!emptyDates.length) {
    return params.stops;
  }

  for (const emptyDate of emptyDates) {
    let donorDate: string | null = null;
    let donorList: RoamieItineraryItem[] | null = null;
    for (const date of dates) {
      const list = byDate.get(date) ?? [];
      if (list.length > 1) {
        donorDate = date;
        donorList = list;
        break;
      }
    }
    if (donorDate && donorList && donorList.length > 1) {
      const moved = donorList.pop()!;
      byDate.set(donorDate, donorList);
      byDate.set(emptyDate, [{ ...moved, date: emptyDate }]);
      continue;
    }

    if (params.sparePlaces?.length && params.makeStop) {
      const usedIds = new Set(
        [...byDate.values()].flat().map((s) => s.googlePlaceId?.trim()).filter(Boolean),
      );
      const usedNames = new Set(
        [...byDate.values()]
          .flat()
          .map((s) => normalizePlaceNameKey(s.placeName ?? s.title)),
      );
      const spare = params.sparePlaces.find((p) => {
        const id = p.googlePlaceId?.trim();
        if (id && usedIds.has(id)) return false;
        const nameKey = normalizePlaceNameKey(p.placeName ?? p.name);
        return !usedNames.has(nameKey);
      });
      if (spare) {
        byDate.set(emptyDate, [params.makeStop(spare, emptyDate, "14:00")]);
      }
    }
  }

  return dates.flatMap((date) => byDate.get(date) ?? []);
}

export function groupStopsByTripDays(
  stops: RoamieItineraryItem[],
  days: number,
  startDate: string,
): Array<{ date: string; places: RoamieItineraryItem[] }> {
  const dates = listTripDates([], startDate, Math.max(days, 1));
  return dates.map((date) => ({
    date,
    places: stops.filter((s) => (s.date?.trim() || dates[0]) === date),
  }));
}

export function expandAllowlistNamesFromPools(
  destination: string,
  selectedCombinationIds: number[],
  existingNames?: string[],
): string[] {
  const pools = resolveSelectedCombinationPools(destination, selectedCombinationIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of existingNames ?? []) {
    const key = normalizePlaceNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  for (const pool of pools) {
    for (const c of pool.all) {
      const key = normalizePlaceNameKey(c.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(c.name);
    }
  }
  const cached = getCachedDiscoveredCombinations(destination);
  if (cached) {
    for (const id of selectedCombinationIds) {
      const combo = cached[id - 1];
      if (!combo) continue;
      for (const c of combo.placeCandidates) {
        const key = normalizePlaceNameKey(c.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(c.name);
      }
    }
  }
  return out;
}
