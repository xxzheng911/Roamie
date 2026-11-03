import type { TripMapMode } from "@/lib/trip/trip-map-markers";

/**
 * Trip Workspace 地圖分頁 →「查看詳情」→ 返回行程時，還原地圖分頁的模式與選取。
 *
 * 只在「離開行程頁 → 地點詳情頁（/place，可多次 replace）→ 直接回到同一行程頁」時有效：
 * - 保存時訂閱路由 onBeforeLoad 事件（只存在記憶體，不寫 sessionStorage）。
 *   同網址重新 load（invalidate）也會發出：在 leaving／detail 階段分別對應同一行程頁／詳情頁，不改變階段。
 * - 導覽到 /place → 進入 detail 階段；detail 階段再導覽到 /saved/<同一 tripId> → returned。
 * - 其餘任何導覽（底部 tab、收藏列表、其他行程…）立即作廢並退訂。
 * - 讀取時另需 tripId 相符、未逾時；網址未帶 view 時還需網址 day 與保存的 day 相同。
 * - TripDetailScreen 每次掛載都會清除（不論是否套用）。
 */
const MAX_AGE_MS = 10 * 60 * 1000;
const PLACE_PATH = "/place";

type Phase = "leaving" | "detail" | "returned";

export type TripMapReturnState = {
  tripId: string;
  mode: TripMapMode;
  selectedId: string | null;
  /** 詳情頁返回時網址帶的 day（1-based） */
  day: number;
  savedAt: number;
};

/** 訂閱「即將導覽到的 pathname」；回傳退訂函式（由呼叫端以路由事件實作）。 */
export type SubscribeNavigation = (listener: (pathname: string) => void) => () => void;

let pending: (TripMapReturnState & { phase: Phase }) | null = null;
let unsubscribe: (() => void) | null = null;

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function stopListening(): void {
  const off = unsubscribe;
  unsubscribe = null;
  off?.();
}

export function clearTripMapReturnState(): void {
  pending = null;
  stopListening();
}

export function saveTripMapReturnState(
  state: Omit<TripMapReturnState, "savedAt">,
  subscribe: SubscribeNavigation,
): void {
  clearTripMapReturnState();
  const tripPath = `/saved/${state.tripId}`;
  pending = { ...state, savedAt: Date.now(), phase: "leaving" };
  unsubscribe = subscribe((rawPath) => {
    const current = pending;
    if (!current) {
      stopListening();
      return;
    }
    const path = normalizePath(rawPath);
    if (path === PLACE_PATH) {
      if (current.phase === "leaving") current.phase = "detail";
      else if (current.phase === "returned") clearTripMapReturnState();
      return;
    }
    if (path === tripPath) {
      // 尚未離開行程頁（同頁 replace）不影響；從詳情頁直接回來才有效
      if (current.phase === "detail") {
        current.phase = "returned";
        stopListening();
      }
      return;
    }
    clearTripMapReturnState();
  });
}

/**
 * 只讀不刪（render 期間可安全呼叫）；清除請呼叫 clearTripMapReturnState。
 * @param initialView 網址 view（未帶時為 "trip"）
 * @param initialDay 網址 day（1-based）
 */
export function readTripMapReturnState(
  tripId: string,
  initialView: string | undefined,
  initialDay: number | undefined,
): TripMapReturnState | null {
  const current = pending;
  if (!current || current.phase !== "returned" || current.tripId !== tripId) return null;
  if (Date.now() - current.savedAt > MAX_AGE_MS) return null;
  const view = initialView ?? "trip";
  // 網址明確帶其他分頁時以網址為準
  if (view !== "trip" && view !== "map") return null;
  // 詳情頁返回只帶 ?day=（與保存時相同）；瀏覽器返回則回到原本的 ?view=map
  if (view === "trip" && initialDay !== current.day) return null;
  return {
    tripId: current.tripId,
    mode: current.mode,
    selectedId: current.selectedId,
    day: current.day,
    savedAt: current.savedAt,
  };
}
