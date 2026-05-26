import { detectPlatform } from "@/services/platform";

/** iOS 26 snapshot renderer：SPA / 互動後請 native 刷新 mirror（不切回 live compositor） */
export function requestIosSnapshotRefresh(reason = "spa", options?: { force?: boolean }): void {
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
    handler.postMessage({ reason, force: options?.force === true });
  } catch {
    // ignore — native handler optional on simulator / older iOS
  }
}

/** 等 React 首屏後再 ping native（避免 mirror 停在 HTML boot splash） */
export function scheduleIosSnapshotRefreshBurst(reason = "app-ready"): void {
  for (const delayMs of [0, 800, 2000, 4000]) {
    window.setTimeout(() => {
      requestIosSnapshotRefresh(reason, { force: delayMs >= 2000 });
    }, delayMs);
  }
}
