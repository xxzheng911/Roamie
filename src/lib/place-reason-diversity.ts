/** Compatibility batch adapter. Prose always comes from the canonical per-Place authority. */
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import {
  buildPlaceRecommendationReason,
  hasCompletedTravelQuiz,
  isGroundedPreferenceEvidenceSource,
  resolveIdentityForReason,
  type PlaceRecommendationContext,
  type UserProfileForReason,
} from "@/lib/build-place-recommendation-reason";
import { type PlaceIdentity } from "@/lib/place-identity";
import { buildPersonalizationContextV1 } from "@/lib/personalization/resolve-effective-preference";
import { scorePersonalization } from "@/lib/personalization/score";

export const PLACE_REASON_EVIDENCE_CODES = [
  "review_consensus",
  "high_rating",
  "high_review_count",
  "popularity",
  "open_now",
  "late_hours",
  "nearby",
  "weather_fit",
  "preference_fit",
  "preference_fit_interest",
  "preference_fit_pace",
  "preference_fit_vibe",
  "preference_fit_travel_style",
  "preference_fit_personality",
  "preference_fit_ai_preference",
  "route_fit",
  "coffee_quiet_ambience",
  "coffee_seating_dwell",
  "category_match",
  "grounded_neutral",
] as const;

export type PlaceReasonEvidenceCode = (typeof PLACE_REASON_EVIDENCE_CODES)[number];

/** Claims we must not invent without a formal data source. */
export const FORBIDDEN_REASON_INFERENCES = [
  "安靜",
  "插座",
  "甜點招牌",
  "景觀",
  "適合工作",
  "人潮",
  "適合放鬆",
  "適合下午",
  "值得一試",
] as const;

export type PlaceReasonEvidenceContext = PlaceRecommendationContext & {
  /** True only when an itinerary/route signal is actually present. */
  alongRoute?: boolean;
};

export type PlaceReasonDiversityItem = {
  place: PlaceResult;
  context?: PlaceReasonEvidenceContext;
};

export type PlaceReasonDiversityShared = {
  userProfile?: UserProfileForReason | null;
  weather?: WeatherSummary | null;
  currentTime?: Date | string;
  locale?: Locale;
};

export type PlaceReasonEvidence = {
  code: PlaceReasonEvidenceCode;
  score: number;
  preferenceField?: string;
  mappingContract?: string;
};

export type AssignedPlaceReason = {
  placeId: string;
  evidenceCode: PlaceReasonEvidenceCode;
  reason: string;
  availableCodes: PlaceReasonEvidenceCode[];
};

const NEARBY_MAX_M = 800;
const HIGH_RATING_MIN = 4.3;
const HIGH_REVIEW_COUNT_MIN = 80;
const LATE_CLOSE_MINUTES = 21 * 60;

const INDOOR_IDENTITIES: PlaceIdentity[] = [
  "museum",
  "department_store",
  "shopping_mall",
  "bookstore",
  "cafe",
  "bakery",
  "dessert",
  "restaurant",
];

const OUTDOOR_IDENTITIES: PlaceIdentity[] = ["park", "tourist_attraction"];

const SLOW_PACE_IDENTITIES: PlaceIdentity[] = [
  "cafe",
  "bookstore",
  "park",
  "museum",
  "district",
  "tourist_attraction",
];
const QUIET_VIBE_IDENTITIES: PlaceIdentity[] = ["bookstore", "park", "museum", "cafe"];

function resolveDate(currentTime?: Date | string): Date {
  if (currentTime instanceof Date) return currentTime;
  if (typeof currentTime === "string") return new Date(currentTime);
  return new Date();
}

