import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { chatRuntimeMessages } from "@/lib/i18n/chat-runtime";
import type { Locale } from "@/lib/i18n/types";

/**
 * Recommendation badge answers "what is this batch?"
 * Recommendation reason answers "why does it fit?"
 *
 * Atmosphere modifiers such as quiet never replace a primary place category.
 * Generic place/attraction categories never replace a named experience.
 */
export type BadgeSemanticRole = "primary_display" | "mood_modifier" | "internal_routing";

export type BadgeSemanticRecord = {
  key: string;
  role: BadgeSemanticRole;
  /** Resolver may emit this key, so all four locales must exist. */
  displayable: boolean;
  aliases: readonly string[];
};

const SPECIFIC_PLACE_CATEGORIES = new Set([
  "cafe",
  "food",
  "shopping",
  "night",
  "culture",
  "outdoor",
  "family",
  "photo",
]);

const BATCH_IDENTITY = new Set(["classic", "local", "slow", "slow_travel", "mixed"]);

const BADGE_MESSAGE_KEY: Record<string, string> = {
  relax: "badge_relax",
  explore: "badge_explore",
  photo: "badge_photo",
  food: "badge_food",
  cafe: "badge_cafe",
  night: "badge_night",
  shopping: "badge_shopping",
  family: "badge_family",
  outdoor: "badge_outdoor",
  culture: "badge_culture",
  unwind: "badge_unwind",
  solo: "badge_solo",
  rainy: "badge_rainy",
  night_walk: "badge_night_walk",
  coffee_stop: "badge_coffee_stop",
  sea: "badge_sea",
  classic: "badge_classic",
  local: "badge_local",
  slow: "badge_slow",
  slow_travel: "badge_slow_travel",
  mixed: "badge_mixed",
  quiet: "badge_quiet",
};

const SEMANTICS: readonly BadgeSemanticRecord[] = [
  {
    key: "relax",
    role: "primary_display",
    displayable: true,
    aliases: ["relax", "relax_walk", "放鬆", "放松"],
  },
  { key: "explore", role: "primary_display", displayable: true, aliases: ["explore", "探索"] },
  {
    key: "photo",
    role: "primary_display",
    displayable: true,
    aliases: ["photo", "photography", "拍照"],
  },
  { key: "food", role: "primary_display", displayable: true, aliases: ["food", "美食"] },
  {
    key: "cafe",
    role: "primary_display",
    displayable: true,
    aliases: ["cafe", "coffee", "café", "咖啡"],
  },
  { key: "night", role: "primary_display", displayable: true, aliases: ["night", "夜景"] },
  { key: "shopping", role: "primary_display", displayable: true, aliases: ["shopping", "購物"] },
  { key: "family", role: "primary_display", displayable: true, aliases: ["family", "親子"] },
  { key: "outdoor", role: "primary_display", displayable: true, aliases: ["outdoor", "戶外"] },
  { key: "culture", role: "primary_display", displayable: true, aliases: ["culture", "文化"] },
  {
    key: "unwind",
    role: "primary_display",
    displayable: true,
    aliases: ["unwind", "想放空", "放空"],
  },
  { key: "solo", role: "primary_display", displayable: true, aliases: ["solo", "一個人"] },
  {
    key: "rainy",
    role: "primary_display",
    displayable: true,
    aliases: ["rainy", "rainy_indoor", "下雨天", "雨天"],
  },
  {
    key: "night_walk",
    role: "primary_display",
    displayable: true,
    aliases: ["night_walk", "late_night", "home_late_night", "深夜散步", "夜晚散策"],
  },
  {
    key: "coffee_stop",
    role: "primary_display",
    displayable: true,
    aliases: ["coffee_stop", "找咖啡"],
  },
  {
    key: "sea",
    role: "primary_display",
    displayable: true,
    aliases: ["sea", "coastal", "home_sea", "看海"],
  },
  {
    key: "classic",
    role: "primary_display",
    displayable: true,
    aliases: ["classic", "classic_landmarks", "經典地標"],
  },
  {
    key: "local",
    role: "primary_display",
    displayable: true,
    aliases: ["local", "local_life", "在地生活"],
  },
  {
    key: "slow",
    role: "primary_display",
    displayable: true,
    aliases: ["slow", "slow_nature", "慢步調散策"],
  },
  {
    key: "slow_travel",
    role: "primary_display",
    displayable: true,
    aliases: ["slow_travel", "slow travel", "Slow travel", "慢旅行", "慢旅"],
  },
  {
    key: "mixed",
    role: "primary_display",
    displayable: true,
    aliases: ["mixed", "Roamie混搭", "Roamie 混搭", "Roamie 混搭推薦"],
  },
  {
    key: "quiet",
    role: "mood_modifier",
    displayable: true,
    aliases: ["quiet", "安靜", "安静", "寧靜", "宁静"],
  },
  {
    key: "quiet_cafe",
    role: "internal_routing",
    displayable: false,
    aliases: ["quiet_cafe"],
  },
  {
    key: "generic_place",
    role: "internal_routing",
    displayable: false,
    aliases: [
      "attraction",
      "place",
      "tourist_attraction",
      "general",
      "indoor",
      "bar",
      "night_market",
    ],
  },
  {
    key: "category_derived",
    role: "internal_routing",
    displayable: false,
    aliases: ["美食咖啡", "動漫購物", "經典景點", "美食文化", "自然風光", "商圈購物", "城市散策"],
  },
];

const BY_ALIAS = new Map<string, BadgeSemanticRecord>();
for (const semantic of SEMANTICS) {
  for (const alias of semantic.aliases) {
    BY_ALIAS.set(alias, semantic);
    BY_ALIAS.set(alias.toLowerCase(), semantic);
  }
}

