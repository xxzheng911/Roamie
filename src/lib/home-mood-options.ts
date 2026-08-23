/** 首頁心情快捷按鍵（不含 solo／一個人，該選項仍可透過 URL／session 解析） */
export const HOME_MOOD_SHORTCUT_IDS = ["relax", "rainy", "lateNight", "coffee", "sea"] as const;

export type HomeMoodShortcutId = (typeof HOME_MOOD_SHORTCUT_IDS)[number];

export type HomeMoodId = HomeMoodShortcutId | "solo";

/** @deprecated 使用 HOME_MOOD_SHORTCUT_IDS（首頁 chip 列表） */
export const HOME_MOOD_IDS = HOME_MOOD_SHORTCUT_IDS;

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
  夜晚散策: "lateNight",
  找咖啡: "coffee",
  看海: "sea",
};

export function normalizeHomeMoodId(stored: string | null | undefined): HomeMoodId | null {
  if (!stored?.trim()) return null;
  const value = stored.trim();
  if (value === "solo") return "solo";
  if ((HOME_MOOD_SHORTCUT_IDS as readonly string[]).includes(value)) {
    return value as HomeMoodShortcutId;
  }
  return LEGACY_MOOD_LABEL_TO_ID[value] ?? null;
}
