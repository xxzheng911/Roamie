import type { PlusConversationMemory } from "@/lib/ai/plus-conversation-memory";
import type { LongTermMemorySnapshot } from "@/lib/ai/memory/types";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { TravelProfileFields } from "@/lib/travel-profile-for-ai";

export {
  extractPlusMemoryFromUserText,
  mergeSessionIntoPlusMemory,
} from "@/lib/ai/plus-memory-from-chat";

/** Merge persisted plus_memory into runtime long-term snapshot for AI prompt */
export function mergePlusMemoryIntoSnapshot(
  base: LongTermMemorySnapshot,
  plus: PlusConversationMemory | null | undefined,
): LongTermMemorySnapshot {
  if (!plus || !Object.keys(plus).length) return base;

  const traits = [...new Set([...(base.traits ?? []), ...traitLinesFromPlus(plus)])];

  return {
    ...base,
    travelStyle: base.travelStyle ?? plus.travelPersonality,
    personalityType: base.personalityType ?? plus.travelPersonality,
    interests: [...new Set([...(base.interests ?? []), ...(plus.likes ?? [])])],
    savedPlaceCategories: [
      ...new Set([
        ...(base.savedPlaceCategories ?? []),
        ...(plus.savedPlacePatterns ?? []),
        ...(plus.favoritePlaceTypes ?? []),
        ...(plus.favoriteRestaurantTypes ?? []),
      ]),
    ],
    traits,
  };
}

function traitLinesFromPlus(plus: PlusConversationMemory): string[] {
  const lines: string[] = [];
  if (plus.travelPace) lines.push(plus.travelPace);
  if (plus.budgetRange) lines.push(`預算：${plus.budgetRange}`);
  if (plus.preferredTransport) lines.push(`交通：${plus.preferredTransport}`);
  if (plus.accommodationStyle) lines.push(`住宿：${plus.accommodationStyle}`);
  if (plus.likes?.length) lines.push(`喜好：${plus.likes.join("、")}`);
  if (plus.dislikes?.length) lines.push(`避免：${plus.dislikes.join("、")}`);
  if (plus.favoriteCountries?.length) lines.push(`常去國家：${plus.favoriteCountries.join("、")}`);
  if (plus.favoriteCities?.length) lines.push(`常去城市：${plus.favoriteCities.join("、")}`);
  if (plus.collectionInsightTags?.length) {
    lines.push(`收藏洞察：${plus.collectionInsightTags.join("、")}`);
  }
  if (plus.notes?.trim()) lines.push(plus.notes.trim());
  return lines;
}

/** Build / refresh plus_memory from profile, quiz, and saves */
export function buildPlusMemoryFromSources(input: {
  prefs: TravelPreferences;
  profileFields?: TravelProfileFields | null;
  savedCategories?: string[];
  existing?: PlusConversationMemory | null;
}): PlusConversationMemory {
  const { prefs, profileFields, savedCategories = [], existing } = input;
  const snapshot = prefs.resultProfile;
  const personality = profileFields?.travelPersonality;

  const likes = [
    ...new Set([
      ...(existing?.likes ?? []),
      ...(prefs.interests ?? []),
      ...(profileFields?.travelPreferences ?? []),
      ...(profileFields?.travelTags ?? []),
      ...(snapshot?.travelTags ?? []),
    ]),
  ].filter(Boolean);

  const savedPlacePatterns = [
    ...new Set([...(existing?.savedPlacePatterns ?? []), ...savedCategories]),
  ].filter(Boolean);

  const collectionInsightTags = inferCollectionInsightTags(savedPlacePatterns, likes);

  return {
    ...existing,
    likes: likes.length ? likes : existing?.likes,
    travelPersonality:
      personality?.type ?? snapshot?.personalityType ?? prefs.personalityType ?? existing?.travelPersonality,
    favoritePlaceTypes: profileFields?.travelPreferences?.length
      ? profileFields.travelPreferences
      : existing?.favoritePlaceTypes,
    savedPlacePatterns: savedPlacePatterns.length ? savedPlacePatterns : existing?.savedPlacePatterns,
    collectionInsightTags: collectionInsightTags.length
      ? collectionInsightTags
      : existing?.collectionInsightTags,
    travelPace:
      prefs.pace === "slow"
        ? "慢旅行、留白多"
        : prefs.pace === "active"
          ? "節奏偏緊"
          : existing?.travelPace,
    notes: personality?.summary ?? prefs.personalitySummary ?? existing?.notes,
  };
}

function inferCollectionInsightTags(categories: string[], likes: string[]): string[] {
  const pool = [...categories, ...likes].join(" ");
  const tags: string[] = [];
  if (/咖啡|café/i.test(pool)) tags.push("老宅咖啡廳");
  if (/夜景|夜間|bar|酒吧/i.test(pool)) tags.push("夜景與夜生活");
  if (/購物|百貨|outlet/i.test(pool)) tags.push("購物");
  if (/寺|神社|文化|博物/i.test(pool)) tags.push("文化散步");
  return [...new Set(tags)].slice(0, 4);
}

export function parsePlusMemory(raw: unknown): PlusConversationMemory {
  if (!raw || typeof raw !== "object") return {};
  return raw as PlusConversationMemory;
}
