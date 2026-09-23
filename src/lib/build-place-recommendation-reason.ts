import {
  buildRecommendationReasonTrace,
  emitRecommendationReasonTrace,
} from "@/lib/recommendation-reason-trace";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";
import { recommendationPlaceType, mergePlaceIdentityFields } from "@/lib/place-identity";
import { placeReasonHours } from "@/lib/normalized-opening-status";
import { readPlaceRuntimeCache } from "@/lib/place-runtime-cache";
import { REVIEW_TOPIC_COPY, PlaceReviewEvidenceSchema } from "@/lib/place-review-evidence";
import type { PlaceResult } from "@/lib/place-result";
import {
  identityDisplayLabel,
  resolvePlaceIdentity,
  type PlaceIdentity,
} from "@/lib/place-identity";
import {
  resolveBudgetMode,
  type BudgetMode,
  type TravelPreferences,
} from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";

export type UserProfileForReason = {
  profileTier?: "free" | "plus";
  onboarded?: boolean;
  pace?: TravelPreferences["pace"];
  vibe?: TravelPreferences["vibe"];
  avoid?: string[];
  budgetMode?: BudgetMode;
  interests?: string[];
  travelStyle?: string;
  personalityType?: string;
  personalitySummary?: string;
  mood?: string;
  aiPreferences?: Record<string, unknown>;
};

export type PlaceRecommendationIntent =
  | "shopping"
  | "restaurant"
  | "cafe"
  | "attraction"
  | "scenic"
  | "night_market"
  | "bar"
  | "indoor";

export type RecommendationPreferenceEvidenceSource =
  | "USER_MESSAGE"
  | "SESSION_CONTEXT"
  | "PLUS_PROFILE"
  | "CATEGORY_DERIVED"
  | "AI_INFERRED"
  | "SYSTEM_SYNTHESIZED"
  | "HOME_MOOD_ENTRY";

export type DistanceEvidenceSource =
  | "USER_LOCATION"
  | "NAVIGATION_ORIGIN"
  | "CLARIFICATION_GEOCODE"
  | "DESTINATION_CENTER"
  | "AREA_CENTER"
  | "SEARCH_CENTER"
  | "ROUTE"
  | "UNKNOWN";

export function isGroundedPreferenceEvidenceSource(
  source: RecommendationPreferenceEvidenceSource | undefined,
): boolean {
  return (
    source === "USER_MESSAGE" ||
    source === "SESSION_CONTEXT" ||
    source === "PLUS_PROFILE" ||
    source === "HOME_MOOD_ENTRY"
  );
}

export type PlaceRecommendationContext = {
  surface?: string;
  presentation?: "compact" | "standard" | "detail";
  /** 僅供相容；優先使用 categoryIntent */
  categoryLabel?: string;
  /** Recommendation intent; never overrides factual place identity. */
  categoryIntent?: PlaceRecommendationIntent | string;
  distanceMeters?: number;
  /** Origin of distanceMeters; required for outward-facing proximity claims. */
  distanceSource?: DistanceEvidenceSource;
  /** True only when a walking route/duration was actually resolved. */
  hasWalkingRouteEvidence?: boolean;
  mood?: string;
  /** Provenance for outward-facing personalization claims. */
  preferenceEvidenceSource?: RecommendationPreferenceEvidenceSource;
  isSavedFavorite?: boolean;
};

/** Resolve recommendation intent from explicit field or category label. */
export function resolveReasonIntent(
  ctx?: PlaceRecommendationContext | null,
): PlaceRecommendationIntent | undefined {
  const raw = (ctx?.categoryIntent ?? "").trim().toLowerCase();
  if (
    raw === "shopping" ||
    raw === "restaurant" ||
    raw === "cafe" ||
    raw === "attraction" ||
    raw === "scenic" ||
    raw === "night_market" ||
    raw === "bar" ||
    raw === "indoor"
  ) {
    return raw;
  }
  const label = ctx?.categoryLabel ?? "";
  if (/購物|商圈|shopping|outlet|百貨/i.test(label)) return "shopping";
  if (/餐廳|美食|restaurant|food|正餐/i.test(label)) return "restaurant";
  if (/咖啡|cafe|café/i.test(label)) return "cafe";
  if (/夜市|night\s*market/i.test(label)) return "night_market";
  if (/酒吧|bar|nightlife/i.test(label)) return "bar";
  if (/室內|indoor/i.test(label)) return "indoor";
  if (/景點|觀景|scenic|attraction/i.test(label)) return "attraction";
  return undefined;
}

/**
 * Resolve factual place identity independently of the requested category.
 */
