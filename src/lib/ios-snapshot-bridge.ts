import { detectPlatform } from "@/services/platform";

/** Login / 主殼層已渲染（有互動元素），才值得刷新 iOS mirror */
export function isIosSnapshotUiReady(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.roamieAppReady === "1") return true;
  const root = document.getElementById("root");
  if (!root) return false;
  return root.querySelector("button,a[href],input,form,main,nav") != null;
}

function postToNative(body: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const { isCapacitor, isIOS } = detectPlatform();
  if (!isCapacitor || !isIOS) return;

  const handler = (
    window as Window & {
      webkit?: { messageHandlers?: { roamieSnapshot?: { postMessage: (body: unknown) => void } } };
    }
  ).webkit?.messageHandlers?.roamieSnapshot;

  if (!handler) return;

  try {
    handler.postMessage(body);
  } catch {
    // ignore — native handler optional on simulator / older iOS
  }
}

/**
 * Legal overlay: mirror mode + scroll-synced snapshot refresh (do not use live mode — inner scroll won't paint on iOS 26).
 */
export function setIosLegalOverlayOpen(open: boolean): void {
  postToNative({ mode: open ? "legal-overlay" : "legal-overlay-off" });
}

/** iOS 26 legal sheet：live WebView（mirror 會導致關閉鍵點到下方 Google 登入） */
export function bindIosLegalDocumentOverlay(reason: string): () => void {
  const { isCapacitor, isIOS } = detectPlatform();
  if (!isCapacitor || !isIOS) return () => {};

  setIosSnapshotLiveInteraction(true);
  setIosLegalOverlayOpen(true);
  scheduleIosSnapshotRefreshBurst(reason);

  return () => {
    setIosLegalOverlayOpen(false);
    requestIosSnapshotRefresh(`${reason}-close`, { force: true });
  };
}

/** OAuth / 外部 Browser 返回後重置 mirror 與 touch 狀態（避免 live depth 卡住） */
export function resetIosSnapshotInteraction(): void {
  postToNative({ mode: "reset-interaction" });
}

/** 登入 / OAuth 互動頁：強制 live WebView（避免 depth 累積或 mirror 擋住點擊） */
export function setIosSnapshotLiveInteractionForced(active: boolean): void {
  postToNative({ mode: active ? "live-force" : "mirror-force" });
}

/**
 * Sheet / modal 開啟時改用 live WKWebView（mirror 是靜態圖，滾動後觸控座標會错位）。
 */
export function setIosSnapshotLiveInteraction(active: boolean): void {
  postToNative({ mode: active ? "live" : "mirror", reason: active ? "live-on" : "live-off" });
}

/** 即將開啟系統 OAuth 瀏覽器：強制 live WebView，暫停 mirror（避免 iOS 26 卡在登入畫面） */
export function notifyIosOAuthOpen(): void {
  postToNative({ mode: "oauth-open" });
  ensureIosLoginLiveInteraction();
}

/** OAuth 從系統瀏覽器返回：強制 live、停止 mirror 刷新（避免卡在舊 splash） */
export function notifyIosOAuthReturn(): void {
  postToNative({ mode: "oauth-return" });
  ensureIosLoginLiveInteraction();
}

/** Login 首屏：強制 live + 延遲重試（native bridge / window 可能晚於 React mount） */
export function ensureIosLoginLiveInteraction(): void {
  const { isCapacitor, isIOS } = detectPlatform();
  if (!isCapacitor || !isIOS) return;

  const apply = () => setIosSnapshotLiveInteractionForced(true);
  apply();
  for (const delayMs of [150, 600, 2000]) {
    window.setTimeout(apply, delayMs);
  }
}

/** iOS 26 snapshot renderer：SPA / 互動後請 native 刷新 mirror（不切回 live compositor） */
export function requestIosSnapshotRefresh(reason = "spa", options?: { force?: boolean }): void {
  postToNative({ reason, force: options?.force === true });
}

/** 等 React 首屏（Login 按鈕等）後再 ping native */
export function scheduleIosSnapshotRefreshBurst(reason = "app-ready"): void {
  for (const delayMs of [0, 800, 2000, 4000, 7000]) {
    window.setTimeout(() => {
      if (!isIosSnapshotUiReady()) return;
      requestIosSnapshotRefresh(reason, { force: true });
    }, delayMs);
  }
}

/**
 * iOS 26：互動頁（welcome / 主殼層）用 live WebView，避免 mirror 仍停在 login 導致觸控错位。
 * 離開頁面時還原 mirror 並刷新 snapshot。
 */
export function bindIosInteractiveRoute(reason: string): () => void {
  const { isCapacitor, isIOS } = detectPlatform();
  if (!isCapacitor || !isIOS) return () => {};

  ensureIosLoginLiveInteraction();

  return () => {
    // Do not restore WINDOW_MIRROR on teardown — iOS 26 blocks taps when mirror is on top.
  };
}
