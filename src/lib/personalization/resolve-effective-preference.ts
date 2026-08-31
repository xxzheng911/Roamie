import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import {
  PLUS_PERSONALIZATION_CONTRACT_VERSION,
  createEmptySessionPreference,
  type EffectivePreference,
  type PersonalizationContextV1,
  type PersonalizationSurface,
  type PreferenceLayer,
  type PreferenceSource,
  type SessionPreferenceV1,
  type PersonalizationSnapshotV1,
} from "./types";

function populated(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}

export function buildPersonalizationSnapshotV1(
  context: PersonalizationContextV1,
  orderedPlaceIds: string[],
): PersonalizationSnapshotV1 {
  return {
    contractVersion: context.contractVersion,
    profileTier: context.profileTier,
    profileOnboarded: context.profileOnboarded,
    profileVersion: context.profileVersion,
    effectivePreference: context.resolvedPreference,
    sessionPreferenceVersion: context.sessionPreferenceVersion,
    scoringWeightsId: `${context.surface}-v1`,
    orderedPlaceIds: [...orderedPlaceIds],
  };
}

export function personalizationSnapshotInvalidationReason(
  snapshot: PersonalizationSnapshotV1,
  current: Pick<PersonalizationContextV1, "contractVersion" | "profileTier" | "profileOnboarded" | "profileVersion" | "sessionPreferenceVersion">,
): "contract_changed" | "tier_changed" | "onboarding_changed" | "profile_changed" | "session_preference_changed" | null {
  if (snapshot.contractVersion !== current.contractVersion) return "contract_changed";
  if (snapshot.profileTier !== current.profileTier) return "tier_changed";
  if (snapshot.profileOnboarded !== current.profileOnboarded) return "onboarding_changed";
  if ((snapshot.profileVersion ?? "") !== (current.profileVersion ?? "")) return "profile_changed";
  if (snapshot.sessionPreferenceVersion !== current.sessionPreferenceVersion) return "session_preference_changed";
  return null;
}

export function resolveEffectivePreference(input: {
  explicitCurrentRequest?: PreferenceLayer;
  sessionPreference?: PreferenceLayer;
  plusProfile?: PreferenceLayer | null;
  defaults?: PreferenceLayer;
}): EffectivePreference {
  const layers: Array<[PreferenceSource, PreferenceLayer]> = [
    ["explicit", input.explicitCurrentRequest ?? {}],
    ["session", input.sessionPreference ?? {}],
    ["plus_profile", input.plusProfile ?? {}],
    ["default", input.defaults ?? {}],
  ];
  const resolved: PreferenceLayer = {};
  const sources: EffectivePreference["sources"] = {};
  const keys = new Set(layers.flatMap(([, layer]) => Object.keys(layer) as Array<keyof PreferenceLayer>));
  for (const key of keys) {
    for (const [source, layer] of layers) {
      const value = layer[key];
      if (!populated(value)) continue;
      (resolved as Record<string, unknown>)[key] = value;
      sources[key] = source;
      break;
    }
  }
  return { ...resolved, sources };
}

export function sessionPreferenceLayer(session?: SessionPreferenceV1 | null): PreferenceLayer {
  const safe = session ?? createEmptySessionPreference();
  return {
    pace: safe.temporaryPace,
    vibe: safe.temporaryVibe,
    mood: safe.temporaryMood,
    categoryInclude: safe.categoryInclude,
    categoryExclude: safe.categoryExclude,
    avoidHighPopularity: safe.avoidHighPopularity,
    walkability: safe.walkability,
    maxDistanceMeters: safe.maxDistanceMeters,
    preferredKeywords: safe.preferredKeywords,
    excludedKeywords: safe.excludedKeywords,
  };
}

export function profilePreferenceLayer(profile?: UserProfileForReason | null): PreferenceLayer | null {
  if (profile?.profileTier !== "plus" || profile.onboarded !== true) return null;
  return {
    interests: profile.interests,
    pace: profile.pace,
    vibe: profile.vibe,
    avoid: profile.avoid,
    travelStyle: profile.travelStyle,
    budgetMode: profile.budgetMode,
  };
}

