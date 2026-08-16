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
import {
  identityDisplayLabel,
  type PlaceIdentity,
} from "@/lib/place-identity";
import { getPlaceReasonCopy } from "@/lib/i18n/place-reason-copy";

export const PLACE_REASON_EVIDENCE_CODES = [
  "high_rating",
  "high_review_count",
  "popularity",
  "open_now",
  "late_hours",
  "nearby",
  "weather_fit",
  "preference_fit",
  "route_fit",
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

    const range = label.match(
      /(\d{1,2}):(\d{2})\s*[-–—~～至到]\s*(\d{1,2}):(\d{2})/,
    );
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
    return ["restaurant", "food_stall", "cafe", "bakery", "dessert", "breakfast_shop", "night_market"].includes(
      identity,
    );
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

function hasPreferenceFit(
  identity: PlaceIdentity,
  profile: UserProfileForReason | null | undefined,
  ctx: PlaceReasonEvidenceContext,
): boolean {
  const mood = (ctx.mood ?? "").trim();
  if (mood && isGroundedPreferenceEvidenceSource(ctx.preferenceEvidenceSource)) return true;
  if (!hasCompletedTravelQuiz(profile) || !profile) return false;
  const interests = profile.interests ?? [];
  return interests.some((interest) => interestMatchesIdentity(interest, identity));
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
  const userProximity =
    ctx.distanceSource === "USER_LOCATION" || ctx.distanceSource === "NAVIGATION_ORIGIN";
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

  if (hasPreferenceFit(identity, shared.userProfile, ctx)) {
    evidence.push({ code: "preference_fit", score: 300 });
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
  const primary = ranked.filter(
    (item) => item.code !== "high_rating" && item.code !== "high_review_count",
  );
  const unused = primary.find((item) => !used.has(item.code));
  return unused?.code ?? primary[0]?.code ?? "grounded_neutral";
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
  const contextMood = isGroundedPreferenceEvidenceSource(ctx.preferenceEvidenceSource)
    ? ctx.mood
    : undefined;
  const profileMood = hasCompletedTravelQuiz(shared.userProfile)
    ? shared.userProfile?.mood
    : undefined;
  const mood = (contextMood ?? profileMood ?? "").trim();

  let body: string;
  switch (code) {
    case "high_rating":
    case "high_review_count":
      body =
        locale === "zh-TW"
          ? "目前可確認的資訊較少，先提供你作為選擇參考"
          : locale === "ja"
            ? "確認できる情報が少ないため、候補として参考にしてください"
            : locale === "ko"
              ? "확인 가능한 정보가 적어 선택 후보로 먼저 보여드려요"
              : "There is limited verified detail, so consider this as an option";
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
      if (ctx.distanceMeters != null && ctx.distanceMeters < 600) {
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
      if (mood) {
        body =
          locale === "zh-TW"
            ? `呼應你「${mood}」的心情`
            : locale === "ja"
              ? `「${mood}」の気分に合う`
              : locale === "ko"
                ? `「${mood}」기분에 맞아요`
                : `Fits your “${mood}” mood`;
      } else {
        body =
          locale === "zh-TW"
            ? `符合你對${label}的偏好`
            : locale === "ja"
              ? `${label}の好みに合う`
              : locale === "ko"
                ? `${label} 취향에 맞아요`
                : `Matches your ${label} preference`;
      }
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
    locale === "en" ? `${trimmed}.` : `${trimmed}${locale === "zh-TW" || locale === "ja" ? "。" : "."}`;

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
  return items.map(({ place, context }) => {
    const ctx = context ?? {};
    try {
      const ranked = collectPlaceReasonEvidence(place, ctx, shared);
      const evidenceCode = pickEvidenceCode(ranked, used);
      used.add(evidenceCode);
      return {
        placeId: place.id,
        evidenceCode,
        reason: renderEvidenceReason(place, evidenceCode, ctx, shared),
        availableCodes: ranked.map((item) => item.code),
      };
    } catch {
      return {
        placeId: place.id,
        evidenceCode: "grounded_neutral" as const,
        reason: renderEvidenceReason(place, "grounded_neutral", ctx, shared),
        availableCodes: ["grounded_neutral"],
      };
    }
  });
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
 * Batch reason builder. Length 0/1 skips diversity so a single Place Detail
 * / one-card path stays on the existing per-place templates.
 */
export function buildDiversePlaceRecommendationReasons(
  items: PlaceReasonDiversityItem[],
  shared: PlaceReasonDiversityShared = {},
): string[] {
  if (items.length <= 1) return fallbackReasons(items, shared);
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
