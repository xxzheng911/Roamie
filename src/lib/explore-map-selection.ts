const CLEAR_SELECTION_KEY = "roamie:explore-map-clear-selection";

/** 從地點詳情頁返回探索地圖前呼叫，讓地圖頁清除選取狀態 */
export function requestExploreMapClearSelection(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(CLEAR_SELECTION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function consumeExploreMapClearSelection(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(CLEAR_SELECTION_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(CLEAR_SELECTION_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}
