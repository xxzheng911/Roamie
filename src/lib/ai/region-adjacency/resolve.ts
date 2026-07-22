/**
 * Resolve nearby regions for any primary destination.
 * Hierarchy gate first (metro / living circle / admin); travel time only ranks.
 */
import { distanceMeters } from "@/lib/geo-distance";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  REGION_EDGES,
  REGION_NODES,
  type RegionNode,
} from "@/lib/ai/region-adjacency/graph";
import {
  evaluateNearRegionHierarchy,
  isNearRegionHierarchyCompatible,
} from "@/lib/ai/region-adjacency/hierarchy";
import {
  estimateTravelMinutesFromKm,
  NEARBY_DEFAULT_MAX_TRAVEL_MINUTES,
  NEARBY_FARTHER_MAX_KM,
  NEARBY_LIVING_CIRCLE_MAX_KM,
  NEARBY_POPULAR_MAX_KM,
  resolveNearbyDayPolicy,
} from "@/lib/ai/region-adjacency/day-policy";
import {
  NEARBY_TIER_ORDER,
  type NearbyRegionCandidate,
  type NearbyRegionResolveResult,
  type NearbyRegionTier,
  type ResolveNearbyRegionsOptions,
} from "@/lib/ai/region-adjacency/types";

/** Lightweight key for graph index — avoids circular init with trip-planning-context. */
function graphKey(label: string): string {
  return label.trim().replace(/\s+/g, "").toLowerCase();
}

let nodeByLabel: Map<string, RegionNode> | null = null;

function getNodeIndex(): Map<string, RegionNode> {
  if (nodeByLabel) return nodeByLabel;
  const map = new Map<string, RegionNode>();
  for (const node of REGION_NODES) {
    map.set(graphKey(node.id), node);
    for (const alias of node.aliases ?? []) {
      map.set(graphKey(alias), node);
    }
  }
  nodeByLabel = map;
  return map;
}

const TIER_RANK = new Map(
  NEARBY_TIER_ORDER.map((tier, index) => [tier, index]),
);

function findNode(label: string): RegionNode | null {
  const n = graphKey(label);
  if (!n) return null;
  return getNodeIndex().get(n) ?? null;
}

function resolvePrimaryCenter(
  _primary: string,
  node: RegionNode | null,
  _countryHint?: string | null,
): { lat: number; lng: number } | null {
  return node?.center ?? null;
}

function classifyDistanceTier(
  distanceKm: number,
  travelMinutes: number,
): NearbyRegionTier | null {
  if (
    travelMinutes > NEARBY_DEFAULT_MAX_TRAVEL_MINUTES ||
    distanceKm > NEARBY_FARTHER_MAX_KM
  ) {
    return distanceKm <= NEARBY_FARTHER_MAX_KM ? "farther" : null;
  }
  if (distanceKm <= 35 && travelMinutes <= 45) return "adjacent";
  if (distanceKm <= NEARBY_LIVING_CIRCLE_MAX_KM) return "living_circle";
  if (distanceKm <= NEARBY_POPULAR_MAX_KM) return "popular";
  return "farther";
}

function sortCandidates(list: NearbyRegionCandidate[]): NearbyRegionCandidate[] {
  return [...list].sort((a, b) => {
    const tierDiff =
      (TIER_RANK.get(a.tier) ?? 99) - (TIER_RANK.get(b.tier) ?? 99);
    if (tierDiff !== 0) return tierDiff;
    const minA = a.typicalTravelMinutes ?? Number.POSITIVE_INFINITY;
    const minB = b.typicalTravelMinutes ?? Number.POSITIVE_INFINITY;
    if (minA !== minB) return minA - minB;
    const kmA = a.distanceKm ?? Number.POSITIVE_INFINITY;
    const kmB = b.distanceKm ?? Number.POSITIVE_INFINITY;
    return kmA - kmB;
  });
}

