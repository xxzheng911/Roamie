import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { hasCompletedTravelQuiz } from "@/lib/build-place-recommendation-reason";
import type { BudgetMode, TravelPreferences } from "@/lib/preferences-storage";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import {
  identityDisplayLabel,
  resolvePlaceIdentity,
  type PlaceIdentity,
  type PlaceIdentityInput,
} from "@/lib/place-identity";
import { buildPersonalizationContextV1 } from "@/lib/personalization/resolve-effective-preference";
import { scorePersonalization } from "@/lib/personalization/score";
import type { PersonalizationSurface, SessionPreferenceV1 } from "@/lib/personalization/types";

export type PlusRankablePlace = Omit<PlaceIdentityInput, "address" | "name"> & {
  name?: string | null;
  address?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  isSavedFavorite?: boolean;
};

export type PlusPreferenceRankingContext = {
  /** 已由 userProfileForReasonFrom 處理：Free 為 null / 未 onboarded */
  profile: UserProfileForReason | null | undefined;
  savedPlaceCategories?: string[];
  savedPlaceNames?: string[];
  /** 使用者本輪明確排除（火鍋、百貨等）— 優先於測驗 */
  explicitAvoidKeywords?: string[];
  /** 使用者本輪明確偏好（室內、咖啡等） */
  explicitPreferKeywords?: string[];
  mood?: string | null;
  setting?: string | null;
  surface?: PersonalizationSurface;
  sessionPreference?: SessionPreferenceV1 | null;
  profileVersion?: string;
};

const QUIET_IDENTITIES: PlaceIdentity[] = [
  "bookstore",
  "cafe",
  "museum",
  "park",
  "bakery",
];
const LIVELY_IDENTITIES: PlaceIdentity[] = [
  "night_market",
  "district",
  "food_stall",
  "bar",
];
const SLOW_IDENTITIES: PlaceIdentity[] = [
  "cafe",
  "bookstore",
  "park",
  "museum",
  "bakery",
];
const ACTIVE_IDENTITIES: PlaceIdentity[] = [
  "tourist_attraction",
  "district",
  "museum",
  "shopping_mall",
];
const BUDGET_IDENTITIES: PlaceIdentity[] = [
  "food_stall",
  "breakfast_shop",
  "night_market",
  "park",
];
const QUALITY_IDENTITIES: PlaceIdentity[] = [
  "cafe",
  "restaurant",
  "museum",
  "bakery",
];
const LUXURY_IDENTITIES: PlaceIdentity[] = [
  "restaurant",
  "bar",
  "department_store",
];
const CROWDED_IDENTITIES: PlaceIdentity[] = [
  "shopping_mall",
  "department_store",
  "tourist_attraction",
  "night_market",
  "district",
];

const AVOID_CROWDS_LABELS = ["crowds", "人潮", "人太多", "擠", "吵"];
const AVOID_PACKED_LABELS = ["packed", "行程太滿", "太滿", "趕"];
const AVOID_OVERLOAD_LABELS = ["overload", "資訊過多", "選擇障礙", "太多"];