const INTENT_CATEGORY: Record<string, string> = {
  restaurant: "food",
  cafe: "cafe",
  shopping: "shopping",
};

export function recommendationBadgeInventory(): readonly BadgeSemanticRecord[] {
  return SEMANTICS;
}

export function classifyRecommendationBadgeToken(
  value: string | null | undefined,
): BadgeSemanticRecord | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return BY_ALIAS.get(trimmed) ?? BY_ALIAS.get(trimmed.toLowerCase()) ?? null;
}

export function projectRecommendationBadge(key: string, locale: Locale): string {
  const messageKey = BADGE_MESSAGE_KEY[key];
  if (!messageKey) return "";
  return chatRuntimeMessages[locale]?.[messageKey] ?? "";
}

export function recommendationBadgeStoredLabel(key: string): string {
  return projectRecommendationBadge(key, "zh-TW");
}

export type RecommendationBadgeInput = {
  primaryCategory?: string | null;
  activity?: string | null;
  recommendationFamily?: string | null;
  mood?: string | null;
  contextModifier?: string | null;
  intent?: string | null;
};

function specificPlaceCategory(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const mapped = INTENT_CATEGORY[raw] ?? INTENT_CATEGORY[raw.toLowerCase()];
  if (mapped) return mapped;
  const classified = classifyRecommendationBadgeToken(raw);
  if (classified && SPECIFIC_PLACE_CATEGORIES.has(classified.key)) return classified.key;
  return null;
}

function experienceKey(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  if (raw === "quiet_cafe") return null;
  const classified = classifyRecommendationBadgeToken(raw);
  if (!classified || !classified.displayable || classified.key === "quiet") return null;
  return classified.key;
}

/**
 * Selects the canonical badge key. Does not localize and does not change
 * routing, query, or ranking inputs.
 */
export function resolveRecommendationDisplayBadge(input: RecommendationBadgeInput): string {
  const scene = input.recommendationFamily?.trim() || "";
  let category =
    specificPlaceCategory(input.primaryCategory) ?? specificPlaceCategory(input.intent);
  if (scene === "quiet_cafe") category = "cafe";

  const family = experienceKey(scene) ?? experienceKey(input.activity) ?? null;
  const mood =
    experienceKey(input.mood) ??
    (classifyRecommendationBadgeToken(input.mood)?.key === "quiet" ? "quiet" : null);
  const modifier =
    input.contextModifier === "quiet" || mood === "quiet"
      ? "quiet"
      : input.contextModifier?.trim() || null;

  if (mood && mood !== "quiet" && BATCH_IDENTITY.has(mood)) return mood;
  if (family && BATCH_IDENTITY.has(family)) return family;

  if (category === "cafe" && modifier === "quiet") return "cafe";
  if (mood === "coffee_stop" && modifier !== "quiet") return "coffee_stop";

  if (category) return category;
  if (family) return family;
  if (mood && mood !== "quiet") return mood;
  if (modifier === "quiet") return "quiet";
  return "";
}

export type DisplayedRecommendationBadgeInput = {
  session?: ChatPlanningSession | null;
  context?: CanonicalTravelContext | null;
  intent?: string | null;
  shortcutScene?: string | null;
  moodTag?: string | null;
  mood?: string | null;
  primaryCategory?: string | null;
  recommendationFamily?: string | null;
  activity?: string | null;
  contextModifier?: string | null;
};

function signalsForDisplayedBadge(
  input: DisplayedRecommendationBadgeInput,
  raw: string,
): RecommendationBadgeInput {
  const session = input.session ?? undefined;
  const context = input.context ?? session?.travelContext;
  const scene =
    input.shortcutScene ?? input.recommendationFamily ?? session?.shortcutContext?.scene ?? null;
  const intent =
    input.intent ??
    input.primaryCategory ??
    session?.activeCategoryIntent ??
    (session?.activeChatIntent === "cafe" ||
    session?.activeChatIntent === "restaurant" ||
    session?.activeChatIntent === "attraction" ||
    session?.activeChatIntent === "camping"
      ? session.activeChatIntent
      : null) ??
    session?.shortcutContext?.categoryIntent ??
    null;
  const mood = input.mood ?? raw;
  const quiet =
    input.contextModifier === "quiet" ||
    session?.normalizedShortcutRequest?.modifiers?.quiet === true ||
    classifyRecommendationBadgeToken(mood)?.key === "quiet";
  return {
    primaryCategory: input.primaryCategory ?? intent,
    intent,
    recommendationFamily: scene ?? context?.planningTripStyle ?? context?.selectedTripStyle ?? null,
    activity: input.activity ?? context?.activity ?? null,
    mood,
    contextModifier: quiet ? "quiet" : (input.contextModifier ?? null),
  };
}

/**
 * Shared display authority for General Chat, itinerary handoff, Home,
 * Selection, and continuation. Ranking mood stays on the session.
 */
export function resolveDisplayedRecommendationBadge(
  input: DisplayedRecommendationBadgeInput,
): string {
  const raw = input.moodTag?.trim() ?? "";
  if (!raw) return "";
  const rawClass = classifyRecommendationBadgeToken(raw);
  if (!rawClass) return raw;
  const key = resolveRecommendationDisplayBadge(signalsForDisplayedBadge(input, raw));
  if (!key) return rawClass.displayable ? raw : "";
  if (rawClass.key === key && rawClass.displayable) return raw;
  return recommendationBadgeStoredLabel(key);
}