function candidatesFromGraph(
  primaryNode: RegionNode,
  primaryCenter: { lat: number; lng: number } | null,
  allowSeparateTouristRegion: boolean,
): NearbyRegionCandidate[] {
  const out: NearbyRegionCandidate[] = [];
  const seen = new Set<string>();

  for (const edge of REGION_EDGES) {
    let otherId: string | null = null;
    if (edge.a === primaryNode.id) otherId = edge.b;
    else if (edge.b === primaryNode.id) otherId = edge.a;
    if (!otherId) continue;

    const other = findNode(otherId);
    if (!other || other.id === primaryNode.id) continue;
    if (seen.has(other.id)) continue;
    seen.add(other.id);

    const hierarchy = evaluateNearRegionHierarchy(primaryNode, other, {
      allowSeparateTouristRegion,
    });

    // Default path: hierarchy must pass. Opt-in farther keeps separate zones.
    if (!hierarchy.compatible && !allowSeparateTouristRegion) continue;

    let distanceKm: number | undefined;
    if (primaryCenter && other.center) {
      distanceKm = distanceMeters(primaryCenter, other.center) / 1000;
    }
    const typicalTravelMinutes =
      edge.typicalTravelMinutes ??
      (distanceKm != null ? estimateTravelMinutesFromKm(distanceKm) : undefined);

    const tier: NearbyRegionTier =
      !hierarchy.compatible && allowSeparateTouristRegion
        ? "farther"
        : edge.tier;

    out.push({
      label: other.id,
      tier,
      typicalTravelMinutes,
      distanceKm,
      aliases: other.aliases,
      adminArea: other.adminArea,
      countryCode: other.countryCode,
      metroArea: other.hierarchy.metroArea,
      livingCircle: other.hierarchy.livingCircle,
      touristZone: other.hierarchy.touristZone,
      hierarchyShared: hierarchy.shared,
      reason: hierarchy.compatible
        ? `graph:${edge.tier}|hierarchy:${hierarchy.reason}`
        : `graph:${edge.tier}|hierarchy_bypass:${hierarchy.reason}`,
    });
  }

  return out;
}

function candidatesFromDistance(
  primary: string,
  primaryNode: RegionNode | null,
  primaryCenter: { lat: number; lng: number },
  allowSeparateTouristRegion: boolean,
): NearbyRegionCandidate[] {
  // Without hierarchy for primary, distance alone must not invent nearby cities.
  if (!primaryNode) return [];

  const out: NearbyRegionCandidate[] = [];

  for (const other of REGION_NODES) {
    if (other.id === primaryNode.id) continue;
    if (graphKey(other.id) === graphKey(primary)) continue;
    if (other.countryCode !== primaryNode.countryCode) continue;
    if (!other.center) continue;

    const hierarchy = evaluateNearRegionHierarchy(primaryNode, other, {
      allowSeparateTouristRegion,
    });
    if (!hierarchy.compatible) continue;

    const distanceKm = distanceMeters(primaryCenter, other.center) / 1000;
    const typicalTravelMinutes = estimateTravelMinutesFromKm(distanceKm);
    const tier = classifyDistanceTier(distanceKm, typicalTravelMinutes);
    if (!tier) continue;
    if (other.hierarchy.separateTouristRegion && tier !== "farther") continue;

    out.push({
      label: other.id,
      tier,
      typicalTravelMinutes,
      distanceKm,
      aliases: other.aliases,
      adminArea: other.adminArea,
      countryCode: other.countryCode,
      metroArea: other.hierarchy.metroArea,
      livingCircle: other.hierarchy.livingCircle,
      touristZone: other.hierarchy.touristZone,
      hierarchyShared: hierarchy.shared,
      reason: `distance_fallback|hierarchy:${hierarchy.reason}`,
    });
  }

  return out;
}

function applyFilters(
  candidates: NearbyRegionCandidate[],
  opts: ResolveNearbyRegionsOptions,
  dayPolicyMax: number,
): NearbyRegionCandidate[] {
  const includeFarther = Boolean(opts.includeFarther);
  const maxTravel = NEARBY_DEFAULT_MAX_TRAVEL_MINUTES;

  let filtered = candidates.filter((c) => {
    if (c.tier === "farther" && !includeFarther) return false;
    if (
      !includeFarther &&
      typeof c.typicalTravelMinutes === "number" &&
      c.typicalTravelMinutes > maxTravel
    ) {
      return false;
    }
    return true;
  });

  filtered = sortCandidates(filtered);

  const hardMax =
    typeof opts.maxCandidates === "number" && opts.maxCandidates >= 0
      ? opts.forceInclude
        ? opts.maxCandidates
        : Math.min(opts.maxCandidates, dayPolicyMax)
      : dayPolicyMax;

  if (hardMax <= 0) return [];
  return filtered.slice(0, hardMax);
}

/**
 * Resolve ordered nearby region options for a primary destination.
 * Hierarchy first; does not invent destinations outside the graph/distance pool.
 */
