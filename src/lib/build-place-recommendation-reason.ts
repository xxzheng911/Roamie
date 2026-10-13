import {
  buildRecommendationReasonTrace,
  emitRecommendationReasonTrace,
} from "@/lib/recommendation-reason-trace";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";
import { mergePlaceIdentityFields } from "@/lib/place-identity";
import { placeReasonHours } from "@/lib/normalized-opening-status";
import { readPlaceRuntimeCache } from "@/lib/place-runtime-cache";
import { REVIEW_TOPIC_COPY, PlaceReviewEvidenceSchema } from "@/lib/place-review-evidence";
import type { PlaceResult } from "@/lib/place-result";
import { resolvePlaceIdentity, type PlaceIdentity } from "@/lib/place-identity";
import { buildPersonalizationContextV1 } from "@/lib/personalization/resolve-effective-preference";
import type {
  PreferenceLayer,
  PreferenceSource,
  SessionPreferenceV1,
} from "@/lib/personalization/types";
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
  /** This turn's explicit preference layer (highest priority). */
  explicitPreference?: PreferenceLayer;
  /** Session-scoped preference (outranks the Plus profile). */
  sessionPreference?: SessionPreferenceV1 | null;
  /** Confirmed itinerary data only; never estimated or model-authored. */
  itinerary?: { scheduledTime?: string; stayMinutes?: number };
};

/**
 * Persistable, non-private reason context carried on cards across handoff/restore so the
 * renderer re-derives the same reason. Never holds Plus profile data.
 */
export type PlaceReasonContextSnapshot = Pick<
  PlaceRecommendationContext,
  "categoryIntent" | "preferenceEvidenceSource" | "explicitPreference" | "itinerary"
>;

/** Copies only the allow-listed, non-private reason context fields across a handoff. */
export function pickReasonContextSnapshot(value: unknown): PlaceReasonContextSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const ctx = value as PlaceReasonContextSnapshot;
  const picked: PlaceReasonContextSnapshot = {};
  if (ctx.categoryIntent !== undefined) picked.categoryIntent = ctx.categoryIntent;
  if (ctx.preferenceEvidenceSource !== undefined)
    picked.preferenceEvidenceSource = ctx.preferenceEvidenceSource;
  if (ctx.explicitPreference !== undefined) picked.explicitPreference = ctx.explicitPreference;
  if (ctx.itinerary !== undefined) picked.itinerary = ctx.itinerary;
  return Object.keys(picked).length ? picked : undefined;
}

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

/** Bump when reason composition changes; restored envelopes from older contracts are re-derived. */
export const PLACE_REASON_CONTEXT_VERSION = "reason-v2";

export type PlaceReasonSource =
  | "verified_evidence"
  | "itinerary_context"
  | "personalization_match"
  | "generic_fallback";

export type PlaceReasonEvidenceRef =
  | `review:${string}`
  | `claim:${string}`
  | "itinerary:stay"
  | "itinerary:time"
  | "preference:category"
  | "preference:pace"
  | "preference:interests";

/**
 * V2 Reason Envelope. Text is always re-derived from Place evidence + context by this module;
 * a stored envelope/text is never trusted as evidence on its own.
 */
export type PlaceReasonEnvelope = {
  placeId: string;
  locale: Locale;
  reasonText: string;
  reasonSource: PlaceReasonSource;
  evidenceLevel: "verified" | "contextual" | "neutral";
  evidenceRefs: PlaceReasonEvidenceRef[];
  personalizationSource: PreferenceSource | null;
  contextVersion: typeof PLACE_REASON_CONTEXT_VERSION;
};

type Clause = { text: string; refs: PlaceReasonEvidenceRef[]; source?: PreferenceSource };

const L = (i: number, copy: readonly [string, string, string, string]) => copy[i];

const SOURCE_RANK: Record<PreferenceSource, number> = {
  explicit: 0,
  session: 1,
  plus_profile: 2,
  default: 3,
};

