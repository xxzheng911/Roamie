/** 僅在完全無法辨識地點時使用的極簡 fallback */
export const PLACE_INTRO_GENERIC_FALLBACK = "適合現在去走走";

export function isGenericPlaceReason(reason: string | null | undefined): boolean {
  const t = reason?.trim();
  if (!t) return true;
  if (t === PLACE_INTRO_GENERIC_FALLBACK) return true;
  if (t.includes(PLACE_INTRO_GENERIC_FALLBACK)) return true;
  if (t === "適合順路安排" || t === "適合順路走走") return true;
  if (/^適合現在/.test(t) && t.length <= 12) return true;
  return false;
}
