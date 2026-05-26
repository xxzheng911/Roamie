import { detectPlatform } from "@/services/platform";

const BRIDGE_POLL_MS = 48;
const DEFAULT_MAX_WAIT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBridgeLikelyReady(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & {
      Capacitor?: {
        getPlatform?: () => string;
        isNativePlatform?: () => boolean;
        Plugins?: Record<string, unknown>;
      };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return true;
  if (typeof cap.getPlatform !== "function") return false;
  const platform = cap.getPlatform();
  if (platform !== "ios" && platform !== "android") return false;
  return Boolean(cap.Plugins);
}

/** 等 document 與主要 script 載入完成 */
export function waitForDocumentLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
}

/**
 * Capacitor WKWebView：等 bridge 就緒再呼叫原生 plugin（避免 JS Eval error / WebContent 無回應）。
 */
export async function waitForCapacitorBridge(
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!detectPlatform().isCapacitor) return true;

  await waitForDocumentLoaded();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (isBridgeLikelyReady()) return true;
    await sleep(BRIDGE_POLL_MS);
  }

  console.warn(
    "[Roamie] Capacitor bridge not ready after",
    maxWaitMs,
    "ms — skipping native plugin calls this session",
  );
  return false;
}

/** 在 bridge 就緒後執行；失敗只記錄、不拋錯 */
export async function runWhenCapacitorBridgeReady(
  label: string,
  fn: () => void | Promise<void>,
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
): Promise<void> {
  const ready = await waitForCapacitorBridge(maxWaitMs);
  if (!ready) {
    console.warn(`[Roamie] ${label} skipped (bridge not ready)`);
    return;
  }
  try {
    await fn();
  } catch (e) {
    console.warn(`[Roamie] ${label} failed`, e);
  }
}
