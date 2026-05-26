const HOME_MOOD_KEY = "roamie:home-mood";

export function readHomeMood(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const v = sessionStorage.getItem(HOME_MOOD_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export function writeHomeMood(mood: string | null): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (!mood?.trim()) {
      sessionStorage.removeItem(HOME_MOOD_KEY);
      return;
    }
    sessionStorage.setItem(HOME_MOOD_KEY, mood.trim());
    console.info("[home-mood] saved", mood.trim());
  } catch {
    /* ignore */
  }
}
