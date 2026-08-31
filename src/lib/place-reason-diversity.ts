/**
 * Place Intelligence Phase 2A — Recommendation Reason Diversity
 *
 * Batch-level contract (does not change ranking or search):
 * 1. Collect structured evidence per place from runtime fields only.
 * 2. Each place prefers its strongest available evidence.
 * 3. If that evidence code is already used in the batch, take the next-ranked code.
 * 4. Duplicate a code only when the place has no unused evidence left.
 * 5. Never drop/reorder places. Single-place calls skip this engine.
 * 6. On failure, fall back to buildPlaceRecommendationReason().
 */
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
import { identityDisplayLabel, type PlaceIdentity } from "@/lib/place-identity";
import { getPlaceReasonCopy } from "@/lib/i18n/place-reason-copy";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { buildPersonalizationContextV1 } from "@/lib/personalization/resolve-effective-preference";
import { scorePersonalization } from "@/lib/personalization/score";

export const PLACE_REASON_EVIDENCE_CODES = [
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

function isFallbackEvidenceCode(code: PlaceReasonEvidenceCode): boolean {
  return code === "grounded_neutral" || code === "category_match";
}

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
  "cafe", "bookstore", "park", "museum", "district", "tourist_attraction",
];
const QUIET_VIBE_IDENTITIES: PlaceIdentity[] = ["bookstore", "park", "museum", "cafe"];

const CATEGORY_LABEL_EN: Record<PlaceIdentity, string> = {
  bookstore: "bookstore",
  breakfast_shop: "breakfast spot",
  cafe: "café",
  bakery: "bakery",
  dessert: "dessert shop",
  restaurant: "restaurant",
  food_stall: "snack stall",
  shopping_mall: "mall",
  department_store: "department store",
  tourist_attraction: "attraction",
  museum: "museum",
  night_market: "night market",
  district: "district",
  park: "park",
  bar: "bar",
  generic: "place",
  unsupported: "place",
};

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

function formatHhMm(totalMinutes: number): string {
  const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
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
  return profile?.profileTier === "plus" && profile.onboarded === true;
}

