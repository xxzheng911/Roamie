/** 首頁附近推薦 API 失敗時仍顯示靜態 fallback 卡（不改 UI，只補資料） */
export function shouldUseHomeNearbyFailureMocks(): boolean {
  return true;
}