const INTENT_IDENTITIES: Record<PlaceRecommendationIntent, PlaceIdentity[]> = {
  cafe: ["cafe", "bakery", "dessert"],
  restaurant: ["restaurant", "food_stall", "breakfast_shop"],
  shopping: ["shopping_mall", "department_store", "district", "night_market", "bookstore"],
  attraction: ["tourist_attraction", "museum", "park"],
  scenic: ["tourist_attraction", "museum", "park"],
  night_market: ["night_market"],
  bar: ["bar"],
  indoor: ["museum", "department_store", "shopping_mall", "bookstore"],
};

const INTENT_WORD: Record<PlaceRecommendationIntent, [string, string, string, string]> = {
  cafe: ["咖啡廳", "a café", "カフェ", "카페"],
  restaurant: ["用餐地點", "a place to eat", "食事の場所", "식사 장소"],
  shopping: ["逛街去處", "somewhere to shop", "買い物スポット", "쇼핑 장소"],
  attraction: ["景點", "sightseeing", "観光スポット", "관광지"],
  // Scenic intent never becomes a view claim; it is phrased as plain sightseeing.
  scenic: ["景點", "sightseeing", "観光スポット", "관광지"],
  night_market: ["夜市", "a night market", "夜市", "야시장"],
  bar: ["晚上的去處", "an evening spot", "夜の行き先", "저녁 장소"],
  indoor: ["室內行程", "indoor plans", "屋内の予定", "실내 일정"],
};

const SLOW_PACE_IDENTITIES: PlaceIdentity[] = [
  "cafe",
  "bookstore",
  "park",
  "museum",
  "district",
  "tourist_attraction",
];

const INTEREST_TOPICS: Array<{
  pattern: RegExp;
  identities: PlaceIdentity[];
  word: [string, string, string, string];
}> = [
  {
    pattern: /咖啡|cafe|café|coffee/i,
    identities: ["cafe", "bakery"],
    word: ["咖啡", "coffee", "カフェ", "카페"],
  },
  {
    pattern: /美食|餐|food|restaurant/i,
    identities: ["restaurant", "food_stall", "bakery", "dessert", "breakfast_shop", "night_market"],
    word: ["美食", "food", "グルメ", "미식"],
  },
  {
    pattern: /逛|購物|shop/i,
    identities: ["department_store", "shopping_mall", "district", "night_market"],
    word: ["逛街購物", "shopping", "ショッピング", "쇼핑"],
  },
  {
    pattern: /自然|公園|戶外|park|nature/i,
    identities: ["park"],
    word: ["自然戶外", "nature and the outdoors", "自然", "자연"],
  },
  {
    pattern: /文化|藝術|展覽|博物館|museum|culture|art/i,
    identities: ["museum", "bookstore"],
    word: ["文化藝術", "arts and culture", "文化・アート", "문화·예술"],
  },
];

