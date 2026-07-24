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
import { collapseParentLandmarkCandidates } from "@/lib/ai/ai-parent-landmark-dedup";
import { listTripDates } from "@/lib/outfit/group-by-date";
import {
  combinationIdsFromPlace,
  mergeCombinationProvenance,
} from "@/lib/ai/combination-provenance";
import {
  calculateDynamicStopCapacity,
  evaluateTotalRealPlaceValidation,
  type DynamicStopCapacity,
} from "@/lib/ai/real-place-supplement";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";

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

    let qualityPrimary = primary.filter((c) => keep(c, id));
    let qualityFallback = fallback.filter((c) => keep(c, id));
    // Promote fallback into primary when primary was depleted by quality filter.
    while (qualityPrimary.length < PRIMARY_PLACES_PER_COMBO && qualityFallback.length) {
      qualityPrimary.push(qualityFallback.shift()!);
    }

    // If discovery candidates were all quality-rejected, fall back to light profile names.
    if (!qualityPrimary.length && !qualityFallback.length && lightCombo?.places.length) {
      const lightPrimary = lightCombo.places.slice(0, PRIMARY_PLACES_PER_COMBO).map((name) => ({
        name,
        searchCandidateId: `name:${name}`,
        types: [] as string[],
      }));
      const lightFallback = lightCombo.places.slice(PRIMARY_PLACES_PER_COMBO).map((name) => ({
        name,
        searchCandidateId: `name:${name}`,
        types: [] as string[],
      }));
      qualityPrimary = lightPrimary.filter((c) => keep(c, id));
      qualityFallback = lightFallback.filter((c) => keep(c, id));
      while (qualityPrimary.length < PRIMARY_PLACES_PER_COMBO && qualityFallback.length) {
        qualityPrimary.push(qualityFallback.shift()!);
      }
    }

    const allRaw = [...qualityPrimary, ...qualityFallback];
    const collapsed = collapseParentLandmarkCandidates(
      allRaw.map((p) => ({
        name: p.name,
        googlePlaceId: p.googlePlaceId,
        address: p.address,
        lat: p.coordinates?.lat,
        lng: p.coordinates?.lng,
        rating: p.rating,
      })),
    );
    const keepKeys = new Set(
      collapsed.kept.map((c) => c.name.trim().replace(/\s+/g, "").toLowerCase()),
    );
    const all = allRaw.filter((p) =>
      keepKeys.has(p.name.trim().replace(/\s+/g, "").toLowerCase()),
    );
    qualityPrimary = all.slice(0, PRIMARY_PLACES_PER_COMBO);
    qualityFallback = all.slice(PRIMARY_PLACES_PER_COMBO);
    logAiPipeline(
      "[COMBINATION_CANDIDATE_POOL]",
      `combinationId=${id}`,
      `theme=${theme}`,
      `primary=${qualityPrimary.map((p) => p.name).join("|")}`,
      `fallback=${qualityFallback.map((p) => p.name).join("|")}`,
    );
    logAiPipeline(
      "[SELECTED_COMBINATION_PLACE_POOL]",
      `combinationId=${id}`,
      `count=${all.length}`,
      `places=[${all.map((p) => p.name).join(",")}]`,
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
    sourceCombinationIds?: number[];
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
  if (!matched.length && !place.sourceCombinationId && !place.sourceCombinationIds?.length) {
    return place;
  }
  return mergeCombinationProvenance(place, matched);
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

/**
 * Hard floor per selected combination was historically ≥1 representative.
 * Place-level coverage is now enforced via requiredAnchorPlaces (100%).
 * Soft per-combo targets still come from planSelectedCombinationCapacity.
 */
export function computeMinimumResolvedPerCombination(_tripDays: number): number {
  return 1;
}

/** Overall hard floor from dynamic capacity (not combo×3 / days×3). */
export function computeMinimumResolvedPlaces(params: {
  tripDays: number;
  selectedCombinationCount: number;
}): number {
  return calculateDynamicStopCapacity({
    tripDays: params.tripDays,
    selectedCombinationCount: params.selectedCombinationCount,
  }).minimumViableStops;
}

export type CombinationCapacityPlan = {
  tripDays: number;
  availableStopCapacity: number;
  preferredStops: number;
  minimumViableStops: number;
  maximumStops: number;
  selectedIds: number[];
  targetPerCombination: Record<number, number>;
  minimumRepresentativePerCombination: number;
  dynamicCapacity: DynamicStopCapacity;
};

/**
 * Estimate trip stop capacity first, then allocate soft targets per selected combination.
 * Never requires fixed N places per combo before knowing total capacity.
 */
export function planSelectedCombinationCapacity(params: {
  tripDays: number;
  selectedCombinationIds: number[];
}): CombinationCapacityPlan {
  const selectedIds = [...params.selectedCombinationIds].sort((a, b) => a - b);
  const tripDays = Math.max(1, params.tripDays);
  const dynamicCapacity = calculateDynamicStopCapacity({
    tripDays,
    selectedCombinationCount: selectedIds.length,
  });
  const availableStopCapacity = dynamicCapacity.preferredStops;
  const minimumRepresentativePerCombination = 1;
  const n = Math.max(selectedIds.length, 1);
  const base = Math.floor(availableStopCapacity / n);
  let remainder = availableStopCapacity - base * n;
  const targetPerCombination: Record<number, number> = {};
  for (const id of selectedIds) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    targetPerCombination[id] = Math.max(
      minimumRepresentativePerCombination,
      base + extra,
    );
  }
  const plan: CombinationCapacityPlan = {
    tripDays,
    availableStopCapacity,
    preferredStops: dynamicCapacity.preferredStops,
    minimumViableStops: dynamicCapacity.minimumViableStops,
    maximumStops: dynamicCapacity.maximumStops,
    selectedIds,
    targetPerCombination,
    minimumRepresentativePerCombination,
    dynamicCapacity,
  };
  logAiPipeline(
    "[SELECTED_COMBINATION_CAPACITY_PLAN]",
    `tripDays=${tripDays}`,
    `availableStopCapacity=${availableStopCapacity}`,
    `preferredStops=${dynamicCapacity.preferredStops}`,
    `minimumViableStops=${dynamicCapacity.minimumViableStops}`,
    `selectedIds=[${selectedIds.join(",")}]`,
    `targetPerCombination=${JSON.stringify(targetPerCombination)}`,
  );
  return plan;
}

