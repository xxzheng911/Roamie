/**
 * Tourist Quality Gate V2 — shared, pure, evidence-based classification.
 *
 * - No network / provider / AI access. Inputs are never mutated.
 * - rating / userRatingCount are accepted but never used as evidence.
 * - No place-specific lists: name semantics use generic word-formation patterns only.
 *
 * Dimensions:
 *   D1 (type)  marker-only Google types (historical_landmark / monument / landmark,
 *              optionally with point_of_interest / establishment) and nothing else.
 *   D2 (name)  name states an old-site marker (…跡 / …址 / Site of former …) or an
 *              information plaque / marker post (説明板 / 案内板 / 標柱 / plaque).
 *   Counter    experiential types, opening-hours data, positive "view" review signal.
 *
 * LOW_EXPERIENCE_VALUE only when D1 and D2 converge and no counter-evidence exists.
 */

export type TouristQualityTier = "VISIT_WORTHY" | "LOW_EXPERIENCE_VALUE" | "INSUFFICIENT_EVIDENCE";
export type TouristQualityIntent = "general_sightseeing" | "cultural_exploration";
export type TouristQualityProtection = "explicit" | "required" | "locked" | "selected_only";

export type TouristQualityInput = {
  name?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  /** Accepted for convenience; never affects the tier. */
  rating?: number | null;
  /** Accepted for convenience; never affects the tier. */
  userRatingCount?: number | null;
  regularOpeningHours?: unknown;
  currentOpeningHours?: unknown;
  /** Existing PlaceReviewEvidence (read-only). */
  reviewEvidence?: unknown;
};

export type TouristQualityAssessment = {
  tier: TouristQualityTier;
  /** Historical / cultural nature evidenced by Google types. */
  culturalEvidence: boolean;
  /** Evidence codes (no user data). */
  evidence: string[];
};

export type TouristQualityDecision = {
  admit: boolean;
  tier: TouristQualityTier;
  reason: string;
};

/** Rejection reason used by every integration point. */
export const TOURIST_QUALITY_REJECT_REASON = "tourist_quality_low_experience";

const GENERIC_TYPES = new Set(["point_of_interest", "establishment"]);

const MARKER_TYPES = new Set(["historical_landmark", "monument", "landmark"]);

const CULTURAL_TYPES = new Set([
  "historical_landmark",
  "monument",
  "cultural_landmark",
  "historical_place",
]);

/** Experiential type → facility group (used to detect "former facility" contradiction). */
const EXPERIENTIAL_TYPE_GROUP: Record<string, string> = {
  museum: "museum",
  art_gallery: "gallery",
  art_museum: "museum",
  history_museum: "museum",
  park: "park",
  national_park: "park",
  state_park: "park",
  city_park: "park",
  garden: "park",
  botanical_garden: "park",
  tourist_attraction: "attraction",
  place_of_worship: "worship",
  church: "worship",
  hindu_temple: "worship",
  buddhist_temple: "worship",
  shinto_shrine: "worship",
  mosque: "worship",
  synagogue: "worship",
  castle: "castle",
  zoo: "zoo",
  aquarium: "aquarium",
  observation_deck: "observation",
  visitor_center: "visitor_center",
  cultural_center: "cultural_center",
  historical_place: "historical_place",
  amusement_park: "amusement",
  performing_arts_theater: "theater",
};

/** Generic facility words per group (word-formation only; no proper nouns). */
const FACILITY_NAME_RE: Record<string, RegExp> = {
  museum: /博物館|美術館|資料館|記念館|紀念館|文学館|文學館|museum/i,
  gallery: /美術館|画廊|畫廊|ギャラリー|gallery/i,
  park: /公園|庭園|園地|植物園|park|garden/i,
  worship: /寺|院|神社|社|宮|堂|廟|教会|教會|church|temple|shrine|mosque|synagogue/i,
  castle: /城|castle/i,
  zoo: /動物園|zoo/i,
  aquarium: /水族館|aquarium/i,
  observation: /展望|observation/i,
  visitor_center: /案内所|センター|中心|visitor/i,
  cultural_center: /会館|會館|センター|中心|center|centre/i,
  historical_place: /邸|館|屋敷|house|residence/i,
  amusement: /遊園地|樂園|楽園|amusement/i,
  theater: /劇場|劇院|ホール|theater|theatre|hall/i,
};

/**
 * D2: old-site marker (the facility itself no longer stands).
 * A name ending in 「史跡」 denotes a designated historic site, not an old-site
 * marker, so 「跡」 preceded by 「史」 is excluded.
 */
const OLD_SITE_NAME_RE =
  /(?:(?<!史)跡|跡地|址|遺址|旧址|舊址)$|site\s+of\s+(?:the\s+)?former|former\s+site\s+of|^(?:the\s+)?ruins?\s+of|^remains\s+of/i;