export function resolveIdentityForReason(
  place: PlaceResult,
  ctx?: PlaceRecommendationContext | null,
): PlaceIdentity {
  // Intent describes what the user requested, not what the provider place is.
  return resolvePlaceIdentity(place);
}

export function hasCompletedTravelQuiz(profile: UserProfileForReason | null | undefined): boolean {
  return profile?.profileTier === "plus" && profile.onboarded === true;
}

/**
 * 依地點真實身分與使用者偏好生成推薦理由（主入口）。
 */
export function generatePlaceReason(
  place: PlaceResult,
  userProfile?: UserProfileForReason | null,
  options?: {
    weather?: WeatherSummary | null;
    currentTime?: Date | string;
    context?: PlaceRecommendationContext;
    locale?: Locale;
  },
): string {
  return buildPlaceRecommendationReason(
    place,
    userProfile ?? null,
    options?.weather,
    options?.currentTime,
    options?.context,
    options?.locale,
  );
}

/**
 * 探索／聊天／心情推薦共用的推薦理由。
 */
export function buildPlaceRecommendationReason(
  place: PlaceResult,
  userProfile: UserProfileForReason | null | undefined,
  weather?: WeatherSummary | null,
  currentTime?: Date | string,
  context?: PlaceRecommendationContext,
  locale?: Locale,
): string {
  const resolved = resolveRecommendationReasonPlace(place);
  const language = locale ?? "zh-TW";
  const i = language === "zh-TW" ? 0 : language === "en" ? 1 : language === "ja" ? 2 : 3;
  const label = recommendationPlaceType(resolved, context?.surface)[i];
  const building = /寺廟|展望台|購物中心|公園|博物館|夜市/.test(label);
  const intro =
    i === 0
      ? `這是${building ? "一座" : label === "地點" || label === "景點" || label === "商圈" ? "一個" : "一間"}${label}`
      : i === 1
        ? `This is ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`
        : i === 2
          ? `ここは${label}です`
          : `이곳은 ${label}입니다`;
  const parsed = PlaceReviewEvidenceSchema.safeParse(resolved.reviewEvidence);
  const evidence = parsed.success && parsed.data.placeId === resolved.id ? parsed.data : undefined;
  const signals = evidence?.signals ?? [];
  const positive = signals
    .filter(
      (s) =>
        s.sentiment === "positive" &&
        !["queue", "crowds"].includes(s.topic) &&
        !signals.some(
          (other) =>
            other.topic === s.topic &&
            other.sentiment === "negative" &&
            other.supportCount >= s.supportCount,
        ),
    )
    .sort((a, b) => b.supportCount - a.supportCount || a.topic.localeCompare(b.topic));
  const chosen = positive.slice(0, 2);
  const stop = i === 1 ? "." : "。";
  let core = intro + stop;
  if (chosen.length) {
    // Each claim retains its own strength: a single mention cannot borrow another topic's count.
    const phrases = chosen.map((s) => {
      const strength =
        s.supportCount >= 3 && s.strength === "strong" ? 2 : s.supportCount >= 2 ? 1 : 0;
      const lead =
        i === 0
          ? ["有一則提到", "有多則提到", "有多則一致提到"][strength]
          : i === 1
            ? ["one mentions", "several mention", "several consistently mention"][strength]
            : i === 2
              ? ["1件が挙げるのは", "複数が挙げるのは", "複数が共通して挙げるのは"][strength]
              : [
                  "한 리뷰에서 언급한 점은",
                  "여러 리뷰에서 언급한 점은",
                  "여러 리뷰가 공통으로 언급한 점은",
                ][strength];
      return `${lead}${i === 0 || i === 2 ? "" : " "}${REVIEW_TOPIC_COPY[s.topic][i]}`;
    });
    const scope =
      i === 0
        ? "可取得的評論中，"
        : i === 1
          ? "In the available review sample, "
          : i === 2
            ? "取得できた口コミでは、"
            : "확인 가능한 리뷰 중 ";
    core = `${intro}${i === 0 ? "，" : stop + " "}${scope}${phrases.join(i === 0 || i === 2 ? "；" : "; ")}${stop}`;
  } else {
    const claims = new Set(resolved.reasonClaimEvidence ?? []);
    const factual = claims.has("quiet_ambience")
      ? REVIEW_TOPIC_COPY.quiet[i]
      : claims.has("seating_dwell")
        ? ["有可停留的座位", "seating is available", "座席があります", "좌석이 있습니다"][i]
        : "";
    if (factual)
      core += (i === 0 ? "已確認的特色是" : i === 1 ? " Verified feature: " : " ") + factual + stop;
  }
  const limitation = signals.find(
    (s) =>
      s.sentiment === "negative" &&
      s.supportCount >= 2 &&
      (s.topic === "queue" || s.topic === "crowds"),
  );
  if (limitation && chosen.length) {
    core =
      core.slice(0, -1) +
      (i === 0
        ? "；不過，可取得的評論中也有多則提到"
        : i === 1
          ? "; however, several available reviews also mention "
          : i === 2
            ? "。一方、取得できた複数の口コミでは"
            : "; 다만 확인 가능한 여러 리뷰에서는 ") +
      REVIEW_TOPIC_COPY[limitation.topic][i] +
      stop;
  }
  const at =
    currentTime instanceof Date ? currentTime : currentTime ? new Date(currentTime) : new Date();
  let hours = "";
  try {
    hours = placeReasonHours(resolved, language, at);
  } catch {
    /* Optional malformed hours must not hide identity/review evidence. */
  }
  const supporting =
    !chosen.length && !resolved.reasonClaimEvidence?.length && !hours && resolved.rating != null
      ? i === 0
        ? `Google 評分 ${resolved.rating.toFixed(1)}${resolved.userRatingCount ? `（${resolved.userRatingCount} 則評價）` : ""}。`
        : i === 1
          ? `Google rating: ${resolved.rating.toFixed(1)}.`
          : i === 2
            ? `Google評価は${resolved.rating.toFixed(1)}です。`
            : `Google 평점은 ${resolved.rating.toFixed(1)}입니다.`
      : "";
  // Surface affects only the supporting sentence, never selection of core evidence.
  const finalReason = core + (context?.presentation === "compact" ? "" : hours || supporting);
  emitRecommendationReasonTrace(
    buildRecommendationReasonTrace(
      resolved,
      context?.surface ?? "canonical_builder",
      finalReason,
      chosen,
      hours,
    ),
  );
  return finalReason;
}