export function buildPersonalizationContextV1(input: {
  surface: PersonalizationSurface;
  profile?: UserProfileForReason | null;
  explicitCurrentRequest?: PreferenceLayer;
  sessionPreference?: SessionPreferenceV1 | null;
  defaults?: PreferenceLayer;
  profileVersion?: string;
  profileOwnerMatches?: boolean;
}): PersonalizationContextV1 {
  const profileTier = input.profile?.profileTier ?? "free";
  const profileOnboarded = profileTier === "plus" && input.profile?.onboarded === true;
  const plusProfile = input.profileOwnerMatches === false ? null : profilePreferenceLayer(input.profile);
  const sessionLayer = sessionPreferenceLayer(input.sessionPreference);
  const explicit = input.explicitCurrentRequest ?? {};
  const defaults = input.defaults ?? {};
  return {
    contractVersion: PLUS_PERSONALIZATION_CONTRACT_VERSION,
    surface: input.surface,
    profileTier,
    profileOnboarded,
    profileVersion: input.profileVersion,
    profileOwnerMatches: input.profileOwnerMatches !== false,
    explicitCurrentRequest: explicit,
    sessionPreference: sessionLayer,
    plusProfile,
    defaults,
    resolvedPreference: resolveEffectivePreference({
      explicitCurrentRequest: explicit,
      sessionPreference: sessionLayer,
      plusProfile,
      defaults,
    }),
    rawProfile: input.profile,
    sessionPreferenceVersion: input.sessionPreference?.revision ?? 0,
  };
}

export function updateSessionPreferenceFromExplicitText(
  previous: SessionPreferenceV1 | null | undefined,
  text: string,
  sourceTurnId: string,
  now = new Date().toISOString(),
): SessionPreferenceV1 {
  const next = { ...(previous ?? createEmptySessionPreference()) };
  next.categoryInclude = [...next.categoryInclude];
  next.categoryExclude = [...next.categoryExclude];
  next.preferredKeywords = [...next.preferredKeywords];
  next.excludedKeywords = [...next.excludedKeywords];
  next.provenance = [...next.provenance];
  const touched: string[] = [];
  const addUnique = (key: "categoryInclude" | "categoryExclude", value: string) => {
    if (!next[key].includes(value)) next[key].push(value);
    touched.push(key);
  };
  if (/不要(?:去)?酒吧|不想(?:去)?酒吧/.test(text)) addUnique("categoryExclude", "bar");
  if (/不要(?:去)?咖啡|先不要咖啡|不想(?:去)?咖啡/.test(text)) addUnique("categoryExclude", "cafe");
  if (/不要太熱門|不要熱門|低調一點/.test(text)) {
    next.avoidHighPopularity = true;
    touched.push("avoidHighPopularity");
  }
  if (/走路就能到|步行就能到|想用走的/.test(text)) {
    next.walkability = /一定|必須|只能/.test(text) ? "required" : "preferred";
    touched.push("walkability");
  }
  if (/今天想放鬆|慢慢走|不想趕/.test(text)) {
    next.temporaryPace = "slow";
    next.temporaryMood = "放鬆";
    touched.push("temporaryPace", "temporaryMood");
  }
  if (/熱鬧一點|想熱鬧|有生活感/.test(text)) {
    next.temporaryVibe = "lively";
    touched.push("temporaryVibe");
  } else if (/安靜一點|想安靜/.test(text)) {
    next.temporaryVibe = "quiet";
    touched.push("temporaryVibe");
  }
  if (touched.length > 0) {
    next.revision = (next.revision ?? 0) + 1;
    next.provenance.push(...[...new Set(touched)].map((field) => ({ field, sourceTurnId, source: "explicit_user" as const, createdAt: now })));
  }
  return next;
}
