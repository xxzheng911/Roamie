/** 首頁附近推薦：正式版不使用 mock；僅 DEV 且明確開啟時才允許 failure mock */
export function shouldUseHomeNearbyFailureMocks(): boolean {
  if (import.meta.env.PROD) return false;
  return import.meta.env.DEV && import.meta.env.VITE_HOME_NEARBY_MOCK_ON_FAIL === "1";
}
