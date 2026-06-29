/** 探索地圖：每分類最多 5 次 fallback text 查詢（景點需多組城市級 query） */
export const EXPLORE_MAX_FALLBACK_QUERIES = 5;

/** 城市模式：需更多 text 查詢（不以 nearby 為主） */
export const EXPLORE_CITY_MAX_FALLBACK_QUERIES = 16;

export function exploreMaxFallbackQueries(cityMode: boolean): number {
  return cityMode ? EXPLORE_CITY_MAX_FALLBACK_QUERIES : EXPLORE_MAX_FALLBACK_QUERIES;
}

export function firstFallbackQuery(queries: readonly string[]): string | null {
  return queries[0]?.trim() || null;
}
