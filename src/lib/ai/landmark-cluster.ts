/**
 * Generic "main landmark / sub-landmark" clustering + de-duplication.
 *
 * Goal: keep only the main tourist entity (主地標) per physical landmark and drop
 * its附屬地標 (gates 牌樓, entrances 入口, plazas 廣場, visitor centers, ticket
 * offices, statues, observation decks, castle keeps, branch halls, …).
 *
 * This is intentionally destination-agnostic — it must NOT hard-code 饒河夜市 or
 * any specific place. Clustering combines:
 *   1. normalized core name (see normalizeCorePlaceName)
 *   2. geographic proximity
 *   3. sub-landmark keyword detection (see landmark-keywords)
 *
 * Keywords alone never decide a duplicate; they only tip representative selection
 * and enable tight-radius cross-name merging (e.g. a gate named differently from
 * its parent).
 */

import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { normalizeCorePlaceName } from "@/lib/place-planning-memory";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";
import { detectSubPlaceType, type SubPlaceType } from "@/lib/ai/landmark-keywords";

/** Same-core landmarks within this radius are treated as one cluster. */
export const SAME_CORE_CLUSTER_METERS = 300;
/**
 * When core names differ but one candidate is clearly a sub-landmark (e.g. a
 * gate with its own proper name), only merge inside this tight radius.
 */
export const CROSS_NAME_SUBPLACE_METERS = 90;
/**
 * When one core name contains the other (e.g. 草悟道 ⊂ 草悟道綠園道…) and at
 * least one side is a sub-place / public-art POI, allow a walking-precinct
 * radius (~12–15 min). Data-driven; no city-specific lists.
 */
export const CONTAINED_NAME_SUBPLACE_METERS = 1500;

export type ResolvedLandmark = {
  placeId: string;
  rawPlaceId?: string;
  name: string;
  normalizedName: string;
  types: string[];
  latitude: number | null;
  longitude: number | null;
  parentPlaceId?: string;
  parentLandmarkKey?: string;
  isSubPlace: boolean;
  subPlaceType?: SubPlaceType;
};

export type LandmarkCluster = {
  key: string;
  representative: PlaceResult;
  members: PlaceResult[];
};

export type LandmarkDedupeResult = {
  places: PlaceResult[];
  clusters: LandmarkCluster[];
  removed: { place: PlaceResult; parent: PlaceResult; reason: string }[];
};

function placeCoords(place: PlaceResult): { lat: number; lng: number } | null {
  if (place.lat == null || place.lng == null) return null;
  if (Math.abs(place.lat) < 0.0001 && Math.abs(place.lng) < 0.0001) return null;
  return { lat: place.lat, lng: place.lng };
}

function rawPlaceIdOf(place: PlaceResult): string | undefined {
  const raw = (
    place.id ??
    (place as PlaceResult & { placeId?: string; googlePlaceId?: string }).placeId ??
    (place as PlaceResult & { googlePlaceId?: string }).googlePlaceId ??
    ""
  ).trim();
  return raw || undefined;
}

/** Build the structured landmark descriptor for one candidate place. */
export function resolveParentLandmark(place: PlaceResult): ResolvedLandmark {
  const name = place.name ?? "";
  const subPlaceType = detectSubPlaceType(name) ?? undefined;
  const coords = placeCoords(place);
  const parentLandmarkKey = normalizeCorePlaceName(name) || undefined;
  return {
    placeId: resolveTripPlaceId(place),
    rawPlaceId: rawPlaceIdOf(place),
    name,
    normalizedName: parentLandmarkKey ?? "",
    types: place.types ?? (place.primaryType ? [place.primaryType] : []),
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
    parentLandmarkKey,
    isSubPlace: Boolean(subPlaceType),
    subPlaceType,
  };
}

const STRONG_ATTRACTION_TYPES =
  /tourist_attraction|historical_landmark|national_park|amusement_park|museum|shrine|temple|hindu_temple|church|art_gallery/;

/**
 * Representative selection score (higher = more likely to be the main landmark).
 * Encodes product rules §5: main entity → reviews → attraction type → info
 * completeness → operational → photos → no sub-place suffix.
 */
function scoreRepresentative(place: PlaceResult, landmark: ResolvedLandmark): number {
  let score = 0;

  // 7. Prefer names WITHOUT sub-place suffix words (main landmark).
  if (!landmark.isSubPlace) score += 1000;

  // 1./3. Google primary type matches a real tourist attraction.
  const typeBlob = [...(place.types ?? []), place.primaryType].filter(Boolean).join(" ").toLowerCase();
  if (STRONG_ATTRACTION_TYPES.test(typeBlob)) score += 300;

  // 2. Review count (log-scaled) + rating.
  score += Math.log10((place.userRatingCount ?? 0) + 1) * 80;
  score += (place.rating ?? 0) * 10;

  // 4. Info completeness (address + hours + coordinates).
  if (place.address) score += 20;
  if (place.regularOpeningHours) score += 20;
  if (placeCoords(place)) score += 20;

  // 5. Operational business status.
  if (!place.businessStatus || place.businessStatus === "OPERATIONAL") score += 40;

  // 6. Has a photo.
  if (place.photoName) score += 30;

  // Shorter / cleaner names slightly preferred for equal cores.
  score += Math.max(0, 12 - (place.name?.length ?? 0)) * 2;

  return score;
}