/** Stamp / union combination provenance from pool name matches (never drop sources). */
export function ensureCombinationProvenanceOnPlaces<
  T extends {
    name?: string;
    placeName?: string;
    sourceCombinationId?: number;
    sourceCombinationIds?: number[];
    matchedCombinationIds?: number[];
    matchedSelectedCombinationIds?: number[];
  },
>(places: T[], destination: string, selectedCombinationIds: number[]): T[] {
  if (!selectedCombinationIds.length) return places;
  return places.map((p) =>
    annotatePlaceWithCombinationMetadata(p, destination, selectedCombinationIds),
  );
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
      const hit = params.resolvedPlaces.some((p) => {
        if (placeNameMatchesCandidate(p.placeName ?? p.name ?? "", candidate.name)) {
          return true;
        }
        return combinationIdsFromPlace(
          p as {
            sourceCombinationId?: number;
            sourceCombinationIds?: number[];
            matchedSelectedCombinationIds?: number[];
            matchedCombinationIds?: number[];
          },
        ).includes(pool.combinationId);
      });
      if (hit) resolvedNames.push(candidate.name);
      else failedNames.push(candidate.name);
    }
    // Also count places annotated to this combination that aren't in the name pool
    // (theme-search refill / region expansion hits).
    const annotatedExtra = params.resolvedPlaces.filter((p) => {
      const ids = combinationIdsFromPlace(
        p as {
          sourceCombinationId?: number;
          sourceCombinationIds?: number[];
          matchedSelectedCombinationIds?: number[];
          matchedCombinationIds?: number[];
        },
      );
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
  return resolveCanonicalPlaceIdentity(place).identityKey;
}

function combinationIdsOf(place: RoamieRecommendationItem): number[] {
  return combinationIdsFromPlace(place);
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
      const isFree = Boolean(
        (days[i] as { isFreeDay?: boolean } | undefined)?.isFreeDay,
      );
      if (isFree) continue;
      reasons.push(`empty_non_free_day:${i + 1}`);
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
        const stopIds = combinationIdsFromPlace(
          stop as RoamieItineraryItem & {
            matchedSelectedCombinationIds?: number[];
            sourceCombinationId?: number;
            sourceCombinationIds?: number[];
            matchedCombinationIds?: number[];
          },
        );
        if (stopIds.includes(id)) return true;
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
      `insufficient_real_places:got=${itineraryPlaces.length},need_at_least=${tripDays}`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Redistribute stops into empty days.
 *
 * Coverage-first: when total stops can meet minPerDay across all days, peel from
 * heaviest donors (keeping each donor ≥ minPerDay). Prefer lower per-day counts
 * over leaving a travel day empty. Singleton fill is only used when totals cannot
 * meet days×minPerDay but can still put ≥1 stop on every day.
 */
export function redistributeToFillEmptyDays(params: {
  stops: RoamieItineraryItem[];
  days: number;
  startDate: string;
  sparePlaces?: RoamieRecommendationItem[];
  makeStop?: (place: RoamieRecommendationItem, date: string, time: string) => RoamieItineraryItem;
  /** Minimum stops required on a filled day (default 2). */
  minPerDay?: number;
  /**
   * When true, do not create 1-stop days if totals can instead leave empties.
   * When totals ≥ days×minPerDay, peels proceed regardless.
   */
  forbidSingletonFill?: boolean;
}): RoamieItineraryItem[] {
  const dayCount = Math.max(params.days, 1);
  const minPerDay = Math.max(2, params.minPerDay ?? 2);
  const forbidSingleton = params.forbidSingletonFill !== false;
  const dates = listTripDates([], params.startDate, dayCount);
  const byDate = new Map<string, RoamieItineraryItem[]>();
  for (const date of dates) byDate.set(date, []);

  for (const stop of params.stops) {
    const date = stop.date?.trim() || dates[0]!;
    const list = byDate.get(date) ?? [];
    list.push(stop);
    byDate.set(date, list);
  }

  const totalStops = params.stops.length;
  const canCoverFull = totalStops >= dayCount * minPerDay;
  const canCoverSparse = totalStops >= dayCount;

  const emptyDates = () => dates.filter((d) => !(byDate.get(d)?.length));
  if (!emptyDates().length) {
    return params.stops;
  }

  for (const emptyDate of emptyDates()) {
    // Prefer unused spare places — only if we can fill minPerDay at once.
    if (params.sparePlaces?.length && params.makeStop) {
      const usedIds = new Set(
        [...byDate.values()].flat().map((s) => s.googlePlaceId?.trim()).filter(Boolean),
      );
      const usedNames = new Set(
        [...byDate.values()]
          .flat()
          .map((s) => normalizePlaceNameKey(s.placeName ?? s.title)),
      );
      const spares = params.sparePlaces.filter((p) => {
        const id = p.googlePlaceId?.trim();
        if (id && usedIds.has(id)) return false;
        const nameKey = normalizePlaceNameKey(p.placeName ?? p.name);
        return Boolean(nameKey) && !usedNames.has(nameKey);
      });
      if (spares.length >= minPerDay) {
        const filled = spares.slice(0, minPerDay).map((spare, i) =>
          params.makeStop!(spare, emptyDate, i === 0 ? "10:00" : "14:00"),
        );
        byDate.set(emptyDate, filled);
        logAiPipeline(
          "[AI_PLANNER_REDISTRIBUTE]",
          `emptyDate=${emptyDate}`,
          `action=fill_from_spares`,
          `count=${filled.length}`,
          "sourceFunction=redistributeToFillEmptyDays",
        );
        continue;
      }
    }

    // Peel from heaviest donors while keeping donor ≥ minPerDay.
    if (canCoverFull) {
      const filled: RoamieItineraryItem[] = [];
      while (filled.length < minPerDay) {
        const donorDate = [...dates]
          .filter((d) => d !== emptyDate && (byDate.get(d)?.length ?? 0) > minPerDay)
          .sort(
            (a, b) => (byDate.get(b)?.length ?? 0) - (byDate.get(a)?.length ?? 0),
          )[0];
        if (!donorDate) break;
        const donorList = byDate.get(donorDate)!;
        const moved = donorList.pop()!;
        byDate.set(donorDate, donorList);
        filled.push({ ...moved, date: emptyDate });
      }
      if (filled.length >= minPerDay) {
        byDate.set(emptyDate, filled);
        logAiPipeline(
          "[AI_PLANNER_REDISTRIBUTE]",
          `emptyDate=${emptyDate}`,
          "action=peel_from_donors",
          `count=${filled.length}`,
          "sourceFunction=redistributeToFillEmptyDays",
        );
        continue;
      }
      if (filled.length > 0 && canCoverSparse) {
        byDate.set(emptyDate, filled);
        logAiPipeline(
          "[AI_PLANNER_REDISTRIBUTE]",
          `emptyDate=${emptyDate}`,
          "action=peel_partial_for_coverage",
          `count=${filled.length}`,
          "sourceFunction=redistributeToFillEmptyDays",
        );
        continue;
      }
      // Return partial peels to heaviest donor when we cannot keep them.
      if (filled.length) {
        const restoreDate = [...dates]
          .filter((d) => d !== emptyDate)
          .sort(
            (a, b) => (byDate.get(b)?.length ?? 0) - (byDate.get(a)?.length ?? 0),
          )[0]!;
        const list = byDate.get(restoreDate) ?? [];
        for (const item of filled) {
          list.push({ ...item, date: restoreDate });
        }
        byDate.set(restoreDate, list);
      }
    }

    if (forbidSingleton && !canCoverSparse) {
      logAiPipeline(
        "[AI_PLANNER_REDISTRIBUTE]",
        `emptyDate=${emptyDate}`,
        "action=leave_empty_no_singleton_fill",
        `minPerDay=${minPerDay}`,
        "sourceFunction=redistributeToFillEmptyDays",
      );
      continue;
    }

    // Sparse coverage: peel one stop so the day is not blank.
    let donorDate: string | null = null;
    let donorList: RoamieItineraryItem[] | null = null;
    for (const date of dates) {
      const list = byDate.get(date) ?? [];
      if (list.length > minPerDay || (!forbidSingleton && list.length > 1)) {
        donorDate = date;
        donorList = list;
        break;
      }
    }
    if (donorDate && donorList && donorList.length > 1) {
      const moved = donorList.pop()!;
      byDate.set(donorDate, donorList);
      byDate.set(emptyDate, [{ ...moved, date: emptyDate }]);
      logAiPipeline(
        "[AI_PLANNER_REDISTRIBUTE]",
        `emptyDate=${emptyDate}`,
        "action=peel_singleton_for_coverage",
        "sourceFunction=redistributeToFillEmptyDays",
      );
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

export type SelectedPlaceOutcomeStatus =
  | "scheduled"
  | "merged_as_same_landmark"
  | "rejected_invalid_real_place"
  | "rejected_closed_or_unavailable"
  | "unresolved_after_all_retries"
  | "excluded_unselected_combination";

export type SelectedPlaceOutcome = {
  originalName: string;
  sourceCombinationId?: number;
  status: SelectedPlaceOutcomeStatus;
  scheduledPlaceName?: string;
  representativeName?: string;
  reason?: string;
};

export type SelectedCombinationCoverageReport = {
  required: number;
  scheduled: number;
  mergedAsDuplicate: number;
  invalid: number;
  unresolved: number;
  fallbackAdded: number;
  outcomes: SelectedPlaceOutcome[];
};

/**
 * Trace every user-selected place to an explicit outcome. Silent drops are not allowed.
 */
export function validateSelectedCombinationCoverage(params: {
  requiredPlaceNames: string[];
  scheduledStops: RoamieItineraryItem[];
  resolvedPlaces: RoamieRecommendationItem[];
  mergedAsDuplicate?: Array<{ source: string; representative: string; reason?: string }>;
  unresolvedNames?: string[];
  invalidNames?: Array<{ name: string; reason?: string }>;
  fallbackPlaceNames?: string[];
}): SelectedCombinationCoverageReport {
  const required = [...new Set(params.requiredPlaceNames.map((n) => n.trim()).filter(Boolean))];
  const outcomes: SelectedPlaceOutcome[] = [];
  const mergedMap = new Map(
    (params.mergedAsDuplicate ?? []).map((m) => [
      normalizePlaceNameKey(m.source),
      m,
    ]),
  );
  const unresolvedSet = new Set(
    (params.unresolvedNames ?? []).map((n) => normalizePlaceNameKey(n)),
  );
  const invalidMap = new Map(
    (params.invalidNames ?? []).map((n) => [normalizePlaceNameKey(n.name), n]),
  );

  let scheduled = 0;
  let mergedAsDuplicate = 0;
  let invalid = 0;
  let unresolved = 0;

  for (const name of required) {
    const key = normalizePlaceNameKey(name);
    const scheduledHit = params.scheduledStops.find((stop) =>
      placeNameMatchesCandidate(stop.placeName ?? stop.title, name),
    );
    if (scheduledHit) {
      scheduled += 1;
      outcomes.push({
        originalName: name,
        status: "scheduled",
        scheduledPlaceName: scheduledHit.placeName ?? scheduledHit.title,
      });
      continue;
    }

    const merged = mergedMap.get(key);
    if (merged) {
      mergedAsDuplicate += 1;
      outcomes.push({
        originalName: name,
        status: "merged_as_same_landmark",
        representativeName: merged.representative,
        reason: merged.reason ?? "sub_place_of_same_landmark",
      });
      continue;
    }

    // Also count as merged when the representative of a same-landmark merge is scheduled
    // and this name was a known alias of a resolved place that didn't make the cut.
    const resolvedAlias = params.resolvedPlaces.find((p) =>
      placeNameMatchesCandidate(p.placeName ?? p.name, name),
    );
    if (resolvedAlias) {
      const aliasScheduled = params.scheduledStops.find(
        (stop) =>
          (resolvedAlias.googlePlaceId &&
            stop.googlePlaceId === resolvedAlias.googlePlaceId) ||
          placeNameMatchesCandidate(
            stop.placeName ?? stop.title,
            resolvedAlias.placeName ?? resolvedAlias.name,
          ),
      );
      if (aliasScheduled) {
        scheduled += 1;
        outcomes.push({
          originalName: name,
          status: "scheduled",
          scheduledPlaceName: aliasScheduled.placeName ?? aliasScheduled.title,
        });
        continue;
      }
    }

    const invalidHit = invalidMap.get(key);
    if (invalidHit) {
      invalid += 1;
      outcomes.push({
        originalName: name,
        status: "rejected_invalid_real_place",
        reason: invalidHit.reason,
      });
      continue;
    }

    if (unresolvedSet.has(key) || !resolvedAlias) {
      unresolved += 1;
      outcomes.push({
        originalName: name,
        status: "unresolved_after_all_retries",
        reason: unresolvedSet.has(key) ? "mapping_failed" : "missing_from_pool",
      });
      continue;
    }

    unresolved += 1;
    outcomes.push({
      originalName: name,
      status: "unresolved_after_all_retries",
      reason: "resolved_but_not_scheduled",
    });
  }

  const requiredKeys = new Set(required.map(normalizePlaceNameKey));
  const fallbackAdded = (params.fallbackPlaceNames ?? []).filter(
    (n) => !requiredKeys.has(normalizePlaceNameKey(n)),
  ).length;

  const report: SelectedCombinationCoverageReport = {
    required: required.length,
    scheduled,
    mergedAsDuplicate,
    invalid,
    unresolved,
    fallbackAdded,
    outcomes,
  };

  logAiPipeline(
    "[SELECTED_PLACE_COVERAGE]",
    `required=${report.required}`,
    `scheduled=${report.scheduled}`,
    `mergedAsDuplicate=${report.mergedAsDuplicate}`,
    `invalid=${report.invalid}`,
    `unresolved=${report.unresolved}`,
    `fallbackAdded=${report.fallbackAdded}`,
  );

  return report;
}

export type FinalItineraryIntegrityResult = {
  ok: boolean;
  reasons: string[];
  coverage?: SelectedCombinationCoverageReport;
};

/**
 * Hard gate before persisting a formal itinerary. Failures must not save a half-built trip.
 */
export function validateFinalItineraryIntegrity(params: {
  selectedCombinationIds: number[];
  sessionSelectedCombinationIds?: number[];
  requiredPlaceNames: string[];
  scheduledStops: RoamieItineraryItem[];
  resolvedPlaces: RoamieRecommendationItem[];
  mergedAsDuplicate?: Array<{ source: string; representative: string; reason?: string }>;
  unresolvedNames?: string[];
  invalidNames?: Array<{ name: string; reason?: string }>;
  excludedPlaceNames?: string[];
  tripDays: number;
  startDate: string;
  destination?: string;
}): FinalItineraryIntegrityResult {
  const reasons: string[] = [];
  const {
    selectedCombinationIds,
    sessionSelectedCombinationIds,
    requiredPlaceNames,
    scheduledStops,
    resolvedPlaces,
    tripDays,
    startDate,
    destination,
  } = params;

  if (
    sessionSelectedCombinationIds?.length &&
    (sessionSelectedCombinationIds.length !== selectedCombinationIds.length ||
      sessionSelectedCombinationIds.some((id, i) => id !== selectedCombinationIds[i]))
  ) {
    reasons.push("selectedCombinationIds_session_mismatch");
  }

  const coverage = validateSelectedCombinationCoverage({
    requiredPlaceNames,
    scheduledStops,
    resolvedPlaces,
    mergedAsDuplicate: params.mergedAsDuplicate,
    unresolvedNames: params.unresolvedNames,
    invalidNames: params.invalidNames,
    fallbackPlaceNames: scheduledStops
      .map((s) => s.placeName ?? s.title)
      .filter((name) => {
        const key = normalizePlaceNameKey(name);
        return !requiredPlaceNames.some((r) => normalizePlaceNameKey(r) === key);
      }),
  });

  // Silent drops: every required place must have an explicit outcome, and unresolved
  // may not dominate when we still have capacity to schedule resolved required places.
  const silent = coverage.outcomes.filter(
    (o) =>
      o.status === "unresolved_after_all_retries" &&
      o.reason === "resolved_but_not_scheduled",
  );
  if (silent.length) {
    reasons.push(
      `silent_drop:${silent.map((o) => o.originalName).join(",")}`,
    );
  }

  // requiredAnchorPlaces: 100% coverage — merged_as_same_landmark is NOT enough
  // after user selection (parent collapse must happen before selection).
  const notDelivered = coverage.outcomes.filter(
    (o) =>
      o.status === "unresolved_after_all_retries" ||
      o.status === "merged_as_same_landmark",
  );
  if (requiredPlaceNames.length > 0 && notDelivered.length) {
    const missingScheduled = notDelivered.filter((o) => o.status !== "rejected_invalid_real_place");
    // merged_as_same_landmark after selection is a coverage failure.
    const merged = notDelivered.filter((o) => o.status === "merged_as_same_landmark");
    if (merged.length) {
      reasons.push(
        `required_anchor_collapsed_after_selection:${merged.map((o) => o.originalName).join(",")}`,
      );
    }
    const unresolved = silent.length
      ? silent
      : notDelivered.filter((o) => o.status === "unresolved_after_all_retries");
    if (unresolved.length) {
      reasons.push(
        `required_anchor_missing:${unresolved.map((o) => o.originalName).join(",")}`,
      );
    }
    void missingScheduled;
  }

  // Fallback must not massively replace selected places.
  if (
    coverage.required > 0 &&
    coverage.fallbackAdded > coverage.scheduled &&
    coverage.scheduled < Math.ceil(coverage.required * 0.5)
  ) {
    reasons.push(
      `fallback_over_selected:scheduled=${coverage.scheduled},fallback=${coverage.fallbackAdded}`,
    );
  }

  const excluded = params.excludedPlaceNames ?? [];
  for (const stop of scheduledStops) {
    const name = stop.placeName ?? stop.title;
    if (excluded.some((ex) => placeNameMatchesCandidate(name, ex))) {
      reasons.push(`unselected_combination_place:${name}`);
    }
    if (!stop.googlePlaceId?.trim()) {
      reasons.push(`missing_place_id:${name}`);
    }
    if (stop.lat == null || stop.lng == null) {
      reasons.push(`missing_coordinates:${name}`);
    }
    // Snapshot readiness: address is the minimum for immediate detail render.
    if (!stop.address?.trim() && !stop.googlePlaceId?.trim()) {
      reasons.push(`missing_snapshot:${name}`);
    }
  }

  const base = validateGeneratedItinerary({
    tripDays,
    startDate,
    selectedCombinationIds,
    days: groupStopsByTripDays(scheduledStops, tripDays, startDate),
    resolvedPlaces,
    destination,
  });
  reasons.push(...base.reasons);

  const result: FinalItineraryIntegrityResult = {
    ok: reasons.length === 0,
    reasons,
    coverage,
  };
  logAiPipeline(
    "[ITINERARY_INTEGRITY_CHECK]",
    `ok=${result.ok}`,
    `reasons=${result.reasons.join("|") || "none"}`,
  );
  return result;
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

export type CombinationCoverageStatus =
  | "covered"
  | "covered_by_region_selection"
  | "covered_by_merge"
  | "partially_covered"
  | "uncovered"
  | "unresolved_after_retry";

export type CombinationCoverageEntry = {
  rawCandidates: number;
  resolved: number;
  merged: number;
  scheduled?: number;
  resolvedRegions?: number;
  expandedPlaces?: number;
  scheduledRegions?: number;
  selectedRegion?: string;
  targetRepresentatives?: number;
  status: CombinationCoverageStatus;
};

export type MultiCombinationCoverageReport = {
  selectedCombinationIds: number[];
  combinations: Record<string, CombinationCoverageEntry>;
  totalResolved: number;
  minimumRequired: number;
  availableStopCapacity?: number;
  targetPerCombination?: Record<number, number>;
  supplementAttempted: boolean;
  coveredIds: number[];
  partiallyCoveredIds: number[];
  uncoveredIds: number[];
};

function isCoverageSatisfied(status: CombinationCoverageStatus): boolean {
  return (
    status === "covered" ||
    status === "covered_by_region_selection" ||
    status === "covered_by_merge" ||
    status === "partially_covered"
  );
}

/**
 * Build per-combination coverage after resolve / merge / optional region expand.
 * A combo is covered when it has ≥1 representative place (including merged provenance
 * or region-expanded landmarks) — not a fixed 3–4 places per combo.
 *
 * Attribution uses provenance arrays AND name-pool matching so mapping rename
 * cannot leave a combo "uncovered" while places exist.
 */
export function buildMultiCombinationCoverageReport(params: {
  destination: string;
  selectedCombinationIds: number[];
  resolvedPlaces: Array<{
    name?: string;
    placeName?: string;
    sourceCombinationId?: number;
    sourceCombinationIds?: number[];
    matchedSelectedCombinationIds?: number[];
    matchedCombinationIds?: number[];
    sourceRegionCandidate?: string;
  }>;
  regionExpansion?: Record<
    number,
    { regions: string[]; expandedPlaces: number; selectedRegion?: string }
  >;
  supplementAttempted?: boolean;
  tripDays?: number;
  capacityPlan?: CombinationCapacityPlan;
}): MultiCombinationCoverageReport {
  const pools = resolveSelectedCombinationPools(
    params.destination,
    params.selectedCombinationIds,
  );
  const stamped = ensureCombinationProvenanceOnPlaces(
    params.resolvedPlaces,
    params.destination,
    params.selectedCombinationIds,
  );
  const capacityPlan =
    params.capacityPlan ??
    planSelectedCombinationCapacity({
      tripDays: params.tripDays ?? Math.max(params.selectedCombinationIds.length, 1),
      selectedCombinationIds: params.selectedCombinationIds,
    });
  const combinations: Record<string, CombinationCoverageEntry> = {};
  const minTotal = capacityPlan.minimumViableStops;

  for (const pool of pools) {
    const regionMeta = params.regionExpansion?.[pool.combinationId];
    const target =
      capacityPlan.targetPerCombination[pool.combinationId] ??
      capacityPlan.minimumRepresentativePerCombination;
    const attributed = stamped.filter((p) =>
      combinationIdsFromPlace(p).includes(pool.combinationId),
    );
    const namedHits = pool.all.filter((c) =>
      stamped.some((p) =>
        placeNameMatchesCandidate(p.placeName ?? p.name ?? "", c.name),
      ),
    ).length;
    // Name-pool hits without provenance still count as representatives.
    const nameOnlyHits = stamped.filter((p) => {
      if (combinationIdsFromPlace(p).includes(pool.combinationId)) return false;
      return pool.all.some((c) =>
        placeNameMatchesCandidate(p.placeName ?? p.name ?? "", c.name),
      );
    });
    const representativeCount = attributed.length + nameOnlyHits.length;
    const regionExpanded = attributed.filter((p) => Boolean(p.sourceRegionCandidate));
    const hasDirect = representativeCount > 0;
    let status: CombinationCoverageStatus = "uncovered";
    if (regionMeta && regionMeta.expandedPlaces > 0 && (regionExpanded.length > 0 || hasDirect)) {
      // Region selection is a complete theme representation regardless of soft target.
      status = "covered_by_region_selection";
    } else if (hasDirect && namedHits === 0 && attributed.length > 0) {
      status = representativeCount >= target ? "covered_by_merge" : "partially_covered";
    } else if (hasDirect) {
      status = representativeCount >= target ? "covered" : "partially_covered";
    } else if (params.supplementAttempted) {
      status = "unresolved_after_retry";
    }

    combinations[String(pool.combinationId)] = {
      rawCandidates: pool.all.length,
      resolved: representativeCount,
      merged: Math.max(0, attributed.length - namedHits),
      resolvedRegions: regionMeta?.regions.length,
      expandedPlaces: regionMeta?.expandedPlaces,
      scheduledRegions:
        status === "covered_by_region_selection" ? 1 : regionMeta ? 0 : undefined,
      selectedRegion: regionMeta?.selectedRegion,
      targetRepresentatives: target,
      status,
    };

    logAiPipeline(
      "[COMBINATION_RESOLUTION_STATS]",
      `combinationId=${pool.combinationId}`,
      `raw=${pool.all.length}`,
      `resolved=${representativeCount}`,
      `failed=${Math.max(0, pool.all.length - namedHits)}`,
      `status=${status}`,
    );

    if (status === "partially_covered") {
      logAiPipeline(
        "[COMBINATION_PARTIAL_COVERAGE_ACCEPTED]",
        `combinationId=${pool.combinationId}`,
        `scheduledRepresentativeCount=${representativeCount}`,
        `target=${target}`,
      );
    }
  }

  const coveredIds = params.selectedCombinationIds.filter((id) => {
    const s = combinations[String(id)]?.status;
    return s === "covered" || s === "covered_by_merge" || s === "covered_by_region_selection";
  });
  const partiallyCoveredIds = params.selectedCombinationIds.filter(
    (id) => combinations[String(id)]?.status === "partially_covered",
  );
  const uncoveredIds = params.selectedCombinationIds.filter((id) => {
    const s = combinations[String(id)]?.status;
    return !s || s === "uncovered" || s === "unresolved_after_retry";
  });

  const report: MultiCombinationCoverageReport = {
    selectedCombinationIds: params.selectedCombinationIds,
    combinations,
    totalResolved: stamped.length,
    minimumRequired: minTotal,
    availableStopCapacity: capacityPlan.availableStopCapacity,
    targetPerCombination: capacityPlan.targetPerCombination,
    supplementAttempted: Boolean(params.supplementAttempted),
    coveredIds,
    partiallyCoveredIds,
    uncoveredIds,
  };

  logAiPipeline("[COMBINATION_COVERAGE_REPORT]", `report=${JSON.stringify(report)}`);
  return report;
}

export type SelectedCombinationIntegrityResult = {
  ok: boolean;
  reasons: string[];
  coverage: MultiCombinationCoverageReport;
  failureCode?:
    | "combination_uncovered"
    | "combination_coverage_insufficient"
    | "total_real_place_count_insufficient"
    | "total_place_count_insufficient"
    | "region_expansion_failed"
    | "selected_place_resolution_failed"
    | "place_resolution_failed"
    | "supplement_required";
};

/**
 * Gate after resolve+supplement and before geographic allocation.
 * Does NOT require a fixed N places per combo.
 * Uncovered combos may only fail after supplementAttempted === true.
 */
export function validateSelectedCombinationIntegrity(params: {
  destination: string;
  selectedCombinationIds: number[];
  resolvedPlaces: Array<{
    name?: string;
    placeName?: string;
    googlePlaceId?: string;
    sourceCombinationId?: number;
    sourceCombinationIds?: number[];
    matchedSelectedCombinationIds?: number[];
    matchedCombinationIds?: number[];
    sourceRegionCandidate?: string;
  }>;
  regionExpansion?: Record<
    number,
    { regions: string[]; expandedPlaces: number; selectedRegion?: string; failedRegions?: string[] }
  >;
  supplementAttempted?: boolean;
  tripDays: number;
  capacityPlan?: CombinationCapacityPlan;
}): SelectedCombinationIntegrityResult {
  const reasons: string[] = [];
  const ids = params.selectedCombinationIds;

  if (!ids.length) {
    reasons.push("selectedCombinationIds_empty");
  }

  const stamped = ensureCombinationProvenanceOnPlaces(
    params.resolvedPlaces,
    params.destination,
    ids,
  );

  const pools = resolveSelectedCombinationPools(params.destination, ids);
  for (const id of ids) {
    const pool = pools.find((p) => p.combinationId === id);
    const regionCovered =
      (params.regionExpansion?.[id]?.expandedPlaces ?? 0) > 0;
    if ((!pool || pool.all.length === 0) && !regionCovered) {
      reasons.push(`missing_candidate_pool:${id}`);
    }
  }

  for (const place of stamped) {
    if (!place.googlePlaceId?.trim()) {
      reasons.push(`unresolved_place:${place.placeName ?? place.name}`);
    }
  }

  const coverage = buildMultiCombinationCoverageReport({
    destination: params.destination,
    selectedCombinationIds: ids,
    resolvedPlaces: stamped,
    regionExpansion: params.regionExpansion,
    supplementAttempted: params.supplementAttempted,
    tripDays: params.tripDays,
    capacityPlan: params.capacityPlan,
  });

  const uncovered = coverage.uncoveredIds;

  if (uncovered.length && !params.supplementAttempted) {
    reasons.push(`supplement_required:${uncovered.join(",")}`);
  } else if (uncovered.length) {
    reasons.push(`uncovered_combinations:${uncovered.join(",")}`);
  }

  const dynamicCapacity =
    params.capacityPlan?.dynamicCapacity ??
    calculateDynamicStopCapacity({
      tripDays: params.tripDays,
      selectedCombinationCount: ids.length,
    });
  const placeValidation = evaluateTotalRealPlaceValidation(
    stamped.length,
    dynamicCapacity,
  );

  // Fail only below minimumViable — preferred shortfall enables compact mode.
  if (placeValidation.result === "fail") {
    reasons.push(
      `total_real_place_count_insufficient:got=${stamped.length},need=${dynamicCapacity.minimumViableStops},preferred=${dynamicCapacity.preferredStops}`,
    );
  }

  for (const id of ids) {
    const region = params.regionExpansion?.[id];
    if (
      region &&
      region.regions.length > 0 &&
      region.expandedPlaces === 0 &&
      (region.failedRegions?.length ?? 0) === region.regions.length
    ) {
      reasons.push(`region_expansion_failed:${id}`);
    }
  }

  let failureCode: SelectedCombinationIntegrityResult["failureCode"];
  if (uncovered.length && !params.supplementAttempted) {
    failureCode = "supplement_required";
  } else if (uncovered.length) {
    failureCode = "combination_uncovered";
  } else if (reasons.some((r) => r.startsWith("region_expansion_failed"))) {
    failureCode = "region_expansion_failed";
  } else if (reasons.some((r) => r.startsWith("total_real_place_count"))) {
    failureCode = "total_real_place_count_insufficient";
  } else if (reasons.some((r) => r.startsWith("unresolved_place"))) {
    failureCode = "place_resolution_failed";
  }

  // Partial coverage is accepted — never fail solely for under-target counts.
  for (const id of coverage.partiallyCoveredIds) {
    const entry = coverage.combinations[String(id)];
    logAiPipeline(
      "[COMBINATION_PARTIAL_COVERAGE_ACCEPTED]",
      `combinationId=${id}`,
      `scheduledRepresentativeCount=${entry?.resolved ?? 0}`,
    );
  }

  logAiPipeline(
    "[FINAL_COMBINATION_COVERAGE]",
    `selectedIds=[${ids.join(",")}]`,
    `coveredIds=[${coverage.coveredIds.join(",")}]`,
    `partiallyCoveredIds=[${coverage.partiallyCoveredIds.join(",")}]`,
    `uncoveredIds=[${uncovered.join(",")}]`,
  );

  if (uncovered.length || params.supplementAttempted) {
    logAiPipeline(
      "[INSUFFICIENT_RESOLVED_PLACES_DETAIL]",
      `uncoveredCombinationIds=[${uncovered.join(",")}]`,
      `totalResolved=${stamped.length}`,
      `minimumRequired=${coverage.minimumRequired}`,
      `minimumViable=${dynamicCapacity.minimumViableStops}`,
      `preferred=${dynamicCapacity.preferredStops}`,
      `validation=${placeValidation.result}`,
      `supplementAttempted=${Boolean(params.supplementAttempted)}`,
    );
  }

  // Only hard-fail on truly uncovered (after supplement) or empty total / bad place ids.
  // missing_candidate_pool alone is not fatal when places already cover the theme.
  const fatalReasons = reasons.filter(
    (r) =>
      r.startsWith("uncovered_combinations") ||
      r.startsWith("supplement_required") ||
      r.startsWith("total_real_place_count") ||
      r.startsWith("unresolved_place") ||
      r.startsWith("region_expansion_failed") ||
      r === "selectedCombinationIds_empty",
  );

  const ok = fatalReasons.length === 0;
  if (ok) {
    logAiPipeline("[ITINERARY_GENERATION_CONTRACT_PASSED]");
  }

  return {
    ok,
    reasons: fatalReasons.length ? fatalReasons : reasons,
    coverage,
    failureCode: ok ? undefined : failureCode,
  };
}

export { isCoverageSatisfied };