/** Neutral, claim-free fallback: describes how the stop can fit a trip, never what it is like. */
function genericFallback(identity: PlaceIdentity, i: number): string {
  if (["cafe", "bakery", "dessert"].includes(identity))
    return L(i, [
      "可以作為行程中途補充飲品或點心的一站。",
      "Could work as a stop for a drink or a snack along the way.",
      "移動の合間に飲み物や軽食をとる立ち寄り先にできます。",
      "이동 중에 음료나 간식을 챙기는 들를 곳으로 넣어 둘 수 있어요.",
    ]);
  if (["restaurant", "food_stall", "breakfast_shop"].includes(identity))
    return L(i, [
      "安排用餐時，可以把這裡列入這趟行程的候選。",
      "One to consider when planning meals on this trip.",
      "食事の予定を組むときの候補に入れておけます。",
      "식사 일정을 짤 때 후보로 넣어 둘 수 있어요.",
    ]);
  if (["tourist_attraction", "museum", "park"].includes(identity))
    return L(i, [
      "可以排進這趟的探索路線，作為其中一站。",
      "You can add this as one of the stops on your exploring route.",
      "散策ルートの立ち寄り先のひとつとして組み込めます。",
      "둘러보는 동선의 한 곳으로 넣어 볼 수 있어요.",
    ]);
  if (["shopping_mall", "department_store", "district", "bookstore", "shop"].includes(identity))
    return L(i, [
      "想安排逛街時間時，可以把這裡列入候選。",
      "One to consider if you want to set aside time for browsing.",
      "買い物や街歩きの時間をとるなら候補になります。",
      "쇼핑이나 구경할 시간을 낼 때 후보로 넣어 둘 수 있어요.",
    ]);
  if (identity === "night_market" || identity === "bar")
    return L(i, [
      "想安排晚上的行程時，可以列入候選。",
      "One to consider when planning your evening.",
      "夜の予定を考えるときの候補になります。",
      "저녁 일정을 계획할 때 후보로 넣어 둘 수 있어요.",
    ]);
  return L(i, [
    "可以視當天安排，作為這趟行程的候選地點。",
    "One to consider as you shape this trip's plans.",
    "当日の予定に合わせて候補に加えられます。",
    "당일 일정에 맞춰 후보로 넣어 둘 수 있어요.",
  ]);
}

function itineraryClause(ctx: PlaceRecommendationContext | undefined, i: number): Clause | null {
  const stay = ctx?.itinerary?.stayMinutes;
  if (typeof stay === "number" && Number.isFinite(stay) && stay >= 90) {
    return {
      refs: ["itinerary:stay"],
      text: L(i, [
        "這站保留了較充裕的停留時間，可以照自己的步調探索。",
        "This stop has extra time set aside, so you can explore at your own pace.",
        "滞在時間を長めに確保しているので、自分のペースで回れます。",
        "머무는 시간을 넉넉히 잡아 두어 내 속도대로 둘러볼 수 있어요.",
      ]),
    };
  }
  const time = ctx?.itinerary?.scheduledTime?.trim() ?? "";
  if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) {
    return {
      refs: ["itinerary:time"],
      text: L(i, [
        `已排進這趟行程的 ${time} 時段。`,
        `Already part of this trip's plan at ${time}.`,
        `今回の行程では${time}に組み込まれています。`,
        `이번 일정에서 ${time}에 배치되어 있어요.`,
      ]),
    };
  }
  return null;
}

/**
 * Personalization explains fit only; it never turns a preference into a Place fact.
 * Priority: explicit current request > session > Plus profile (via resolveEffectivePreference).
 */
