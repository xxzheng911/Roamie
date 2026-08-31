import type { BudgetMode } from "@/lib/preferences-storage";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";

export const PLUS_PERSONALIZATION_CONTRACT_VERSION = "plus-personalization-v1" as const;

export type PersonalizationSurface =
  | "homeNearby"
  | "chatNearby"
  | "destination"
  | "explore"
  | "planner";

export type PreferenceSource = "explicit" | "session" | "plus_profile" | "default";

export type PreferenceLayer = {
  interests?: string[];
  pace?: "slow" | "medium" | "active";
  vibe?: "quiet" | "lively" | "either";
  avoid?: string[];
  travelStyle?: string;
  budgetMode?: BudgetMode;
  categoryInclude?: string[];
  categoryExclude?: string[];
  avoidHighPopularity?: boolean;
  walkability?: "required" | "preferred" | "neutral";
  maxDistanceMeters?: number;
  preferredKeywords?: string[];
  excludedKeywords?: string[];
  mood?: string;
};

export type SessionPreferenceProvenance = {
  field: string;
  sourceTurnId: string;
  source: "explicit_user";
  createdAt: string;
};

export type SessionPreferenceV1 = {
  version: 1;
  revision: number;
  categoryInclude: string[];
  categoryExclude: string[];
  temporaryPace?: "slow" | "medium" | "active";
  temporaryVibe?: "quiet" | "lively" | "either";
  temporaryMood?: string;
  avoidHighPopularity?: boolean;
  walkability?: "required" | "preferred" | "neutral";
  maxDistanceMeters?: number;
  preferredKeywords: string[];
  excludedKeywords: string[];
  provenance: SessionPreferenceProvenance[];
};

export type EffectivePreference = PreferenceLayer & {
  sources: Partial<Record<keyof PreferenceLayer, PreferenceSource>>;
};

export type PersonalizationContextV1 = {
  contractVersion: typeof PLUS_PERSONALIZATION_CONTRACT_VERSION;
  surface: PersonalizationSurface;
  profileTier: "free" | "plus";
  profileOnboarded: boolean;
  profileVersion?: string;
  profileOwnerMatches: boolean;
  explicitCurrentRequest: PreferenceLayer;
  sessionPreference: PreferenceLayer;
  plusProfile: PreferenceLayer | null;
  defaults: PreferenceLayer;
  resolvedPreference: EffectivePreference;
  rawProfile?: UserProfileForReason | null;
  sessionPreferenceVersion: number;
};

export type PersonalizationScoreV1 = {
  interestFitScore: number;
  paceFitScore: number;
  vibeFitScore: number;
  travelStyleFitScore: number;
  budgetFitScore: number;
  explicitPreferenceScore: number;
  sessionPreferenceScore: number;
  avoidPenalty: number;
  totalPersonalizationScore: number;
  usedFields: string[];
  matchedMappings: string[];
  rejectedSignals: string[];
};

export type PersonalizationSnapshotV1 = {
  contractVersion: typeof PLUS_PERSONALIZATION_CONTRACT_VERSION;
  profileTier: "free" | "plus";
  profileOnboarded: boolean;
  profileVersion?: string;
  effectivePreference: EffectivePreference;
  sessionPreferenceVersion: number;
  scoringWeightsId: string;
  orderedPlaceIds: string[];
};

export function createEmptySessionPreference(): SessionPreferenceV1 {
  return {
    version: 1,
    revision: 0,
    categoryInclude: [],
    categoryExclude: [],
    preferredKeywords: [],
    excludedKeywords: [],
    provenance: [],
  };
}
