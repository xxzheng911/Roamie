const FLEXIBLE_PREFERENCE_RE =
  /^(都可以|都行|都行吧|隨便|隨意|你幫我安排|你安排|你決定|你推薦|看你推薦|沒有特別|沒特別|沒想法|沒意見|第一次去|不熟|沒有特別想法|你決定|你來排|你來安排|交給你|聽你的|隨你|隨你便)[吧呢嗎啊！!。．…]*$/iu;

const FLEXIBLE_INLINE_RE =
  /(都可以|都行|隨便|你幫我安排|你安排|看你推薦|沒有特別想法|沒特別偏好|交給你安排|第一次去|不熟)/iu;

/** 使用者表示偏好彈性、交由 Roamie 安排 */
export function isFlexiblePreferenceReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (FLEXIBLE_PREFERENCE_RE.test(t)) return true;
  if (t.length <= 20 && FLEXIBLE_INLINE_RE.test(t)) return true;
  return false;
}

/** 統一轉為 flexible 偏好標籤 */
export function normalizeFlexiblePreferences(): string[] {
  return ["flexible"];
}