function personalizationClause(
  identity: PlaceIdentity,
  profile: UserProfileForReason | null | undefined,
  ctx: PlaceRecommendationContext | undefined,
  i: number,
): Clause | null {
  const clauses: Clause[] = [];
  const intent = resolveReasonIntent(ctx);
  if (
    intent &&
    ctx?.preferenceEvidenceSource === "USER_MESSAGE" &&
    INTENT_IDENTITIES[intent].includes(identity)
  ) {
    const word = INTENT_WORD[intent][i];
    clauses.push({
      source: "explicit",
      refs: ["preference:category"],
      text: L(i, [
        `符合你這次想找${word}的需求。`,
        `Matches your request for ${word} this time.`,
        `今回探している${word}の条件に合っています。`,
        `이번에 찾고 있는 ${word} 조건에 맞아요.`,
      ]),
    });
  }
  const effective = buildPersonalizationContextV1({
    surface: "destination",
    // Guest/Free never contribute a profile layer (profilePreferenceLayer requires Plus).
    profile: profile?.profileTier === "plus" && profile.onboarded === true ? profile : null,
    explicitCurrentRequest: ctx?.explicitPreference,
    sessionPreference: ctx?.sessionPreference ?? null,
  }).resolvedPreference;
  const paceSource = effective.sources.pace;
  if (effective.pace === "slow" && paceSource && SLOW_PACE_IDENTITIES.includes(identity)) {
    clauses.push({
      source: paceSource,
      refs: ["preference:pace"],
      text: L(i, [
        "想放慢步調的話，可以把這站排得寬鬆一些。",
        "If you'd like a slower pace, you can leave extra room around this stop.",
        "ゆったり回りたいなら、ここは時間に余裕を持って組み込めます。",
        "여유롭게 다니고 싶다면 이곳 일정에 시간을 넉넉히 잡아 두어도 좋아요.",
      ]),
    });
  }
  const interestSource = effective.sources.interests;
  if (interestSource && effective.interests?.length) {
    const topic = INTEREST_TOPICS.find(
      (t) => t.identities.includes(identity) && effective.interests!.some((v) => t.pattern.test(v)),
    );
    if (topic) {
      const word = topic.word[i];
      clauses.push({
        source: interestSource,
        refs: ["preference:interests"],
        text: L(i, [
          `和你偏好的${word}主題相符。`,
          `Lines up with your interest in ${word}.`,
          `${word}が好きという好みに合っています。`,
          `${word}에 대한 관심사와 잘 맞아요.`,
        ]),
      });
    }
  }
  clauses.sort((a, b) => SOURCE_RANK[a.source!] - SOURCE_RANK[b.source!]);
  return clauses[0] ?? null;
}

/**
 * 探索／聊天／心情推薦共用的推薦理由（V2 Reason Authority）。
 * Order: verified evidence → confirmed itinerary context → evidenced preference fit → neutral fallback.
 */