function parseHhMm(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 47 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function parseCloseMinutes(place: PlaceResult, at: Date): number | null {
  try {
    const until = place.openUntilTime?.trim();
    if (until) {
      const parsed = parseHhMm(until);
      if (parsed != null) return parsed;
    }

    const label = place.todayHoursLabel ?? "";
    if (/全天|24\s*小時|open\s*24/i.test(label)) return 24 * 60;

    const range = label.match(/(\d{1,2}):(\d{2})\s*[-–—~～至到]\s*(\d{1,2}):(\d{2})/);
    if (range) {
      return Number(range[3]) * 60 + Number(range[4]);
    }

    const periods = place.regularOpeningHours?.periods;
    if (!periods?.length) return null;
    const day = at.getDay();
    const today = periods.find((p) => p.open?.day === day);
    const close = today?.close;
    if (close?.hour == null) return null;
    return close.hour * 60 + (close.minute ?? 0);
  } catch {
    return null;
  }
}

function isLateClose(closeMinutes: number): boolean {
  if (closeMinutes >= 24 * 60) return true;
  if (closeMinutes < 5 * 60) return true;
  return closeMinutes >= LATE_CLOSE_MINUTES;
}

function isActuallyOpen(place: PlaceResult): boolean {
  if (place.openStatus === "closing_soon") return false;
  if (place.openStatus === "closed" || place.openStatus === "closed_now") return false;
  if (place.openStatus === "open") return true;
  return place.openNow === true;
}

function isIndoorIdentity(identity: PlaceIdentity): boolean {
  return INDOOR_IDENTITIES.includes(identity);
}

function weatherConditionKey(weather?: WeatherSummary | null): string {
  return typeof weather?.condition === "string" ? weather.condition.trim().toLowerCase() : "";
}

function weatherFitKind(
  weather: WeatherSummary | null | undefined,
  identity: PlaceIdentity,
): "rain_indoor" | "hot_indoor" | "cold_indoor" | "outdoor" | "evening" | null {
  if (!weather || weather.available === false) return null;
  const indoor = isIndoorIdentity(identity);
  const outdoor = OUTDOOR_IDENTITIES.includes(identity);
  const cond = weatherConditionKey(weather);
  const precip = weather.precipProbability ?? 0;
  const rainy = precip >= 50 || cond.includes("雨") || cond.includes("rain");
  if (rainy && indoor) return "rain_indoor";
  if (weather.tempC != null && weather.tempC >= 32 && indoor) return "hot_indoor";
  if (weather.tempC != null && weather.tempC <= 14 && indoor) return "cold_indoor";
  if (weather.recommendation === "outdoor" && outdoor) return "outdoor";
  if (
    weather.recommendation === "evening" &&
    (identity === "night_market" || identity === "bar" || identity === "district")
  ) {
    return "evening";
  }
  return null;
}

function interestMatchesIdentity(interest: string, identity: PlaceIdentity): boolean {
  const key = interest.toLowerCase();
  if (/咖啡|cafe|café|coffee/.test(key)) return identity === "cafe" || identity === "bakery";
  if (/美食|餐|food|restaurant/.test(key)) {
    return [
      "restaurant",
      "food_stall",
      "cafe",
      "bakery",
      "dessert",
      "breakfast_shop",
      "night_market",
    ].includes(identity);
  }
  if (/逛|購物|shop/.test(key)) {
    return ["department_store", "shopping_mall", "district", "night_market"].includes(identity);
  }
  if (/自然|公園|海|山|戶外|park|nature/.test(key)) {
    return identity === "park" || identity === "tourist_attraction";
  }
  if (/文化|藝術|展覽|博物館|書|museum|culture/.test(key)) {
    return ["museum", "bookstore", "tourist_attraction", "district"].includes(identity);
  }
  if (/景點|attraction|sight/.test(key)) {
    return identity === "tourist_attraction" || identity === "museum" || identity === "park";
  }
  return false;
}

function profileEvidenceAllowed(profile: UserProfileForReason | null | undefined): boolean {
  return (
    profile?.profileTier === "plus" &&
    Boolean(
      profile.pace ||
      profile.vibe ||
      profile.budgetMode ||
      profile.travelStyle ||
      profile.personalityType ||
      profile.personalitySummary ||
      profile.interests?.length ||
      profile.avoid?.length,
    )
  );
}

function textPreferenceMatchesIdentity(
  value: string | undefined,
  identity: PlaceIdentity,
): boolean {
  if (!value?.trim()) return false;
  return interestMatchesIdentity(value, identity);
}

function collectPreferenceEvidence(
  identity: PlaceIdentity,
  profile: UserProfileForReason | null | undefined,
  ctx: PlaceReasonEvidenceContext,
): PlaceReasonEvidence[] {
  const result: PlaceReasonEvidence[] = [];
  const mood = (ctx.mood ?? "").trim();
  if (mood && isGroundedPreferenceEvidenceSource(ctx.preferenceEvidenceSource)) {
    result.push({
      code: "preference_fit",
      score: 300,
      preferenceField: "mood",
      mappingContract: "grounded_mood",
    });
  }
  if (!profileEvidenceAllowed(profile) || !profile) return result;
  const unifiedContext = buildPersonalizationContextV1({ surface: "destination", profile });
  const unified = scorePersonalization(
    { primaryType: identity, types: [identity] },
    unifiedContext,
  );
  if (unified.interestFitScore > 0) {
    result.push({
      code: "preference_fit_interest",
      score: 306,
      preferenceField: "interests",
      mappingContract: "interest_identity_v1",
    });
  }
  if (unified.paceFitScore > 0) {
    result.push({
      code: "preference_fit_pace",
      score: 305,
      preferenceField: "pace",
      mappingContract: "slow_pace_identity_v1",
    });
  }
  if (unified.vibeFitScore > 0 && profile.vibe === "quiet") {
    result.push({
      code: "preference_fit_vibe",
      score: 304,
      preferenceField: "vibe",
      mappingContract: "quiet_vibe_identity_v1",
    });
  }
  if (unified.travelStyleFitScore > 0) {
    result.push({
      code: "preference_fit_travel_style",
      score: 303,
      preferenceField: "travelStyle",
      mappingContract: "travel_style_identity_v1",
    });
  }
  if (
    textPreferenceMatchesIdentity(
      `${profile.personalityType ?? ""} ${profile.personalitySummary ?? ""}`,
      identity,
    )
  ) {
    result.push({
      code: "preference_fit_personality",
      score: 302,
      preferenceField: "personality",
      mappingContract: "personality_identity_v1",
    });
  }
  if (textPreferenceMatchesIdentity(JSON.stringify(profile.aiPreferences ?? {}), identity)) {
    result.push({
      code: "preference_fit_ai_preference",
      score: 301,
      preferenceField: "aiPreferences",
      mappingContract: "ai_preference_identity_v1",
    });
  }
  return result;
}

function hasCategoryMatch(identity: PlaceIdentity, ctx: PlaceReasonEvidenceContext): boolean {
  const intent = (ctx.categoryIntent ?? "").trim().toLowerCase();
  if (!intent) return false;
  if (intent === "cafe") return ["cafe", "bakery", "dessert"].includes(identity);
  if (intent === "restaurant") {
    return ["restaurant", "food_stall", "breakfast_shop"].includes(identity);
  }
  if (intent === "shopping") {
    return ["shopping_mall", "department_store", "district", "night_market", "bookstore"].includes(
      identity,
    );
  }
  if (intent === "night_market") return identity === "night_market";
  if (intent === "bar") return identity === "bar";
  if (intent === "attraction" || intent === "scenic" || intent === "indoor") {
    return ["tourist_attraction", "museum", "park"].includes(identity);
  }
  return false;
}

export function collectPlaceReasonEvidence(
  place: PlaceResult,
  ctx: PlaceReasonEvidenceContext = {},
  shared: PlaceReasonDiversityShared = {},
): PlaceReasonEvidence[] {
  const identity = resolveIdentityForReason(place, ctx);
  const at = resolveDate(shared.currentTime);
  const evidence: PlaceReasonEvidence[] = [];

  if (place.rating != null && place.rating >= HIGH_RATING_MIN) {
    evidence.push({
      code: "high_rating",
      score: 500 + (place.rating - 4) * 30,
    });
  }

  if (place.userRatingCount != null && place.userRatingCount >= HIGH_REVIEW_COUNT_MIN) {
    evidence.push({
      code: "high_review_count",
      score: 600 + Math.min(40, Math.log10(place.userRatingCount) * 10),
    });
  }

  if (
    place.rating != null &&
    place.rating >= HIGH_RATING_MIN &&
    place.userRatingCount != null &&
    place.userRatingCount >= HIGH_REVIEW_COUNT_MIN
  ) {
    evidence.push({
      code: "popularity",
      score: 650 + Math.min(40, Math.log10(place.userRatingCount) * 10),
    });
  }

  const closingSoon = Boolean(place.closingSoonNote?.trim()) || place.openStatus === "closing_soon";
  if (!closingSoon && isActuallyOpen(place)) {
    evidence.push({ code: "open_now", score: 100 });
  }

  if (!closingSoon) {
    const closeMinutes = parseCloseMinutes(place, at);
    if (closeMinutes != null && isLateClose(closeMinutes)) {
      evidence.push({
        code: "late_hours",
        score: 800 + (closeMinutes >= 22 * 60 || closeMinutes < 5 * 60 ? 20 : 0),
      });
    }
  }

  const distance = ctx.distanceMeters;
  const userProximity = ctx.distanceSource === "USER_LOCATION";
  if (userProximity && distance != null && distance >= 0 && distance < NEARBY_MAX_M) {
    evidence.push({
      code: "nearby",
      score: 700 + Math.max(0, (NEARBY_MAX_M - distance) / 10),
    });
  } else if (ctx.alongRoute === true) {
    evidence.push({
      code: "route_fit",
      score: 230,
    });
  }

  if (weatherFitKind(shared.weather, identity)) {
    evidence.push({ code: "weather_fit", score: 400 });
  }

  evidence.push(...collectPreferenceEvidence(identity, shared.userProfile, ctx));

  if (hasCategoryMatch(identity, ctx)) {
    evidence.push({ code: "category_match", score: 200 });
  }

  evidence.push({
    code: "grounded_neutral",
    score: identity === "generic" || identity === "unsupported" ? 5 : 10,
  });

  return evidence.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
}

export function assignDiversePlaceReasons(
  items: PlaceReasonDiversityItem[],
  shared: PlaceReasonDiversityShared = {},
): AssignedPlaceReason[] {
  // Batch diversity may rank places, but must never change a Place's factual core reason.
  return items.map(({ place, context }) => ({
    placeId: place.id,
    evidenceCode: place.reviewEvidence?.signals.some((s) => s.sentiment === "positive")
      ? ("review_consensus" as const)
      : ("grounded_neutral" as const),
    reason: buildPlaceRecommendationReason(
      place,
      shared.userProfile,
      shared.weather,
      shared.currentTime,
      context,
      shared.locale,
    ),
    availableCodes: collectPlaceReasonEvidence(place, context, shared).map((e) => e.code),
  }));
}

function fallbackReasons(
  items: PlaceReasonDiversityItem[],
  shared: PlaceReasonDiversityShared,
): string[] {
  return items.map(({ place, context }) =>
    buildPlaceRecommendationReason(
      place,
      shared.userProfile ?? null,
      shared.weather,
      shared.currentTime,
      context,
      shared.locale,
    ),
  );
}

/**
 * Recommendation-card reason builder. Every non-empty batch uses the same
 * evidence selector; single cards must not bypass factual evidence priority.
 */
export function buildDiversePlaceRecommendationReasons(
  items: PlaceReasonDiversityItem[],
  shared: PlaceReasonDiversityShared = {},
): string[] {
  if (items.length === 0) return [];
  try {
    const assigned = assignDiversePlaceReasons(items, shared);
    if (assigned.length !== items.length) return fallbackReasons(items, shared);
    return assigned.map((row, index) => {
      const reason = row.reason?.trim();
      if (!reason) {
        return buildPlaceRecommendationReason(
          items[index]!.place,
          shared.userProfile ?? null,
          shared.weather,
          shared.currentTime,
          items[index]!.context,
          shared.locale,
        );
      }
      return reason;
    });
  } catch {
    return fallbackReasons(items, shared);
  }
}
