import { resolvePlaceIdentity } from "@/lib/place-identity";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import {
  BUDGET_IDENTITY_MAPPINGS,
  CROWD_RISK_IDENTITIES,
  PACE_IDENTITY_MAPPINGS,
  TRAVEL_STYLE_IDENTITY_MAPPINGS,
  VIBE_IDENTITY_MAPPINGS,
  identityMatchesTags,
  normalizePreferenceTag,
} from "./identity-mappings";
import type {
  PersonalizationContextV1,
  PersonalizationScoreV1,
  PersonalizationSurface,
} from "./types";

export type PersonalizationCandidate = {
  id?: string | null;
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  userRatingCount?: number | null;
  distanceMeters?: number | null;
};

export const SURFACE_PERSONALIZATION_WEIGHTS: Record<PersonalizationSurface, {
  id: string;
  interest: number;
  pace: number;
  vibe: number;
  travelStyle: number;
  budget: number;
  explicit: number;
  session: number;
  avoid: number;
  clamp: number;
}> = {
  homeNearby: { id: "home-v1", interest: 1, pace: 1, vibe: 1, travelStyle: .7, budget: .7, explicit: 1.2, session: 1.1, avoid: 1, clamp: 40 },
  chatNearby: { id: "chat-v1", interest: 1, pace: 1, vibe: 1, travelStyle: .7, budget: .7, explicit: 1.3, session: 1.2, avoid: 1, clamp: 40 },
  destination: { id: "destination-v1", interest: 1, pace: .8, vibe: .8, travelStyle: .8, budget: .7, explicit: 1.3, session: 1.2, avoid: 1, clamp: 36 },
  explore: { id: "explore-v1", interest: 1, pace: .8, vibe: .8, travelStyle: .8, budget: .6, explicit: 1.2, session: 1.1, avoid: 1, clamp: 36 },
  planner: { id: "planner-v1", interest: 1, pace: 1, vibe: .8, travelStyle: 1, budget: .5, explicit: 1.3, session: 1.2, avoid: 1, clamp: 30 },
};

function includesIdentity(values: readonly string[] | undefined, identity: string): boolean {
  return (values ?? []).some((value) => {
    const tag = normalizePreferenceTag(value);
    return tag ? TRAVEL_STYLE_IDENTITY_MAPPINGS[tag].includes(identity as never) : value.toLowerCase() === identity;
  });
}

export function scorePersonalization(
  candidate: PersonalizationCandidate,
  context: PersonalizationContextV1,
  options?: { baseEligible?: boolean; baseScore?: number; qualityBand?: string; rankBefore?: number; rankAfter?: number; log?: boolean },
): PersonalizationScoreV1 {
  const identity = resolvePlaceIdentity({
    name: candidate.name ?? "",
    address: candidate.address ?? null,
    primaryType: candidate.primaryType ?? null,
    types: candidate.types,
  });
  const pref = context.resolvedPreference;
  const usedFields: string[] = [];
  const matchedMappings: string[] = [];
  const rejectedSignals: string[] = [];
  const sourceFor = (field: keyof typeof pref) => pref.sources[field as keyof typeof pref.sources];

  let interestFitScore = 0;
  const interest = identityMatchesTags(pref.interests, identity);
  const excludedByCategory = includesIdentity(pref.categoryExclude, identity);
  if (interest.matched && !excludedByCategory) {
    interestFitScore = 10;
    usedFields.push("interests");
    matchedMappings.push(...interest.mappings);
  } else if (interest.matched) rejectedSignals.push("interests:session_category_excluded");

  let paceFitScore = 0;
  if (pref.pace === "slow" || pref.pace === "active") {
    if (PACE_IDENTITY_MAPPINGS[pref.pace].includes(identity)) {
      paceFitScore = 10;
      usedFields.push("pace");
      matchedMappings.push(`pace:${pref.pace}`);
    }
  }

  let vibeFitScore = 0;
  if (pref.vibe === "quiet" || pref.vibe === "lively") {
    if (VIBE_IDENTITY_MAPPINGS[pref.vibe].includes(identity)) {
      vibeFitScore = 10;
      usedFields.push("vibe");
      matchedMappings.push(`vibe:${pref.vibe}`);
    }
  }

  let travelStyleFitScore = 0;
  if (pref.travelStyle) {
    const tag = normalizePreferenceTag(pref.travelStyle);
    if (tag && TRAVEL_STYLE_IDENTITY_MAPPINGS[tag].includes(identity)) {
      travelStyleFitScore = 8;
      usedFields.push("travelStyle");
      matchedMappings.push(`travelStyle:${tag}`);
    }
  }

  let budgetFitScore = 0;
  if (pref.budgetMode && BUDGET_IDENTITY_MAPPINGS[pref.budgetMode]?.includes(identity)) {
    budgetFitScore = 6;
    usedFields.push("budgetMode");
    matchedMappings.push(`budget:${pref.budgetMode}`);
  }

  let avoidPenalty = 0;
  const avoidsCrowds = (pref.avoid ?? []).some((value) => /crowd|人潮|擠|吵/.test(value));
  if ((avoidsCrowds || pref.avoidHighPopularity) && CROWD_RISK_IDENTITIES.includes(identity)) {
    avoidPenalty += 12;
    usedFields.push(avoidsCrowds ? "avoid" : "avoidHighPopularity");
    matchedMappings.push("avoid:crowd_risk_category");
  }
  if ((avoidsCrowds || pref.avoidHighPopularity) && (candidate.userRatingCount ?? 0) > 800) {
    avoidPenalty += 4;
    matchedMappings.push("avoid:high_popularity");
  }

  const explicitFields = usedFields.filter((field) => sourceFor(field as never) === "explicit");
  const sessionFields = usedFields.filter((field) => sourceFor(field as never) === "session");
  const explicitPreferenceScore = explicitFields.length * 4;
  const sessionPreferenceScore = sessionFields.length * 3;
  const weights = SURFACE_PERSONALIZATION_WEIGHTS[context.surface];
  const raw =
    interestFitScore * weights.interest + paceFitScore * weights.pace + vibeFitScore * weights.vibe +
    travelStyleFitScore * weights.travelStyle + budgetFitScore * weights.budget +
    explicitPreferenceScore * weights.explicit + sessionPreferenceScore * weights.session -
    avoidPenalty * weights.avoid;
  const totalPersonalizationScore = Math.max(-weights.clamp, Math.min(weights.clamp, raw));
  const result = {
    interestFitScore, paceFitScore, vibeFitScore, travelStyleFitScore, budgetFitScore,
    explicitPreferenceScore, sessionPreferenceScore, avoidPenalty, totalPersonalizationScore,
    usedFields: [...new Set(usedFields)], matchedMappings: [...new Set(matchedMappings)], rejectedSignals,
  };
  if (options?.log) {
    devVerboseInfo("[PLUS_PERSONALIZATION_SCORE]", {
      placeId: candidate.id ?? "", surface: context.surface, contractVersion: context.contractVersion,
      profileTier: context.profileTier, profileOnboarded: context.profileOnboarded,
      profileVersion: context.profileVersion ?? "", baseEligible: options.baseEligible !== false,
      qualityBand: options.qualityBand ?? "eligible", baseScore: options.baseScore ?? 0,
      ...result, finalScore: (options.baseScore ?? 0) + result.totalPersonalizationScore,
      rankBefore: options.rankBefore ?? -1, rankAfter: options.rankAfter ?? -1,
      usedProfileFields: result.usedFields.filter((field) => sourceFor(field as never) === "plus_profile"),
      effectivePreferenceSource: pref.sources,
    });
  }
  return result;
}
