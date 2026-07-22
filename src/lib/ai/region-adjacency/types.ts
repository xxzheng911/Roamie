/**
 * Region Adjacency / Nearby Region — shared types.
 * Destination-agnostic: same tier + day rules for every country/city.
 */

/** Recommendation priority (1 = highest). */
export type NearbyRegionTier =
  | "adjacent"
  | "living_circle"
  | "popular"
  | "farther";

export const NEARBY_TIER_ORDER: readonly NearbyRegionTier[] = [
  "adjacent",
  "living_circle",
  "popular",
  "farther",
] as const;

export type NearbyRegionCandidate = {
  /** Canonical display label (e.g. 犬山) */
  label: string;
  tier: NearbyRegionTier;
  /** One-way transit estimate in minutes when known */
  typicalTravelMinutes?: number;
  /** Haversine km when estimated from centers */
  distanceKm?: number;
  aliases?: string[];
  adminArea?: string;
  countryCode?: string;
  metroArea?: string;
  livingCircle?: string;
  touristZone?: string;
  hierarchyShared?: "metro" | "living_circle" | "admin";
  reason?: string;
};

export type ResolveNearbyRegionsOptions = {
  tripDays?: number | null;
  /**
   * Include farther day-trip regions (tier=farther / >90min).
   * Default false — only when user asks, deep travel, or explicit confirm.
   */
  includeFarther?: boolean;
  /** Soft override of max candidates (still clamped by day policy). */
  maxCandidates?: number;
  /** Country / region bias for ambiguous labels */
  countryHint?: string | null;
  /**
   * When true, ignore day-count suppression (1–3 days → 0).
   * Use for user-uttered nearby extensions.
   */
  forceInclude?: boolean;
};

export type NearbyDayPolicy = {
  /** Max nearby region options to surface in suggestions */
  maxNearbyOptions: number;
  /** Whether default suggestion UI should offer a nearby combo at all */
  suggestNearbyByDefault: boolean;
  reason: string;
};

export type NearbyRegionResolveResult = {
  primary: string;
  candidates: NearbyRegionCandidate[];
  dayPolicy: NearbyDayPolicy;
  source: "adjacency_graph" | "distance_fallback" | "empty";
};