function placeBlob(place: PlusRankablePlace): string {
  return [place.name, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function includesAny(blob: string, keywords: string[]): boolean {
  return keywords.some((k) => blob.includes(k.toLowerCase()));
}

function identityIn(list: PlaceIdentity[], identity: PlaceIdentity): boolean {
  return list.includes(identity);
}

function budgetModeFromProfile(profile: UserProfileForReason): BudgetMode {
  return profile.budgetMode ?? "standard";
}

function avoidKeys(profile: UserProfileForReason): string[] {
  return profile.avoid ?? [];
}

function matchesQuizAvoid(
  profile: UserProfileForReason,
  keys: string[],
  labels: string[],
): boolean {
  const raw = avoidKeys(profile);
  return raw.some((a) => keys.includes(a) || labels.some((l) => a.includes(l)));
}

export function isPlusQuizPersonalizationActive(
  ctx: PlusPreferenceRankingContext | null | undefined,
): boolean {
  return Boolean(ctx?.profile && hasCompletedTravelQuiz(ctx.profile));
}

/** 使用者本輪明確排除（優先於測驗） */
export function buildExplicitAvoidKeywords(
  excludedCategories?: string[],
  avoidTypes?: string[],
): string[] {
  const raw = [...(excludedCategories ?? []), ...(avoidTypes ?? [])];
  const expanded: string[] = [];
  for (const item of raw) {
    const t = item.trim();
    if (!t) continue;
    expanded.push(t);
    if (/火鍋|hotpot/i.test(t)) expanded.push("火鍋", "涮涮鍋", "麻辣");
    if (/百貨|mall|department/i.test(t)) expanded.push("百貨", "購物中心", "mall");
    if (/酒吧|bar/i.test(t)) expanded.push("酒吧", "居酒屋", "pub");
    if (/海鮮/i.test(t)) expanded.push("海鮮", "生魚片");
  }
  return [...new Set(expanded)];
}

/** 使用者本輪明確偏好（室內、咖啡等） */
export function buildExplicitPreferKeywords(input: {
  mood?: string | null;
  setting?: string | null;
  interests?: string[];
  selectedInterests?: string[];
}): string[] {
  const blob = [
    input.mood ?? "",
    input.setting ?? "",
    ...(input.interests ?? []),
    ...(input.selectedInterests ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const prefer: string[] = [];
  if (/室內|下雨|雨天|雨/.test(blob) || input.setting === "indoor") {
    prefer.push("室內", "博物館", "咖啡", "書店", "商場");
  }
  if (/室外|戶外|散步|走走|公園/.test(blob) || input.setting === "outdoor") {
    prefer.push("公園", "步道", "河岸", "戶外", "景點");
  }
  if (/咖啡|cafe|咖啡廳/.test(blob)) prefer.push("咖啡", "咖啡廳", "cafe");
  if (/甜點|下午茶|蛋糕/.test(blob)) prefer.push("甜點", "蛋糕", "烘焙", "下午茶");
  if (/夜景|夜/.test(blob)) prefer.push("夜景", "觀景", "河岸");
  return [...new Set(prefer)];
}

export function buildPlusPreferenceRankingContext(input: {
  profile?: UserProfileForReason | null;
  savedPlaces?: Array<{ name: string; category?: string | null }>;
  explicitAvoidKeywords?: string[];
  explicitPreferKeywords?: string[];
  mood?: string | null;
  setting?: string | null;
  surface?: PersonalizationSurface;
  sessionPreference?: SessionPreferenceV1 | null;
  profileVersion?: string;
}): PlusPreferenceRankingContext {
  const categories = [
    ...new Set(
      (input.savedPlaces ?? [])
        .map((p) => p.category?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  ].slice(0, 8);
  const names = (input.savedPlaces ?? []).slice(0, 12).map((p) => p.name);
  return {
    profile: input.profile ?? null,
    savedPlaceCategories: categories,
    savedPlaceNames: names,
    explicitAvoidKeywords: input.explicitAvoidKeywords,
    explicitPreferKeywords: input.explicitPreferKeywords,
    mood: input.mood,
    setting: input.setting,
    surface: input.surface,
    sessionPreference: input.sessionPreference,
    profileVersion: input.profileVersion,
  };
}

/**
 * 分數愈高愈符合 Plus 測驗偏好（約 -40 ~ +40）。
 * 明確使用者需求請用 explicit* 傳入，會覆蓋測驗權重。
 */
export function scorePlusPreferenceMatch(
  place: PlusRankablePlace,
  ctx: PlusPreferenceRankingContext | null | undefined,
): number {
  if (!ctx) return 0;
  const personalization = buildPersonalizationContextV1({
    surface: ctx.surface ?? "destination",
    profile: ctx.profile,
    sessionPreference: ctx.sessionPreference,
    profileVersion: ctx.profileVersion,
    explicitCurrentRequest: {
      interests: ctx.explicitPreferKeywords,
      categoryExclude: ctx.explicitAvoidKeywords,
      mood: ctx.mood ?? undefined,
    },
  });
  const score = scorePersonalization(place, personalization, { log: true }).totalPersonalizationScore;
  return score + (place.isSavedFavorite ? 4 : 0);
}

/** rankScore 愈小愈優先（recommend-place-ranking 用） */
export function plusPreferenceRankPenalty(
  place: PlusRankablePlace,
  ctx: PlusPreferenceRankingContext | null | undefined,
): number {
  return -scorePlusPreferenceMatch(place, ctx);
}

export function formatPlusPreferenceForAiPrompt(
  prefs: TravelPreferences | null | undefined,
  extras?: {
    travelStyle?: string;
    personalityType?: string;
    personalitySummary?: string;
    hasPlusAccess?: boolean;
  },
): string | null {
  if (!extras?.hasPlusAccess || !prefs) return null;

  const parts: string[] = [];
  if (extras.personalityType || prefs.personalityType) {
    parts.push(`旅行人格：${extras.personalityType ?? prefs.personalityType}`);
  }
  if (prefs.pace) {
    parts.push(
      `步調：${prefs.pace === "slow" ? "慢、留白" : prefs.pace === "active" ? "多走走看看" : "中等"}`,
    );
  }
  if (prefs.vibe) {
    parts.push(
      `氛圍：${prefs.vibe === "quiet" ? "安靜" : prefs.vibe === "lively" ? "有生活感" : "彈性"}`,
    );
  }
  if (prefs.budgetMode || prefs.budget) parts.push(`消費風格偏好：${resolveBudgetMode(prefs)}`);
  if (prefs.avoid?.length) {
    const avoidLabels =
      prefs.avoid[0] === "crowds"
        ? "人潮太多"
        : prefs.avoid[0] === "packed"
          ? "行程太滿"
          : prefs.avoid[0] === "overload"
            ? "資訊過多"
            : prefs.avoid.join("、");
    parts.push(`想避開：${avoidLabels}`);
  }
  if (extras.travelStyle?.trim()) parts.push(`旅行風格：${extras.travelStyle.trim()}`);
  if (extras.personalitySummary?.trim() || prefs.personalitySummary?.trim()) {
    parts.push(`測驗摘要：${extras.personalitySummary ?? prefs.personalitySummary}`);
  }
  if (prefs.interests?.length) parts.push(`興趣標籤：${prefs.interests.join("、")}`);

  return parts.length ? parts.join("；") : null;
}
