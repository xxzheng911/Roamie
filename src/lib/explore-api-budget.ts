/** 探索地圖：每分類最多 5 次 fallback text 查詢（景點需多組城市級 query） */
export const EXPLORE_MAX_FALLBACK_QUERIES = 5;

export function firstFallbackQuery(queries: readonly string[]): string | null {
  return queries[0]?.trim() || null;
}
