export const HOME_MOOD_IDS = ["relax", "solo", "rainy", "lateNight", "coffee", "sea"] as const;

export type HomeMoodId = (typeof HOME_MOOD_IDS)[number];

export const HOME_MOOD_EMOJI: Record<HomeMoodId, string> = {
  relax: "🍃",
  solo: "🚶",
  rainy: "☔",
  lateNight: "🌙",
  coffee: "☕",
  sea: "🌊",
};

const LEGACY_MOOD_LABEL_TO_ID: Record<string, HomeMoodId> = {
  想放空: "relax",
  一個人: "solo",
  下雨天: "rainy",
  深夜散步: "lateNight",
  找咖啡: "coffee",
  看海: "sea",
};

export function normalizeHomeMoodId(stored: string | null | undefined): HomeMoodId | null {
  if (!stored?.trim()) return null;
  const value = stored.trim();
  if ((HOME_MOOD_IDS as readonly string[]).includes(value)) {
    return value as HomeMoodId;
  }
  return LEGACY_MOOD_LABEL_TO_ID[value] ?? null;
}
