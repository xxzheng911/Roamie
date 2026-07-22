/**
 * RAOS Candidate Pool Pipeline — types
 *
 * Places Search → Quality Gate → Category Diversity → Query Diversity →
 * Geo Clustering → Temporal Diversity → Travel Flow → Experience Optimizer →
 * Candidate Pool → Recommendation Engine → Planner → Validator → UI
 */

import type { PlaceResult } from "@/lib/place-result";
import type { PlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";

export const CANDIDATE_POOL_VERSION = "cp-1.0";

export type TemporalSlot =
  | "morning"
  | "lunch"
  | "afternoon"
  | "dinner"
  | "night";

export type TravelIntent =
  | "view"
  | "culture"
  | "food"
  | "shopping"
  | "experience"
  | "relax"
  | "night";

/** Experience family — used to avoid Temple→Temple→Temple sequences */
export type ExperienceFamily =
  | "temple_heritage"
  | "museum_gallery"
  | "park_nature"
  | "observation"
  | "shopping"
  | "cafe"
  | "food"
  | "nightlife"
  | "market"
  | "generic";

export type PoolCategory =
  | "attraction"
  | "food"
  | "cafe"
  | "shopping"
  | "culture"
  | "night"
  | "nature"
  | "market";

export type CandidatePoolStageName =
  | "search"
  | "quality"
  | "category"
  | "query"
  | "geo"
  | "temporal"
  | "flow"
  | "experience"
  | "finalize";

export type QualityRejectReason =
  | "low_rating"
  | "few_reviews"
  | "permanently_closed"
  | "large_chain"
  | "supermarket"
  | "hypermarket"
  | "office"
  | "residential"
  | "duplicate_brand"
  | "burial"
  | "low_value"
  | "not_popular"
  | "missing_identity";

export type AnnotatedPoolPlace = {
  place: PlaceResult;
  category: PoolCategory;
  planKind: PlanPlaceKind;
  temporalSlots: TemporalSlot[];
  travelIntent: TravelIntent;
  experienceFamily: ExperienceFamily;
  geoClusterId: string | null;
  qualityPassed: boolean;
  rejectReason?: QualityRejectReason;
};

export type PoolGeoCluster = {
  clusterId: string;
  centerLat: number;
  centerLng: number;
  areaName: string;
  placeIds: string[];
  count: number;
  share: number;
};

export type CandidatePoolDemand = {
  days: number;
  style: TripStyleKey;
  /** Canonical-aware floor (not the only success metric) */
  minCanonical: number;
  minTotal: number;
  minPerCategory: Partial<Record<PoolCategory, number>>;
  minPerTemporal: Record<TemporalSlot, number>;
  minPerIntent: Partial<Record<TravelIntent, number>>;
  minGeoClusters: number;
  maxExperienceFamilyShare: number;
  maxGeoClusterShare: number;
};

export type CandidatePoolStats = {
  stage: CandidatePoolStageName;
  total: number;
  canonicalCount: number;
  byCategory: Partial<Record<PoolCategory, number>>;
  byTemporal: Partial<Record<TemporalSlot, number>>;
  byIntent: Partial<Record<TravelIntent, number>>;
  byExperience: Partial<Record<ExperienceFamily, number>>;
  geoClusters: number;
  rejectedByQuality: number;
};

export type CandidatePoolResult = {
  places: PlaceResult[];
  annotated: AnnotatedPoolPlace[];
  clusters: PoolGeoCluster[];
  demand: CandidatePoolDemand;
  stats: CandidatePoolStats;
  path: "candidate_pool" | "legacy";
  version: string;
};

/** Injected Places search — caller owns API client / exclude ids / locale. */
export type CandidatePoolSearchAttempt = {
  query: string;
  mode?: "text" | "nearby";
  includedTypes?: string[];
};

export type CandidatePoolSearchFn = (params: {
  attempt: CandidatePoolSearchAttempt;
  kind: PlanPlaceKind;
  lat: number;
  lng: number;
  radiusM?: number;
  phase: string;
}) => Promise<PlaceResult[]>;