export function resolvePlaceReasonEnvelope(
  place: PlaceResult,
  userProfile: UserProfileForReason | null | undefined,
  weather?: WeatherSummary | null,
  currentTime?: Date | string,
  context?: PlaceRecommendationContext,
  locale?: Locale,
): PlaceReasonEnvelope {
  void weather;
  const resolved = resolveRecommendationReasonPlace(place);
  const language = locale ?? "zh-TW";
  const i = language === "zh-TW" ? 0 : language === "en" ? 1 : language === "ja" ? 2 : 3;
  const identity = resolvePlaceIdentity(resolved);
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
  // Korean and English end with a period; zh-TW/ja use the ideographic full stop.
  const stop = i === 1 || i === 3 ? "." : "。";
  const refs: PlaceReasonEvidenceRef[] = [];
  let verified = "";
  if (chosen.length) {
    // Each claim retains its own strength: a single mention cannot borrow another topic's count.
    let previousStrength = -1;
    const phrases = chosen.map((s) => {
      const strength =
        s.supportCount >= 3 && s.strength === "strong" ? 2 : s.supportCount >= 2 ? 1 : 0;
      const lead =
        i === 0
          ? ["有評論提到", "多則評論提到", "可取得的多則評論一致提到"][strength]
          : i === 1
            ? ["one mentions", "several mention", "several consistently mention"][strength]
            : i === 2
              ? ["1件が挙げるのは", "複数が挙げるのは", "複数が共通して挙げるのは"][strength]
              : [
                  "한 리뷰에서 언급한 점은",
                  "여러 리뷰에서 언급한 점은",
                  "여러 리뷰가 공통으로 언급한 점은",
                ][strength];
      // Only equal-strength Chinese clauses share a lead; mixed strengths stay explicit.
      const shareLead = i === 0 && previousStrength === strength;
      previousStrength = strength;
      refs.push(`review:${s.topic}`);
      return `${shareLead ? "" : lead}${i === 0 || i === 2 ? "" : " "}${REVIEW_TOPIC_COPY[s.topic][i]}`;
    });
    const scope =
      i === 0
        ? ""
        : i === 1
          ? "In the available review sample, "
          : i === 2
            ? "取得できた口コミでは、"
            : "확인 가능한 리뷰 중 ";
    verified = `${scope}${phrases.join(i === 0 ? "，" : i === 2 ? "；" : "; ")}${stop}`;
    const limitation = signals.find(
      (s) =>
        s.sentiment === "negative" &&
        s.supportCount >= 2 &&
        (s.topic === "queue" || s.topic === "crowds"),
    );
    if (limitation) {
      verified =
        verified.slice(0, -1) +
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
  } else {
    const claims = new Set(resolved.reasonClaimEvidence ?? []);
    const claim = claims.has("quiet_ambience")
      ? "quiet_ambience"
      : claims.has("seating_dwell")
        ? "seating_dwell"
        : "";
    if (claim) {
      refs.push(`claim:${claim}`);
      const factual =
        claim === "quiet_ambience"
          ? REVIEW_TOPIC_COPY.quiet[i]
          : ["有可停留的座位", "seating is available", "座席があります", "좌석이 있습니다"][i];
      verified =
        L(i, ["已確認的特色是", "Verified feature: ", "確認済みの特徴：", "확인된 특징: "]) +
        factual +
        stop;
    }
  }
  const itinerary = itineraryClause(context, i);
  const personal = personalizationClause(identity, userProfile, context, i);
  const layers: Array<[PlaceReasonSource, Clause]> = [];
  if (verified) layers.push(["verified_evidence", { text: verified, refs: [...refs] }]);
  if (itinerary) layers.push(["itinerary_context", itinerary]);
  if (personal) layers.push(["personalization_match", personal]);
  const [primarySource, primary] = layers[0] ?? [
    "generic_fallback",
    { text: genericFallback(identity, i), refs: [] },
  ];
  // Compact shows the primary layer only; longer presentations add one supporting layer, so
  // every presentation of the same Place/context shares the same leading reason.
  const compact = context?.presentation === "compact";
  const secondary = compact ? undefined : layers[1]?.[1];
  // Opening hours are place facts shown elsewhere; they only support real evidence.
  const at =
    currentTime instanceof Date ? currentTime : currentTime ? new Date(currentTime) : new Date();
  let hours = "";
  if (verified && !compact) {
    try {
      hours = placeReasonHours(resolved, language, at);
    } catch {
      /* Optional malformed hours must not hide identity/review evidence. */
    }
  }
  const joiner = i === 1 || i === 3 ? " " : "";
  const reasonText = [primary.text, secondary?.text].filter(Boolean).join(joiner) + hours;
  const used = [primary, secondary].filter((c): c is Clause => Boolean(c));
  const personalizationSource = used.find((c) => c.source)?.source ?? null;
  try {
    emitRecommendationReasonTrace(
      buildRecommendationReasonTrace(
        resolved,
        context?.surface ?? "canonical_builder",
        reasonText,
        chosen,
        hours,
      ),
    );
  } catch {
    /* Telemetry on malformed provider data must never block the card. */
  }
  return {
    placeId: resolved.id,
    locale: language,
    reasonText,
    reasonSource: primarySource,
    evidenceLevel:
      primarySource === "verified_evidence"
        ? "verified"
        : primarySource === "generic_fallback"
          ? "neutral"
          : "contextual",
    evidenceRefs: used.flatMap((c) => c.refs),
    personalizationSource,
    contextVersion: PLACE_REASON_CONTEXT_VERSION,
  };
}

/** Text projection of the V2 envelope; every surface renders through this. */
export function buildPlaceRecommendationReason(
  place: PlaceResult,
  userProfile: UserProfileForReason | null | undefined,
  weather?: WeatherSummary | null,
  currentTime?: Date | string,
  context?: PlaceRecommendationContext,
  locale?: Locale,
): string {
  return resolvePlaceReasonEnvelope(place, userProfile, weather, currentTime, context, locale)
    .reasonText;
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
