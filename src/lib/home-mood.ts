import { normalizeHomeMoodId, type HomeMoodId } from "@/lib/home-mood-options";

/** 僅供首頁 UI 短暫選取；不應作為長期心情紀錄或聊聊上下文來源 */
const HOME_MOOD_UI_KEY = "roamie:home-mood";

export function readHomeMood(): HomeMoodId | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const v = sessionStorage.getItem(HOME_MOOD_UI_KEY);
    return normalizeHomeMoodId(v);
  } catch {
    return null;
  }
}

/** @deprecated 首頁 UI 不應持久化選取；請改用 clearHomeMoodUiSelection */
export function writeHomeMood(mood: HomeMoodId | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!mood) {
      sessionStorage.removeItem(HOME_MOOD_UI_KEY);
      return;
    }
    sessionStorage.setItem(HOME_MOOD_UI_KEY, mood);
  } catch {
    /* ignore */
  }
}

/** 清除首頁心情 chip 的選取樣式（不影響 chat session 的 mood / selectedMood） */
export function clearHomeMoodUiSelection(): void {
  writeHomeMood(null);
}