/** Pure projection: reads the existing Place runtime authority, never fetches or writes. */
export function resolveRecommendationReasonPlace(
  place: Partial<PlaceResult> & {
    id?: string;
    placeId?: string;
    canonicalPlaceId?: string;
    googlePlaceId?: string | null;
    name?: string;
    placeName?: string;
    title?: string;
    type?: string;
    placeType?: string;
  },
): PlaceResult {
  const identity = resolveCanonicalPlaceIdentity(place);
  const id =
    identity.googlePlaceId ||
    identity.canonicalPlaceId ||
    (place.id ?? "").trim().replace(/^places\//, "");
  const cached = id ? readPlaceRuntimeCache(id)?.reasonPlace : undefined;
  const identityInput = {
    ...place,
    primaryType: place.primaryType ?? place.placeType ?? place.type ?? null,
  };
  return {
    address: null,
    lat: null,
    lng: null,
    rating: null,
    userRatingCount: null,
    photoName: null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...place,
    ...cached,
    ...mergePlaceIdentityFields(identityInput, cached ?? identityInput),
    id,
    name: cached?.name || place.name || place.placeName || place.title || "",
    reviewEvidence: cached?.reviewEvidence ?? place.reviewEvidence,
  };
}

/** 從完整 profile + prefs 組裝理由用資料（prefs 未載入時安全 fallback） */
export function userProfileForReasonFrom(
  prefs: TravelPreferences | null | undefined,
  extras?: {
    travelStyle?: string;
    personalityType?: string;
    personalitySummary?: string;
    mood?: string;
    aiPreferences?: Record<string, unknown>;
    hasPlusAccess?: boolean;
  },
): UserProfileForReason {
  const safe = prefs ?? {};
  const plusPersonalized = extras?.hasPlusAccess === true && Boolean(safe.onboarded);
  return {
    profileTier: extras?.hasPlusAccess === true ? "plus" : "free",
    onboarded: plusPersonalized,
    pace: plusPersonalized ? safe.pace : undefined,
    vibe: plusPersonalized ? safe.vibe : undefined,
    avoid: plusPersonalized ? safe.avoid : undefined,
    budgetMode: plusPersonalized ? resolveBudgetMode(safe) : undefined,
    interests: plusPersonalized ? safe.interests : undefined,
    travelStyle: plusPersonalized ? extras?.travelStyle : undefined,
    personalityType: plusPersonalized
      ? (extras?.personalityType ?? safe.personalityType)
      : undefined,
    personalitySummary: plusPersonalized
      ? (extras?.personalitySummary ?? safe.personalitySummary)
      : undefined,
    mood: extras?.mood,
    aiPreferences: plusPersonalized ? extras?.aiPreferences : undefined,
  };
}
