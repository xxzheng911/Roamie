import { collectPlaceTypes } from "@/lib/place-identity";

export type FamilyPlaceLike = {
  name?: string | null;
  address?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
};

const EXPLICIT_FAMILY_TYPES = new Set([
  "zoo",
  "aquarium",
  "amusement_park",
  "amusement_center",
  "playground",
  "indoor_playground",
]);

const EVIDENCE_REQUIRED_TYPES = new Set([
  "museum",
  "science_museum",
  "park",
  "national_park",
  "tourist_attraction",
  "cultural_center",
  "visitor_center",
  "farm",
]);

const FAMILY_EVIDENCE_PATTERNS: Array<[string, RegExp]> = [
  ["family_or_children_name", /親子|兒童|儿童|孩童|こども|子ども|キッズ|어린이|아이|kids?|children|child|family/i],
  ["inclusive_playground_name", /共融(?:式)?(?:遊戲場|公園)|特色遊戲場/i],
  ["science_education_name", /科學館|科教館|科学館|science\s*(?:museum|center)|自然史(?:博物館)?/i],
  ["ecology_experience_name", /生態(?:教育|體驗|園區)|生态(?:教育|体验|园区)|蝴蝶園|昆蟲館|動物互動|動物體驗|petting\s*zoo/i],
  ["family_farm_name", /親子農場|休閒農場|觀光農場|ふれあい牧場|family\s*farm/i],
  ["forest_recreation_name", /森林遊樂區|森林体験|forest\s*recreation/i],
  ["interactive_experience_name", /親子體驗|兒童體驗|DIY|手作體驗|互動體驗/i],
];

export type FamilyPlaceClassification = {
  eligible: boolean;
  explicitFamilyIdentity: boolean;
  familyEvidence: string[];
  normalizedTypes: string[];
  decision: "allow_explicit_family_type" | "allow_tier2_evidence" | "reject_no_family_evidence";
};

export function classifyFamilyPlace(place: FamilyPlaceLike): FamilyPlaceClassification {
  const normalizedTypes = collectPlaceTypes(place);
  const explicitTypes = normalizedTypes.filter((type) => EXPLICIT_FAMILY_TYPES.has(type));
  if (explicitTypes.length) {
    return {
      eligible: true,
      explicitFamilyIdentity: true,
      familyEvidence: explicitTypes.map((type) => `type:${type}`),
      normalizedTypes,
      decision: "allow_explicit_family_type",
    };
  }

  const hasEvidenceRequiredType = normalizedTypes.some((type) => EVIDENCE_REQUIRED_TYPES.has(type));
  const name = place.name ?? "";
  const nameEvidence = FAMILY_EVIDENCE_PATTERNS
    .filter(([, pattern]) => pattern.test(name))
    .map(([evidence]) => evidence);
  const eligible = hasEvidenceRequiredType && nameEvidence.length > 0;
  return {
    eligible,
    explicitFamilyIdentity: false,
    familyEvidence: eligible ? nameEvidence : [],
    normalizedTypes,
    decision: eligible ? "allow_tier2_evidence" : "reject_no_family_evidence",
  };
}

export function isExplicitFamilyPlace(place: FamilyPlaceLike): boolean {
  return classifyFamilyPlace(place).explicitFamilyIdentity;
}
