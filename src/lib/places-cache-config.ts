/** Google Places 快取 TTL（毫秒） */
export const PLACES_CACHE_TTL_MS = {
  /** 附近探索：5–10 分鐘區間，取 8 分鐘 */
  explore: 8 * 60 * 1000,
  homeNearby: 8 * 60 * 1000,
  autocomplete: 5 * 60 * 1000,
  placePhoto: 24 * 60 * 60 * 1000,
  placeDetails: 24 * 60 * 60 * 1000,
} as const;

/** 座標網格精度：約 110m，同區域視為同一 cache bucket */
export const PLACES_COORD_GRID_DECIMALS = 3;

/** 探索搜尋 API 回傳上限（降低計費） */
export const PLACES_SEARCH_LIMITS = {
  nearbyMaxResults: 12,
  textPageSize: 15,
  multiNearbyPerGroup: 6,
  multiNearbyMergedMax: 18,
} as const;

/** Autocomplete 輸入 debounce（毫秒） */
export const PLACES_AUTOCOMPLETE_DEBOUNCE_MS = 350;

/** Autocomplete 最少字元數（含 CJK 單字） */
export const PLACES_AUTOCOMPLETE_MIN_CHARS = 2;
