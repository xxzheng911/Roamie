/** API cache TTL（毫秒） */
export const API_CACHE_TTL_MS = {
  /** 天氣：45 分鐘（30–60 分鐘區間） */
  weather: 45 * 60 * 1000,
  /** 路線：30 分鐘 */
  routes: 30 * 60 * 1000,
  /** 地點 / 封面圖：1 天 */
  image: 24 * 60 * 60 * 1000,
} as const;

/** Roamie API fallback 文案 — 失敗時不 crash、不空白 */
export const ROAMIE_API_FALLBACK = {
  weather: "暫時讀不到天氣，但 Roamie 還是先陪你安排這趟旅程。",
  weatherOutfit: "目前無法取得天氣資訊，穿搭建議將於天氣資料恢復後更新",
  routes: "路程時間暫時讀取中",
  routesLoading: "路程時間暫時讀取中。",
  image: "先用 Roamie 預設封面陪你出發。",
} as const;

/** 高雄市（OpenWeather 測試用） */
export const KAOHSIUNG_COORDS = { lat: 22.6273, lng: 120.3014 } as const;

/** 高雄車站 → 駁二（Routes 測試用） */
export const ROUTES_TEST_ORIGIN = { lat: 22.687, lng: 120.3075 } as const;
export const ROUTES_TEST_DESTINATION = { lat: 22.6194, lng: 120.2826 } as const;