function textPreferenceMatchesIdentity(value: string | undefined, identity: PlaceIdentity): boolean {
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
    result.push({ code: "preference_fit", score: 300, preferenceField: "mood", mappingContract: "grounded_mood" });
  }
  if (!profileEvidenceAllowed(profile) || !profile) return result;
  const unifiedContext = buildPersonalizationContextV1({ surface: "destination", profile });
  const unified = scorePersonalization({ primaryType: identity, types: [identity] }, unifiedContext);
  if (unified.interestFitScore > 0) {
    result.push({ code: "preference_fit_interest", score: 306, preferenceField: "interests", mappingContract: "interest_identity_v1" });
  }
  if (unified.paceFitScore > 0) {
    result.push({ code: "preference_fit_pace", score: 305, preferenceField: "pace", mappingContract: "slow_pace_identity_v1" });
  }
  if (unified.vibeFitScore > 0 && profile.vibe === "quiet") {
    result.push({ code: "preference_fit_vibe", score: 304, preferenceField: "vibe", mappingContract: "quiet_vibe_identity_v1" });
  }
  if (unified.travelStyleFitScore > 0) {
    result.push({ code: "preference_fit_travel_style", score: 303, preferenceField: "travelStyle", mappingContract: "travel_style_identity_v1" });
  }
  if (textPreferenceMatchesIdentity(`${profile.personalityType ?? ""} ${profile.personalitySummary ?? ""}`, identity)) {
    result.push({ code: "preference_fit_personality", score: 302, preferenceField: "personality", mappingContract: "personality_identity_v1" });
  }
  if (textPreferenceMatchesIdentity(JSON.stringify(profile.aiPreferences ?? {}), identity)) {
    result.push({ code: "preference_fit_ai_preference", score: 301, preferenceField: "aiPreferences", mappingContract: "ai_preference_identity_v1" });
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

function categoryLabel(identity: PlaceIdentity, place: PlaceResult, locale: Locale): string {
  if (locale === "zh-TW") return identityDisplayLabel(identity, place);
  return CATEGORY_LABEL_EN[identity] ?? "place";
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

function pickEvidenceCode(
  ranked: PlaceReasonEvidence[],
  used: Set<PlaceReasonEvidenceCode>,
): PlaceReasonEvidenceCode {
  const primaryOrder: PlaceReasonEvidenceCode[][] = [
    ["coffee_quiet_ambience", "coffee_seating_dwell"],
    [
      "late_hours",
      "popularity",
      "high_review_count",
      "high_rating",
      "weather_fit",
      "route_fit",
      "open_now",
    ],
    [
      "preference_fit_interest",
      "preference_fit_pace",
      "preference_fit_vibe",
      "preference_fit_travel_style",
      "preference_fit_personality",
      "preference_fit_ai_preference",
    ],
    ["nearby"],
    ["category_match"],
  ];
  for (const tier of primaryOrder) {
    const candidates = ranked.filter((item) => tier.includes(item.code));
    const unused = candidates.find((item) => !used.has(item.code));
    if (unused) return unused.code;
    if (candidates[0]) return candidates[0].code;
  }
  // Generic mood matching is presentation context, never a card's primary reason.
  return "grounded_neutral";
}

function selectCoffeeClaimEvidence(
  place: PlaceResult,
  identity: PlaceIdentity,
): PlaceReasonEvidence[] {
  if (identity !== "cafe") return [];
  const claims = new Set(place.reasonClaimEvidence ?? []);
  const evidence: PlaceReasonEvidence[] = [];
  if (claims.has("quiet_ambience")) {
    evidence.push({ code: "coffee_quiet_ambience", score: 1_000 });
  }
  if (claims.has("seating_dwell")) {
    evidence.push({ code: "coffee_seating_dwell", score: 990 });
  }
  return evidence;
}

function renderEvidenceReason(
  place: PlaceResult,
  code: PlaceReasonEvidenceCode,
  ctx: PlaceReasonEvidenceContext,
  shared: PlaceReasonDiversityShared,
): string {
  const locale = shared.locale ?? "zh-TW";
  const copy = getPlaceReasonCopy(locale);
  const identity = resolveIdentityForReason(place, ctx);
  const label = categoryLabel(identity, place, locale);
  const weatherKind = weatherFitKind(shared.weather, identity);
  const closeMinutes = parseCloseMinutes(place, resolveDate(shared.currentTime));
  let body: string;
  switch (code) {
    case "high_rating":
      body =
        locale === "zh-TW"
          ? `Google 評分 ${place.rating?.toFixed(1) ?? "—"}，評分表現不錯`
          : locale === "ja"
            ? `Google評価${place.rating?.toFixed(1) ?? "—"}で、評価は良好です`
            : locale === "ko"
              ? `Google 평점 ${place.rating?.toFixed(1) ?? "—"}로 평점이 좋은 편이에요`
              : `Google rating ${place.rating?.toFixed(1) ?? "—"}, with a solid rating`;
      break;
    case "high_review_count":
      body =
        locale === "zh-TW"
          ? `已有 ${place.userRatingCount ?? 0} 則 Google 評論，可參考的使用者回饋較多`
          : locale === "ja"
            ? `Googleレビューが${place.userRatingCount ?? 0}件あり、参考にできる声が多いです`
            : locale === "ko"
              ? `Google 리뷰가 ${place.userRatingCount ?? 0}개 있어 참고할 이용자 의견이 많아요`
              : `${place.userRatingCount ?? 0} Google reviews provide more user feedback to consider`;
      break;
    case "popularity":
      body =
        locale === "zh-TW"
          ? `在這一帶屬於評價與討論度都較高的${label}選擇`
          : locale === "ja"
            ? `このエリアで評価と注目度の高い${label}の選択肢`
            : locale === "ko"
              ? `이 지역에서 평가와 관심도가 높은 ${label} 선택지예요`
              : `A ${label} option with strong ratings and local interest`;
      break;
    case "open_now":
      body = copy.openNow;
      break;
    case "late_hours":
      if (closeMinutes != null && closeMinutes < 24 * 60) {
        const until = formatHhMm(closeMinutes);
        body =
          locale === "zh-TW"
            ? `營業至 ${until}，時間比較彈性`
            : locale === "ja"
              ? `${until}まで営業で時間を合わせやすい`
              : locale === "ko"
                ? `${until}까지 영업해서 시간 맞추기 좋아요`
                : `Open until ${until} — easier to fit in`;
      } else {
        body =
          locale === "zh-TW"
            ? "營業到較晚，時間比較彈性"
            : locale === "ja"
              ? "遅くまで開いていて時間を合わせやすい"
              : locale === "ko"
                ? "늦게까지 열어서 시간 맞추기 좋아요"
                : "Open late — easier to fit in";
      }
      break;
    case "nearby":
      if (ctx.distanceSource !== "USER_LOCATION") {
        body =
          locale === "zh-TW"
            ? "位於這次搜尋範圍內"
            : locale === "ja"
              ? "今回の検索範囲内にあります"
              : locale === "ko"
                ? "이번 검색 범위 안에 있어요"
                : "Within this search area";
      } else if (ctx.distanceMeters != null && ctx.distanceMeters < 600) {
        body =
          locale === "zh-TW"
            ? ctx.hasWalkingRouteEvidence
              ? "距離你很近，已有步行路線可前往"
              : "距離你很近"
            : locale === "ja"
              ? ctx.hasWalkingRouteEvidence
                ? "すぐ近くで徒歩ルートがある"
                : "すぐ近く"
              : locale === "ko"
                ? ctx.hasWalkingRouteEvidence
                  ? "아주 가까워서 도보 경로가 있어요"
                  : "아주 가까워요"
                : ctx.hasWalkingRouteEvidence
                  ? "Very close, with a verified walking route"
                  : "Very close";
      } else if (ctx.distanceMeters != null) {
        body =
          locale === "zh-TW"
            ? ctx.hasWalkingRouteEvidence
              ? `已有步行路線，距離約 ${Math.round(ctx.distanceMeters)} 公尺`
              : `距離你約 ${Math.round(ctx.distanceMeters)} 公尺`
            : copy.distanceM(Math.round(ctx.distanceMeters));
      } else {
        body =
          locale === "zh-TW"
            ? "距離你很近"
            : locale === "ja"
              ? "すぐ近く"
              : locale === "ko"
                ? "가까워요"
                : "Close by";
      }
      break;
    case "weather_fit":
      if (weatherKind === "rain_indoor") body = copy.rainIndoor;
      else if (weatherKind === "hot_indoor") body = copy.hotIndoor;
      else if (weatherKind === "cold_indoor") body = copy.coldIndoor;
      else if (weatherKind === "evening") {
        body =
          locale === "zh-TW"
            ? "適合傍晚以後的行程節奏"
            : locale === "ja"
              ? "夕方以降の予定に合わせやすい"
              : locale === "ko"
                ? "저녁 이후 일정에 맞아요"
                : "Fits an evening plan";
      } else {
        body =
          locale === "zh-TW"
            ? "今天天氣適合出門走走"
            : locale === "ja"
              ? "今日の天気なら外に出やすい"
              : locale === "ko"
                ? "오늘 날씨에 나가기 좋아요"
                : "Weather looks good for heading out";
      }
      break;
    case "preference_fit":
      // Generic mood fit is context, not sufficient primary Place evidence.
      body = locale === "zh-TW"
        ? "先依地點資料提供你參考"
        : "Included as an option based on the available place data";
      break;
    case "preference_fit_interest":
      body = locale === "zh-TW" ? `這類型地點符合你對${label}的興趣` : `This type of place matches your ${label} interests`;
      break;
    case "preference_fit_pace":
      body = locale === "zh-TW" ? "這類型地點較符合你偏好的慢步調安排" : "This type of place fits your slower-paced plans";
      break;
    case "preference_fit_vibe":
      body = locale === "zh-TW" ? "這類型地點較符合你偏好的安靜行程方向" : "This type of place fits the quieter direction you prefer";
      break;
    case "preference_fit_travel_style":
      body = locale === "zh-TW" ? `這類型地點與你的旅行風格較相容` : "This type of place is compatible with your travel style";
      break;
    case "preference_fit_personality":
      body = locale === "zh-TW" ? `這類型地點與你的旅行人格方向較相容` : "This type of place is compatible with your travel profile";
      break;
    case "preference_fit_ai_preference":
      body = locale === "zh-TW" ? `這類型地點符合你已設定的旅行偏好` : "This type of place matches your saved travel preferences";
      break;
    case "route_fit":
      body =
        locale === "zh-TW"
          ? "位於已確認的行程動線上，方便一併安排"
          : locale === "ja"
            ? "確認済みの行程ルート上にあり、組み込みやすい"
            : locale === "ko"
              ? "확인된 일정 동선에 있어 함께 넣기 좋아요"
              : "On the confirmed route, so it is easy to include";
      break;
    case "coffee_quiet_ambience":
      body = locale === "zh-TW" ? "地點資料顯示環境較安靜" : "Place evidence indicates a quieter setting";
      break;
    case "coffee_seating_dwell":
      body = locale === "zh-TW" ? "地點資料顯示適合停留久坐" : "Place evidence indicates it is suitable for a longer stay";
      break;
    case "category_match":
      body =
        locale === "zh-TW"
          ? "先依地點資料提供你參考"
          : locale === "ja"
            ? "確認できる場所情報をもとに候補として紹介します"
            : locale === "ko"
              ? "확인된 장소 정보를 바탕으로 참고할 선택지로 보여드려요"
              : "Included as an option based on the available place data";
      break;
    case "grounded_neutral":
    default:
      body =
        locale === "zh-TW"
          ? "先依地點資料提供你參考"
          : locale === "ja"
            ? "確認できる場所情報をもとに候補として紹介します"
            : locale === "ko"
              ? "확인된 장소 정보를 바탕으로 참고할 선택지로 보여드려요"
              : "Included as an option based on the available place data";
      break;
  }

  const trimmed = body.trim().replace(/[。．.]*$/, "");
  const withStop =
    locale === "en"
      ? `${trimmed}.`
      : `${trimmed}${locale === "zh-TW" || locale === "ja" ? "。" : "."}`;

  if (ctx.isSavedFavorite) {
    return `${copy.savedNearbyLead}${withStop}`;
  }
  return withStop;
}

export function assignDiversePlaceReasons(
  items: PlaceReasonDiversityItem[],
  shared: PlaceReasonDiversityShared = {},
): AssignedPlaceReason[] {
  const used = new Set<PlaceReasonEvidenceCode>();
  const assigned = items.map(({ place, context }) => {
    const ctx = context ?? {};
    try {
      const identity = resolveIdentityForReason(place, ctx);
      const ranked = [
        ...selectCoffeeClaimEvidence(place, identity),
        ...collectPlaceReasonEvidence(place, ctx, shared),
      ];
      const evidenceCode = pickEvidenceCode(ranked, used);
      used.add(evidenceCode);
      const resolved = {
        placeId: place.id,
        evidenceCode,
        reason: renderEvidenceReason(place, evidenceCode, ctx, shared),
        availableCodes: ranked.map((item) => item.code),
      };
      devVerboseInfo("[RECOMMENDATION_REASON_RESOLVED]", {
        placeId: place.id,
        reasonSource: isFallbackEvidenceCode(evidenceCode) ? "fallback" : "evidence",
        primaryEvidence: evidenceCode,
        availableEvidence: resolved.availableCodes,
        identity,
        categoryIntent: ctx.categoryIntent ?? "",
        fallbackUsed: isFallbackEvidenceCode(evidenceCode),
        fallbackReason: evidenceCode === "category_match"
          ? "category_match_last_fallback"
          : evidenceCode === "grounded_neutral"
            ? "no_verified_evidence"
            : "",
        profileTier: shared.userProfile?.profileTier ?? "free",
        profileOnboarded: shared.userProfile?.onboarded === true,
        preferenceEvidenceUsed: evidenceCode.startsWith("preference_fit"),
        preferenceEvidenceSource: evidenceCode === "preference_fit"
          ? ctx.preferenceEvidenceSource ?? ""
          : evidenceCode.startsWith("preference_fit_")
            ? "PLUS_PROFILE"
            : "",
        preferenceField: ranked.find((item) => item.code === evidenceCode)?.preferenceField ?? "",
        preferenceMappingContract: ranked.find((item) => item.code === evidenceCode)?.mappingContract ?? "",
        personalityTypeUsed: evidenceCode === "preference_fit_personality" && Boolean(shared.userProfile?.personalityType),
        personalitySummaryUsed: evidenceCode === "preference_fit_personality" && Boolean(shared.userProfile?.personalitySummary),
        aiReasonValidated: false,
        aiReasonRejectedClaim: "",
        restoredFromCache: false,
        distanceSource: ctx.distanceSource ?? "UNKNOWN",
        distanceMeters: ctx.distanceMeters ?? null,
        proximityWordingAllowed: ctx.distanceSource === "USER_LOCATION",
      });
      if (evidenceCode.startsWith("preference_fit")) {
        const selectedPreference = ranked.find((item) => item.code === evidenceCode);
        devVerboseInfo("[PLUS_PERSONALIZATION_REASON]", {
          placeId: place.id,
          surface: "recommendation",
          primaryPlaceEvidence: ranked.find((item) => !item.code.startsWith("preference_fit") && item.code !== "grounded_neutral")?.code ?? "",
          contextEvidence: evidenceCode === "preference_fit" ? ctx.preferenceEvidenceSource ?? "" : "",
          preferenceEvidence: evidenceCode,
          preferenceField: selectedPreference?.preferenceField ?? "",
          preferenceSource: evidenceCode === "preference_fit" ? ctx.preferenceEvidenceSource ?? "" : "PLUS_PROFILE",
          mappingContract: selectedPreference?.mappingContract ?? "",
          reasonPersonalized: true,
          reasonSource: "evidence_plus_preference",
        });
      }
      return resolved;
    } catch {
      const resolved = {
        placeId: place.id,
        evidenceCode: "grounded_neutral" as const,
        reason: renderEvidenceReason(place, "grounded_neutral", ctx, shared),
        availableCodes: ["grounded_neutral"],
      };
      devVerboseInfo("[RECOMMENDATION_REASON_RESOLVED]", {
        placeId: place.id,
        reasonSource: "fallback",
        primaryEvidence: "grounded_neutral",
        availableEvidence: resolved.availableCodes,
        identity: resolveIdentityForReason(place, ctx),
        categoryIntent: ctx.categoryIntent ?? "",
        fallbackUsed: true,
        fallbackReason: "evidence_resolution_failed",
        profileTier: shared.userProfile?.profileTier ?? "free",
        profileOnboarded: shared.userProfile?.onboarded === true,
        preferenceEvidenceUsed: false,
        preferenceEvidenceSource: "",
        preferenceField: "",
        preferenceMappingContract: "",
        personalityTypeUsed: false,
        personalitySummaryUsed: false,
        aiReasonValidated: false,
        aiReasonRejectedClaim: "",
        restoredFromCache: false,
        distanceSource: ctx.distanceSource ?? "UNKNOWN",
        distanceMeters: ctx.distanceMeters ?? null,
        proximityWordingAllowed: ctx.distanceSource === "USER_LOCATION",
      });
      return resolved;
    }
  });
  const evidenceCodeCounts = assigned.reduce<Record<string, number>>((counts, row) => {
    counts[row.evidenceCode] = (counts[row.evidenceCode] ?? 0) + 1;
    return counts;
  }, {});
  const fallbackCount =
    (evidenceCodeCounts.grounded_neutral ?? 0) + (evidenceCodeCounts.category_match ?? 0);
  const templateCount = assigned.filter(
    (row) => !isFallbackEvidenceCode(row.evidenceCode) && Boolean(row.reason.trim()),
  ).length;
  devVerboseInfo("[RECOMMENDATION_REASON_BATCH_SUMMARY]", {
    totalCount: assigned.length,
    evidenceCount: assigned.length - fallbackCount,
    templateCount,
    fallbackCount,
    evidenceCodeCounts,
  });
  return assigned;
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
