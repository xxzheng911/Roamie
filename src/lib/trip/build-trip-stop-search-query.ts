const UNSET_DESTINATION = new Set(["尚未設定", "未設定", ""]);

/** 組合「行程目的地 + 使用者輸入」，避免只用名稱搜到錯誤地點 */
export function buildTripStopSearchQuery(
  userInput: string,
  destination?: string | null,
): string {
  const q = userInput.trim();
  if (!q) return "";
  const dest = destination?.trim() ?? "";
  if (!dest || UNSET_DESTINATION.has(dest)) return q;

  const qNorm = q.toLowerCase();
  const destNorm = dest.toLowerCase();
  if (qNorm.includes(destNorm)) return q;

  return `${dest} ${q}`;
}