/** D2: information plaque / marker post. */
const PLAQUE_NAME_RE =
  /説明板|說明板|案内板|案內板|解説板|解說板|説明碑|標柱|標示柱|plaque|historical?\s+marker|information\s+board|signpost/i;

function normalizedTypes(input: TouristQualityInput): string[] {
  const out = new Set<string>();
  const add = (t: unknown) => {
    if (typeof t !== "string") return;
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  };
  add(input.primaryType);
  for (const t of input.types ?? []) add(t);
  return [...out].sort();
}

function hasHoursData(hours: unknown): boolean {
  if (!hours || typeof hours !== "object") return false;
  const h = hours as { periods?: unknown; weekdayDescriptions?: unknown };
  return (
    (Array.isArray(h.periods) && h.periods.length > 0) ||
    (Array.isArray(h.weekdayDescriptions) && h.weekdayDescriptions.length > 0)
  );
}

function hasPositiveExperienceReview(reviewEvidence: unknown): boolean {
  if (!reviewEvidence || typeof reviewEvidence !== "object") return false;
  const signals = (reviewEvidence as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) return false;
  return signals.some((s) => {
    if (!s || typeof s !== "object") return false;
    const sig = s as { topic?: unknown; sentiment?: unknown };
    return sig.topic === "view" && sig.sentiment === "positive";
  });
}

export function classifyTouristQuality(input: TouristQualityInput): TouristQualityAssessment {
  const name = (typeof input.name === "string" ? input.name : "").trim();
  const types = normalizedTypes(input);
  const nonGeneric = types.filter((t) => !GENERIC_TYPES.has(t));
  const experiential = nonGeneric.filter((t) => t in EXPERIENTIAL_TYPE_GROUP);
  const markerTypes = nonGeneric.filter((t) => MARKER_TYPES.has(t));
  const culturalEvidence = types.some((t) => CULTURAL_TYPES.has(t));

  const d1 = markerTypes.length > 0 && nonGeneric.every((t) => MARKER_TYPES.has(t));
  const oldSiteName = name ? OLD_SITE_NAME_RE.test(name) : false;
  const plaqueName = name ? PLAQUE_NAME_RE.test(name) : false;
  const d2 = oldSiteName || plaqueName;

  const hours = hasHoursData(input.regularOpeningHours) || hasHoursData(input.currentOpeningHours);
  const reviewView = hasPositiveExperienceReview(input.reviewEvidence);

  const evidence: string[] = [];
  if (d1) evidence.push("type:marker_only");
  if (oldSiteName) evidence.push("name:former_site_marker");
  if (plaqueName) evidence.push("name:information_plaque");
  if (culturalEvidence) evidence.push("type:cultural");
  if (experiential.length > 0) evidence.push("counter:experiential_type");
  if (hours) evidence.push("counter:opening_hours");
  if (reviewView) evidence.push("counter:review_view");

  const hasCounter = experiential.length > 0 || hours || reviewView;

  if (d1 && d2 && !hasCounter) {
    return { tier: "LOW_EXPERIENCE_VALUE", culturalEvidence, evidence };
  }

  if (experiential.length > 0) {
    // Contrary evidence: the name says the facility no longer exists and the type is exactly
    // that facility, with no opening-hours data. Other experiential types still count.
    const uncontradicted =
      oldSiteName && !hours
        ? experiential.filter((t) => {
            const re = FACILITY_NAME_RE[EXPERIENTIAL_TYPE_GROUP[t]!];
            return !re || !re.test(name);
          })
        : experiential;
    if (uncontradicted.length > 0) {
      return { tier: "VISIT_WORTHY", culturalEvidence, evidence };
    }
    evidence.push("contra:former_facility_name");
    return { tier: "INSUFFICIENT_EVIDENCE", culturalEvidence, evidence };
  }

  // Marker / cultural types with opening-hours or experience reviews, and no old-site name.
  if ((hours || reviewView) && (markerTypes.length > 0 || culturalEvidence) && !d2) {
    return { tier: "VISIT_WORTHY", culturalEvidence, evidence };
  }

  return { tier: "INSUFFICIENT_EVIDENCE", culturalEvidence, evidence };
}

export function touristQualityDecision(
  input: TouristQualityInput,
  ctx: { intent: TouristQualityIntent; protection?: TouristQualityProtection | null },
): TouristQualityDecision {
  const { tier, culturalEvidence } = classifyTouristQuality(input);
  if (ctx.protection) {
    return { admit: true, tier, reason: `tourist_quality_protected:${ctx.protection}` };
  }
  if (tier !== "LOW_EXPERIENCE_VALUE") {
    return { admit: true, tier, reason: `tourist_quality_admit:${tier.toLowerCase()}` };
  }
  if (ctx.intent === "cultural_exploration" && culturalEvidence) {
    return { admit: true, tier, reason: "tourist_quality_cultural_evidence" };
  }
  return { admit: false, tier, reason: TOURIST_QUALITY_REJECT_REASON };
}