export function resolveNearbyRegions(
  primaryDestination: string,
  opts: ResolveNearbyRegionsOptions = {},
): NearbyRegionResolveResult {
  const primary = normalizeDestinationLabel(primaryDestination);
  const dayPolicy = resolveNearbyDayPolicy(opts.tripDays);

  if (!primary) {
    return {
      primary: "",
      candidates: [],
      dayPolicy,
      source: "empty",
    };
  }

  const effectivePolicy =
    opts.forceInclude && dayPolicy.maxNearbyOptions === 0
      ? {
          ...dayPolicy,
          maxNearbyOptions: Math.max(1, opts.maxCandidates ?? 2),
          suggestNearbyByDefault: true,
          reason: "force_include_user_or_deep",
        }
      : dayPolicy;

  const allowSeparateTouristRegion = Boolean(opts.includeFarther);
  const primaryNode = findNode(primary);
  const primaryCenter = resolvePrimaryCenter(
    primary,
    primaryNode,
    opts.countryHint,
  );

  let source: NearbyRegionResolveResult["source"] = "empty";
  let raw: NearbyRegionCandidate[] = [];

  if (primaryNode) {
    raw = candidatesFromGraph(
      primaryNode,
      primaryCenter,
      allowSeparateTouristRegion,
    );
    if (raw.length) source = "adjacency_graph";
  }

  if (!raw.length && primaryCenter && primaryNode) {
    raw = candidatesFromDistance(
      primary,
      primaryNode,
      primaryCenter,
      allowSeparateTouristRegion,
    );
    if (raw.length) source = "distance_fallback";
  }

  const candidates = applyFilters(
    raw,
    opts,
    effectivePolicy.maxNearbyOptions === 0 && !opts.forceInclude
      ? 0
      : Math.max(effectivePolicy.maxNearbyOptions, opts.forceInclude ? 3 : 0),
  );

  const finalCandidates =
    !opts.forceInclude && !effectivePolicy.suggestNearbyByDefault
      ? []
      : candidates;

  logAiPipeline(
    "[REGION_ADJACENCY]",
    `primary=${primary}`,
    `source=${source}`,
    `tripDays=${opts.tripDays ?? "na"}`,
    `policy=${effectivePolicy.reason}`,
    `max=${effectivePolicy.maxNearbyOptions}`,
    `includeFarther=${Boolean(opts.includeFarther)}`,
    `hierarchyGate=on`,
    `count=${finalCandidates.length}`,
    `labels=[${finalCandidates.map((c) => c.label).join(",")}]`,
  );

  return {
    primary,
    candidates: finalCandidates,
    dayPolicy: effectivePolicy,
    source,
  };
}

/** All known nearby labels/aliases for utterance matching (optional primary scope). */
export function listNearbyRegionVocabulary(primaryDestination?: string): string[] {
  const labels = new Set<string>();

  if (primaryDestination?.trim()) {
    const resolved = resolveNearbyRegions(primaryDestination, {
      forceInclude: true,
      includeFarther: true,
      maxCandidates: 20,
      tripDays: 7,
    });
    for (const c of resolved.candidates) {
      labels.add(c.label);
      for (const a of c.aliases ?? []) labels.add(a);
    }
    const node = findNode(primaryDestination);
    if (node) {
      for (const edge of REGION_EDGES) {
        const other =
          edge.a === node.id ? edge.b : edge.b === node.id ? edge.a : null;
        if (!other) continue;
        labels.add(other);
        const otherNode = findNode(other);
        for (const a of otherNode?.aliases ?? []) labels.add(a);
      }
    }
  } else {
    for (const node of REGION_NODES) {
      labels.add(node.id);
      for (const a of node.aliases ?? []) labels.add(a);
    }
  }

  return [...labels].sort((a, b) => b.length - a.length);
}

/**
 * Whether a place/city label is considered "too far" / out-of-hierarchy
 * for default nearby of this primary.
 */
export function isTooFarForDefaultNearby(
  primaryDestination: string,
  candidateLabel: string,
): boolean {
  const primary = normalizeDestinationLabel(primaryDestination);
  const candidate = normalizeDestinationLabel(candidateLabel);
  if (!primary || !candidate) return false;

  const primaryNode = findNode(primary);
  const candidateNode = findNode(candidate);
  if (primaryNode && candidateNode) {
    if (
      !isNearRegionHierarchyCompatible(primaryNode, candidateNode, {
        allowSeparateTouristRegion: false,
      })
    ) {
      return true;
    }
    for (const edge of REGION_EDGES) {
      const match =
        (edge.a === primaryNode.id && edge.b === candidateNode.id) ||
        (edge.b === primaryNode.id && edge.a === candidateNode.id);
      if (!match) continue;
      if (edge.tier === "farther") return true;
      if (
        typeof edge.typicalTravelMinutes === "number" &&
        edge.typicalTravelMinutes > NEARBY_DEFAULT_MAX_TRAVEL_MINUTES
      ) {
        return true;
      }
      return false;
    }
    return false;
  }

  const centerA = resolvePrimaryCenter(primary, primaryNode, null);
  const centerB = candidateNode?.center;
  if (centerA && centerB) {
    const km = distanceMeters(centerA, centerB) / 1000;
    const minutes = estimateTravelMinutesFromKm(km);
    return (
      minutes > NEARBY_DEFAULT_MAX_TRAVEL_MINUTES || km > NEARBY_POPULAR_MAX_KM
    );
  }

  return false;
}

/** Build display place labels for a 「近郊備案」 combination theme. */
export function buildNearbyRegionComboPlaces(
  primaryDestination: string,
  opts: ResolveNearbyRegionsOptions = {},
): string[] {
  return resolveNearbyRegions(primaryDestination, opts).candidates.map(
    (c) => c.label,
  );
}

export { evaluateNearRegionHierarchy, isNearRegionHierarchyCompatible };