function coordsWithin(
  a: ResolvedLandmark,
  b: ResolvedLandmark,
  maxMeters: number,
): boolean {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    // No coordinates on one side: fall back to name-only (caller gates this).
    return true;
  }
  return (
    distanceMeters(
      { lat: a.latitude, lng: a.longitude },
      { lat: b.latitude, lng: b.longitude },
    ) <= maxMeters
  );
}

/** True when one normalized core is a meaningful stem of the other. */
export function coresShareLandmarkStem(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  // Require a meaningful stem (≥2 chars) so single-char collisions don't merge.
  if (shorter.length < 2) return false;
  return longer.includes(shorter);
}

type WorkingCluster = {
  key: string;
  landmarks: ResolvedLandmark[];
  places: PlaceResult[];
};

function belongsToCluster(cluster: WorkingCluster, candidate: ResolvedLandmark): boolean {
  for (const member of cluster.landmarks) {
    const sameCore =
      Boolean(candidate.parentLandmarkKey) &&
      candidate.parentLandmarkKey === member.parentLandmarkKey;

    if (sameCore && coordsWithin(candidate, member, SAME_CORE_CLUSTER_METERS)) {
      return true;
    }

    const sharedStem = coresShareLandmarkStem(
      candidate.parentLandmarkKey ?? "",
      member.parentLandmarkKey ?? "",
    );
    const eitherSub = candidate.isSubPlace || member.isSubPlace;
    const shorterStemLen = Math.min(
      (candidate.parentLandmarkKey ?? "").length,
      (member.parentLandmarkKey ?? "").length,
    );

    // Contained-name precinct: 草悟道 + 草悟道綠園道公共藝術 (~12 min walk).
    if (
      sharedStem &&
      eitherSub &&
      candidate.latitude != null &&
      member.latitude != null &&
      coordsWithin(candidate, member, CONTAINED_NAME_SUBPLACE_METERS)
    ) {
      return true;
    }

    // 母地標 ↔ 商業複合設施（晴空塔 / 晴空塔城）：語幹包含且近距，不要求 sub-place keyword
    if (
      sharedStem &&
      shorterStemLen >= 4 &&
      candidate.latitude != null &&
      member.latitude != null &&
      coordsWithin(candidate, member, SAME_CORE_CLUSTER_METERS)
    ) {
      return true;
    }

    // Cross-name gate/entrance case: different names but one is a sub-landmark
    // sitting right next to the other.
    if (
      eitherSub &&
      candidate.latitude != null &&
      member.latitude != null &&
      coordsWithin(candidate, member, CROSS_NAME_SUBPLACE_METERS)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Cluster candidate places by main/sub landmark and keep one representative per
 * cluster. Standalone places pass through untouched.
 */
export function clusterAndDedupeLandmarks(places: PlaceResult[]): LandmarkDedupeResult {
  const working: WorkingCluster[] = [];

  for (const place of places) {
    const landmark = resolveParentLandmark(place);
    let target = working.find((cluster) => belongsToCluster(cluster, landmark));
    if (!target) {
      target = { key: landmark.parentLandmarkKey ?? landmark.placeId, landmarks: [], places: [] };
      working.push(target);
    }
    target.landmarks.push(landmark);
    target.places.push(place);
  }

  const clusters: LandmarkCluster[] = [];
  const removed: LandmarkDedupeResult["removed"] = [];
  const kept: PlaceResult[] = [];

  for (const cluster of working) {
    if (cluster.places.length === 1) {
      kept.push(cluster.places[0]!);
      continue;
    }

    const ranked = cluster.places
      .map((place, index) => ({
        place,
        landmark: cluster.landmarks[index]!,
        score: scoreRepresentative(place, cluster.landmarks[index]!),
      }))
      .sort((a, b) => b.score - a.score);

    const winner = ranked[0]!;
    kept.push(winner.place);
    clusters.push({
      key: cluster.key,
      representative: winner.place,
      members: cluster.places,
    });

    logAiPipeline(
      "[LANDMARK_CLUSTER_CREATED]",
      `key=${cluster.key}`,
      `places=[${cluster.places.map((p) => p.name).join(",")}]`,
    );

    for (const loser of ranked.slice(1)) {
      if (loser.landmark.isSubPlace) {
        logAiPipeline(
          "[SUB_PLACE_DETECTED]",
          `name=${loser.place.name}`,
          `subPlaceType=${loser.landmark.subPlaceType ?? "unknown"}`,
          `parent=${winner.place.name}`,
        );
      }
      const reason = loser.landmark.isSubPlace
        ? "sub_place_of_same_landmark"
        : "same_landmark_cluster";
      logAiPipeline(
        "[SELECTED_PLACE_MERGED]",
        `source=${loser.place.name}`,
        `representative=${winner.place.name}`,
        `reason=${reason}`,
      );
      removed.push({
        place: loser.place,
        parent: winner.place,
        reason,
      });
    }

    logAiPipeline(
      "[LANDMARK_REPRESENTATIVE_SELECTED]",
      `cluster=${cluster.key}`,
      `selected=${winner.place.name}`,
      `removed=[${ranked.slice(1).map((r) => r.place.name).join(",")}]`,
    );
  }

  return { places: kept, clusters, removed };
}

/**
 * Generic wrapper: de-duplicate any item list by landmark cluster, given a mapper
 * to PlaceResult. Returns kept items (representatives + standalones) and removed.
 */
export function dedupeLandmarkItems<T>(
  items: T[],
  toPlace: (item: T) => PlaceResult,
): { kept: T[]; removed: { item: T; parentName: string; reason: string }[] } {
  type Carrier = PlaceResult & { __item?: T };
  const carriers: Carrier[] = items.map((item) => {
    const place = toPlace(item) as Carrier;
    place.__item = item;
    return place;
  });
  const result = clusterAndDedupeLandmarks(carriers);
  const keptSet = new Set(result.places);
  const kept = carriers
    .filter((place) => keptSet.has(place))
    .map((place) => place.__item as T);
  const removed = result.removed.map((r) => ({
    item: (r.place as Carrier).__item as T,
    parentName: r.parent.name ?? "",
    reason: r.reason,
  }));
  return { kept, removed };
}

export type LandmarkClusterValidation = {
  ok: boolean;
  reasons: string[];
  /** resolveTripPlaceId of places that should be removed to satisfy clustering. */
  removePlaceIds: string[];
  clusterCount: number;
  duplicateCount: number;
};

type ValidationEntry = {
  place: PlaceResult;
  day: number;
};

/**
 * Cross-day / cross-alias validation (§11). Detects clusters that still have more
 * than one member across the whole itinerary and reports which places to drop.
 */
export function validateLandmarkClusters(entries: ValidationEntry[]): LandmarkClusterValidation {
  const reasons: string[] = [];
  const removePlaceIds = new Set<string>();

  const result = clusterAndDedupeLandmarks(entries.map((e) => e.place));
  const dayByPlaceId = new Map<string, number>();
  for (const entry of entries) {
    dayByPlaceId.set(resolveTripPlaceId(entry.place), entry.day);
  }

  // Exact duplicate place IDs across the itinerary.
  const seenIds = new Set<string>();
  for (const entry of entries) {
    const id = resolveTripPlaceId(entry.place);
    if (!id) continue;
    if (seenIds.has(id)) {
      reasons.push(`duplicate_place_id:${id}`);
      removePlaceIds.add(id);
    } else {
      seenIds.add(id);
    }
  }

  // Clusters with more than one surviving member = main + sub still coexisting.
  for (const cluster of result.clusters) {
    for (const removedInfo of result.removed) {
      const removedId = resolveTripPlaceId(removedInfo.place);
      const parentId = resolveTripPlaceId(removedInfo.parent);
      if (!removedId || removedId === parentId) continue;
      // Only a problem if BOTH the parent and the sub are actually in the itinerary.
      if (!seenIds.has(removedId) && !dayByPlaceId.has(removedId)) continue;
      reasons.push(`landmark_cluster_duplicate:${cluster.key}`);
      removePlaceIds.add(removedId);
      const day = dayByPlaceId.get(removedId) ?? 0;
      logAiPipeline(
        "[DUPLICATE_LANDMARK_REMOVED]",
        `day=${day}`,
        `place=${removedInfo.place.name}`,
        `reason=${removedInfo.reason}`,
      );
    }
  }

  const duplicateCount = removePlaceIds.size;
  if (duplicateCount === 0) {
    logAiPipeline(
      "[LANDMARK_VALIDATION_PASSED]",
      `clusterCount=${result.clusters.length}`,
      `duplicateCount=0`,
    );
  }

  return {
    ok: duplicateCount === 0,
    reasons: [...new Set(reasons)],
    removePlaceIds: [...removePlaceIds],
    clusterCount: result.clusters.length,
    duplicateCount,
  };
}
